import { describe, it, expect, afterAll } from 'vitest'
import { app } from '../apps/api/src/app.js'
import { db, pool, users } from '../apps/api/src/db/index.js'
import { createSession, hashToken, sessionUser } from '../apps/api/src/auth/session.js'
import { sessions } from '../apps/api/src/db/index.js'
import { eq } from 'drizzle-orm'

afterAll(async () => {
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
      headers: { cookie: `session=${token}`, 'x-real-ip': '10.5.0.5' },
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(res.headers.get('set-cookie')).toContain('session=;')
    expect(await sessionUser(token)).toBeNull()
  })

  it('is a no-op without a cookie', async () => {
    const res = await app.request('/api/auth/logout', {
      method: 'POST',
      headers: { 'x-real-ip': '10.5.0.6' },
    })
    expect(res.status).toBe(200)
  })
})
