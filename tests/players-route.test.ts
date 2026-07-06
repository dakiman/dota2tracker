import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { createServer, type Server } from 'node:http'
import { eq } from 'drizzle-orm'
import { db, pool, jobs, players, users } from '@friendtracker/db'
import { app } from '../apps/api/src/app.js'
import { createSession } from '../apps/api/src/auth/session.js'

const ORIGIN = 'http://localhost:5173'
const ADMIN_STEAM64 = '76561197960266337'
// accountId 501 / 502 / 506 ⇔ steam64 base + n
const SELF_STEAM64 = '76561197960266229' // account 501
const PRIVATE_STEAM64 = '76561197960266230' // account 502
const STEAM64_INPUT = '76561197960266234' // account 506

let mock: Server

beforeAll(async () => {
  process.env.ADMIN_STEAM_IDS = ADMIN_STEAM64
  mock = createServer((req, res) => {
    const url = req.url ?? ''
    res.setHeader('content-type', 'application/json')
    if (url.includes('/players/504')) {
      res.statusCode = 500
      res.end('{}')
      return
    }
    const matches = /\/players\/(\d+)\/matches/.exec(url)
    if (matches) {
      res.end(matches[1] === '502' ? '[]' : JSON.stringify([{ match_id: 1 }]))
      return
    }
    const profile = /\/players\/(\d+)/.exec(url)
    if (profile && profile[1] === '503') {
      res.end(JSON.stringify({ error: 'Not Found' }))
      return
    }
    res.end(
      JSON.stringify({
        profile: { personaname: `Mock ${profile?.[1]}`, avatarfull: 'https://a.example/p.jpg' },
      })
    )
  })
  await new Promise<void>((resolve) => mock.listen(0, '127.0.0.1', resolve))
  const addr = mock.address()
  if (typeof addr === 'object' && addr) {
    process.env.OPENDOTA_URL = `http://127.0.0.1:${addr.port}`
  }
})

afterAll(async () => {
  delete process.env.ADMIN_STEAM_IDS
  delete process.env.OPENDOTA_URL
  await db.delete(players).where(eq(players.id, '501'))
  await db.delete(players).where(eq(players.id, '506'))
  await new Promise((resolve) => mock.close(resolve))
  await pool.end()
})

beforeEach(async () => {
  await db.delete(jobs)
})

async function sessionFor(steamId: string): Promise<string> {
  const [user] = await db
    .insert(users)
    .values({ steamId, name: 'Adder' })
    .onConflictDoUpdate({ target: [users.provider, users.steamId], set: { name: 'Adder' } })
    .returning()
  const { token } = await createSession(user.id)
  return token
}

function post(token: string | null, ip: string, body?: unknown) {
  return app.request('/api/players', {
    method: 'POST',
    headers: {
      origin: ORIGIN,
      'x-real-ip': ip,
      ...(token ? { cookie: `session=${token}` } : {}),
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
}

describe('POST /api/players', () => {
  it('401s anonymous requests', async () => {
    expect((await post(null, '10.10.0.1')).status).toBe(401)
  })

  it('self-add: 201, players row, users.playerId link, fetch-player job', async () => {
    const token = await sessionFor(SELF_STEAM64)
    const res = await post(token, '10.10.0.2')
    expect(res.status).toBe(201)
    const { player } = await res.json()
    expect(player).toMatchObject({ id: '501', name: 'Mock 501', avatar: 'https://a.example/p.jpg' })
    const [row] = await db.select().from(players).where(eq(players.id, '501'))
    expect(row).toBeDefined()
    const [user] = await db.select().from(users).where(eq(users.steamId, SELF_STEAM64))
    expect(user.playerId).toBe('501')
    const jobRows = await db.select().from(jobs)
    expect(jobRows).toHaveLength(1)
    expect(jobRows[0]).toMatchObject({ type: 'fetch-player', status: 'pending', payload: { playerId: '501' } })
  })

  it('re-add: 409 already_tracked, no job enqueued', async () => {
    const token = await sessionFor(SELF_STEAM64)
    const res = await post(token, '10.10.0.3')
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('already_tracked')
    expect(await db.select().from(jobs)).toHaveLength(0)
  })

  it('private account: 422 no_public_data with the profile name, nothing persisted', async () => {
    const token = await sessionFor(PRIVATE_STEAM64)
    const res = await post(token, '10.10.0.4')
    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body).toEqual({ error: 'no_public_data', name: 'Mock 502', avatar: 'https://a.example/p.jpg' })
    expect(await db.select().from(players).where(eq(players.id, '502'))).toEqual([])
    expect(await db.select().from(jobs)).toHaveLength(0)
  })

  it('non-admin adding someone else: 403 before any OpenDota call', async () => {
    const token = await sessionFor(SELF_STEAM64)
    const res = await post(token, '10.10.0.5', { accountId: '503' })
    expect(res.status).toBe(403)
  })

  it('admin add of a nonexistent account: 404', async () => {
    const token = await sessionFor(ADMIN_STEAM64)
    const res = await post(token, '10.10.0.6', { accountId: '503' })
    expect(res.status).toBe(404)
    expect((await res.json()).error).toBe('account_not_found')
  })

  it('admin add with non-numeric input: 400', async () => {
    const token = await sessionFor(ADMIN_STEAM64)
    const res = await post(token, '10.10.0.7', { accountId: 'abc' })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('invalid_account_id')
  })

  it('admin add accepts steam64 input and normalizes it', async () => {
    const token = await sessionFor(ADMIN_STEAM64)
    const res = await post(token, '10.10.0.8', { accountId: STEAM64_INPUT })
    expect(res.status).toBe(201)
    const [row] = await db.select().from(players).where(eq(players.id, '506'))
    expect(row.name).toBe('Mock 506')
    // Admin added someone else — admin's own users.playerId stays null
    const [admin] = await db.select().from(users).where(eq(users.steamId, ADMIN_STEAM64))
    expect(admin.playerId).toBeNull()
  })

  it('OpenDota down: 503 fail-closed', async () => {
    const token = await sessionFor(ADMIN_STEAM64)
    const res = await post(token, '10.10.0.9', { accountId: '504' })
    expect(res.status).toBe(503)
    expect((await res.json()).error).toBe('opendota_unavailable')
  })
})
