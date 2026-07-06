import { describe, it, expect, afterAll, beforeAll } from 'vitest'
import { createServer, type Server } from 'node:http'
import { app } from '../apps/api/src/app.js'
import { db, pool, users } from '@friendtracker/db'
import { createSession, hashToken, sessionUser } from '../apps/api/src/auth/session.js'
import { sessions } from '@friendtracker/db'
import { eq } from 'drizzle-orm'

let mock: Server
let openidValid = true

beforeAll(async () => {
  mock = createServer((req, res) => {
    if (req.method === 'POST') {
      let body = ''
      req.on('data', (c) => (body += c))
      req.on('end', () => {
        res.setHeader('content-type', 'text/plain')
        res.end(`ns:http://specs.openid.net/auth/2.0\nis_valid:${openidValid}\n`)
      })
      return
    }
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ profile: { personaname: 'MockPersona', avatarfull: 'https://a.example/x.jpg' } }))
  })
  await new Promise<void>((resolve) => mock.listen(0, '127.0.0.1', resolve))
  const addr = mock.address()
  if (typeof addr === 'object' && addr) {
    process.env.OPENID_ENDPOINT = `http://127.0.0.1:${addr.port}/openid/login`
    process.env.OPENDOTA_URL = `http://127.0.0.1:${addr.port}`
  }
})

afterAll(async () => {
  delete process.env.OPENID_ENDPOINT
  delete process.env.OPENDOTA_URL
  await new Promise((resolve) => mock.close(resolve))
  await pool.end()
})

async function makeUser(steamId: string) {
  const [user] = await db
    .insert(users)
    .values({ steamId, playerId: null, name: 'Session Tester', avatar: null })
    .returning()
  return user
}

describe('session middleware + /api/auth/me', () => {
  it('returns user null without a cookie', async () => {
    const res = await app.request('/api/auth/me', { headers: { 'x-real-ip': '10.5.0.1' } })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ user: null })
  })

  it('returns the user for a valid session cookie', async () => {
    const user = await makeUser('76561197960270001')
    const { token } = await createSession(user.id)
    const res = await app.request('/api/auth/me', {
      headers: { cookie: `session=${token}`, 'x-real-ip': '10.5.0.2' },
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.user).toEqual({
      id: user.id,
      steamId: '76561197960270001',
      playerId: null,
      name: 'Session Tester',
      avatar: null,
      isAdmin: false,
    })
  })

  it('returns user null for a garbage token', async () => {
    const res = await app.request('/api/auth/me', {
      headers: { cookie: 'session=not-a-real-token', 'x-real-ip': '10.5.0.3' },
    })
    expect((await res.json()).user).toBeNull()
  })

  it('returns user null for an expired session', async () => {
    const user = await makeUser('76561197960270002')
    const { token } = await createSession(user.id)
    await db
      .update(sessions)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(sessions.id, hashToken(token)))
    const res = await app.request('/api/auth/me', {
      headers: { cookie: `session=${token}`, 'x-real-ip': '10.5.0.4' },
    })
    expect((await res.json()).user).toBeNull()
  })

  it('stores only the token hash at rest', async () => {
    const user = await makeUser('76561197960270003')
    const { token } = await createSession(user.id)
    const rows = await db.select().from(sessions).where(eq(sessions.userId, user.id))
    expect(rows).toHaveLength(1)
    expect(rows[0].id).not.toBe(token)
    expect(rows[0].id).toBe(hashToken(token))
  })
})

describe('POST /api/auth/logout', () => {
  it('deletes the session and expires the cookie', async () => {
    const user = await makeUser('76561197960270004')
    const { token } = await createSession(user.id)
    const res = await app.request('/api/auth/logout', {
      method: 'POST',
      headers: { cookie: `session=${token}`, 'x-real-ip': '10.5.0.5', origin: 'http://localhost:5173' },
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(res.headers.get('set-cookie')).toContain('session=;')
    expect(await sessionUser(token)).toBeNull()
  })

  it('is a no-op without a cookie', async () => {
    const res = await app.request('/api/auth/logout', {
      method: 'POST',
      headers: { 'x-real-ip': '10.5.0.6', origin: 'http://localhost:5173' },
    })
    expect(res.status).toBe(200)
  })
})

const ORIGIN = 'http://localhost:5173'

function assertionQuery(steam64: string): string {
  return new URLSearchParams({
    'openid.ns': 'http://specs.openid.net/auth/2.0',
    'openid.mode': 'id_res',
    'openid.op_endpoint': 'https://steamcommunity.com/openid/login',
    'openid.claimed_id': `https://steamcommunity.com/openid/id/${steam64}`,
    'openid.identity': `https://steamcommunity.com/openid/id/${steam64}`,
    'openid.return_to': `${ORIGIN}/api/auth/steam/return`,
    'openid.response_nonce': '2026-07-05T00:00:00Zdef',
    'openid.assoc_handle': 'h1',
    'openid.signed': 'signed,op_endpoint,claimed_id,identity,return_to,response_nonce,assoc_handle',
    'openid.sig': 'ZmFrZXNpZw==',
  }).toString()
}

describe('GET /api/auth/steam/login', () => {
  it('302s to the OpenID endpoint with realm/return_to for the allowlisted Host', async () => {
    const res = await app.request('/api/auth/steam/login', {
      headers: { host: 'localhost:5173', 'x-real-ip': '10.6.0.1' },
    })
    expect(res.status).toBe(302)
    const loc = new URL(res.headers.get('location')!)
    expect(loc.searchParams.get('openid.realm')).toBe(ORIGIN)
    expect(loc.searchParams.get('openid.return_to')).toBe(`${ORIGIN}/api/auth/steam/return`)
  })

  it('403s for a Host not in the allowlist', async () => {
    const res = await app.request('/api/auth/steam/login', {
      headers: { host: 'evil.example', 'x-real-ip': '10.6.0.2' },
    })
    expect(res.status).toBe(403)
  })
})

describe('GET /api/auth/steam/return', () => {
  it('creates a user linked to the matching players row and sets the session cookie', async () => {
    openidValid = true
    // steam64 76561197960265839 ⇔ seeded player 111
    const res = await app.request(`/api/auth/steam/return?${assertionQuery('76561197960265839')}`, {
      headers: { host: 'localhost:5173', 'x-real-ip': '10.6.0.3' },
    })
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('/')
    const setCookie = res.headers.get('set-cookie')!
    expect(setCookie).toContain('session=')
    expect(setCookie).toContain('HttpOnly')
    expect(setCookie.toLowerCase()).not.toContain('secure') // http origin

    const [user] = await db.select().from(users).where(eq(users.steamId, '76561197960265839'))
    expect(user.playerId).toBe('111')
    expect(user.name).toBe('MockPersona')

    const token = /session=([^;]+)/.exec(setCookie)![1]
    const me = await app.request('/api/auth/me', {
      headers: { cookie: `session=${token}`, 'x-real-ip': '10.6.0.3' },
    })
    expect((await me.json()).user.playerId).toBe('111')
  })

  it('upserts on repeat login (no duplicate user, fresh session)', async () => {
    openidValid = true
    await app.request(`/api/auth/steam/return?${assertionQuery('76561197960265839')}`, {
      headers: { host: 'localhost:5173', 'x-real-ip': '10.6.0.4' },
    })
    const rows = await db.select().from(users).where(eq(users.steamId, '76561197960265839'))
    expect(rows).toHaveLength(1)
  })

  it('links no player for an untracked steam64', async () => {
    openidValid = true
    // account 999 is not in players
    const res = await app.request(`/api/auth/steam/return?${assertionQuery('76561197960266727')}`, {
      headers: { host: 'localhost:5173', 'x-real-ip': '10.6.0.5' },
    })
    expect(res.status).toBe(302)
    const [user] = await db.select().from(users).where(eq(users.steamId, '76561197960266727'))
    expect(user.playerId).toBeNull()
  })

  it('403s when Steam rejects the assertion and creates no user', async () => {
    openidValid = false
    const res = await app.request(`/api/auth/steam/return?${assertionQuery('76561197960266838')}`, {
      headers: { host: 'localhost:5173', 'x-real-ip': '10.6.0.6' },
    })
    expect(res.status).toBe(403)
    const rows = await db.select().from(users).where(eq(users.steamId, '76561197960266838'))
    expect(rows).toEqual([])
    openidValid = true
  })

  it('403s for a Host not in the allowlist', async () => {
    const res = await app.request(`/api/auth/steam/return?${assertionQuery('76561197960265839')}`, {
      headers: { host: 'evil.example', 'x-real-ip': '10.6.0.7' },
    })
    expect(res.status).toBe(403)
  })
})
