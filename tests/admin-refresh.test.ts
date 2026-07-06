import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { db, pool, jobs, users } from '@friendtracker/db'
import { app } from '../apps/api/src/app.js'
import { createSession } from '../apps/api/src/auth/session.js'

const ORIGIN = 'http://localhost:5173'
const ADMIN_STEAM64 = '76561197960266338'
const USER_STEAM64 = '76561197960266339'

beforeAll(() => {
  process.env.ADMIN_STEAM_IDS = ADMIN_STEAM64
})

afterAll(async () => {
  delete process.env.ADMIN_STEAM_IDS
  await pool.end()
})

beforeEach(async () => {
  await db.delete(jobs)
})

async function sessionFor(steamId: string): Promise<string> {
  const [user] = await db
    .insert(users)
    .values({ steamId, name: 'Refresher' })
    .onConflictDoUpdate({ target: [users.provider, users.steamId], set: { name: 'Refresher' } })
    .returning()
  const { token } = await createSession(user.id)
  return token
}

function post(token: string | null, ip: string) {
  return app.request('/api/admin/refresh', {
    method: 'POST',
    headers: {
      origin: ORIGIN,
      'x-real-ip': ip,
      ...(token ? { cookie: `session=${token}` } : {}),
    },
  })
}

describe('POST /api/admin/refresh', () => {
  it('401s anonymous requests', async () => {
    expect((await post(null, '10.11.0.1')).status).toBe(401)
  })

  it('403s signed-in non-admins', async () => {
    const token = await sessionFor(USER_STEAM64)
    expect((await post(token, '10.11.0.2')).status).toBe(403)
  })

  it('enqueues the refresh trio in pipeline order: 202 { queued: true }', async () => {
    const token = await sessionFor(ADMIN_STEAM64)
    const res = await post(token, '10.11.0.3')
    expect(res.status).toBe(202)
    expect(await res.json()).toEqual({ queued: true })
    const rows = await db.select().from(jobs).orderBy(jobs.id)
    expect(rows.map((r) => r.type)).toEqual(['fetch-data', 'populate-builds', 'request-parses'])
    expect(rows.every((r) => r.status === 'pending')).toBe(true)
  })

  it('is idempotent while the trio is pending: 200 { queued: false }', async () => {
    const token = await sessionFor(ADMIN_STEAM64)
    await post(token, '10.11.0.4')
    const res = await post(token, '10.11.0.5')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ queued: false })
    expect(await db.select().from(jobs)).toHaveLength(3)
  })
})
