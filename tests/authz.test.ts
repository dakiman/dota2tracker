import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Hono } from 'hono'
import { app } from '../apps/api/src/app.js'
import { db, pool, users } from '@friendtracker/db'
import { createSession } from '../apps/api/src/auth/session.js'
import { sessionMiddleware, type AuthEnv } from '../apps/api/src/middleware/session.js'
import { requireAuth, requireAdmin } from '../apps/api/src/middleware/authz.js'

const ADMIN_STEAM64 = '76561197960266333'

beforeAll(() => {
  // Whitespace-tolerant parsing is part of the contract
  process.env.ADMIN_STEAM_IDS = ` ${ADMIN_STEAM64}, `
})

afterAll(async () => {
  delete process.env.ADMIN_STEAM_IDS
  await pool.end()
})

function guardApp() {
  const a = new Hono<AuthEnv>()
  a.use('*', sessionMiddleware)
  a.get('/auth', requireAuth, (c) => c.json({ ok: true }))
  a.get('/admin', requireAdmin, (c) => c.json({ ok: true }))
  return a
}

async function sessionFor(steamId: string): Promise<string> {
  const [user] = await db
    .insert(users)
    .values({ steamId, name: 'Guard Tester' })
    .onConflictDoUpdate({
      target: [users.provider, users.steamId],
      set: { name: 'Guard Tester' },
    })
    .returning()
  const { token } = await createSession(user.id)
  return token
}

describe('requireAuth / requireAdmin', () => {
  it('401s anonymous requests', async () => {
    const a = guardApp()
    expect((await a.request('/auth')).status).toBe(401)
    expect((await a.request('/admin')).status).toBe(401)
  })

  it('lets a signed-in user through requireAuth but 403s requireAdmin', async () => {
    const token = await sessionFor('76561197960266334')
    const a = guardApp()
    const headers = { cookie: `session=${token}` }
    expect((await a.request('/auth', { headers })).status).toBe(200)
    expect((await a.request('/admin', { headers })).status).toBe(403)
  })

  it('lets an ADMIN_STEAM_IDS user through requireAdmin', async () => {
    const token = await sessionFor(ADMIN_STEAM64)
    const a = guardApp()
    expect((await a.request('/admin', { headers: { cookie: `session=${token}` } })).status).toBe(200)
  })
})

describe('isAdmin on /api/auth/me', () => {
  it('is false for a user outside ADMIN_STEAM_IDS', async () => {
    const token = await sessionFor('76561197960266335')
    const res = await app.request('/api/auth/me', {
      headers: { cookie: `session=${token}`, 'x-real-ip': '10.8.0.1' },
    })
    expect((await res.json()).user.isAdmin).toBe(false)
  })

  it('is true for an ADMIN_STEAM_IDS user', async () => {
    const token = await sessionFor(ADMIN_STEAM64)
    const res = await app.request('/api/auth/me', {
      headers: { cookie: `session=${token}`, 'x-real-ip': '10.8.0.2' },
    })
    expect((await res.json()).user.isAdmin).toBe(true)
  })
})
