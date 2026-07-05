import { describe, it, expect, afterAll } from 'vitest'
import { eq } from 'drizzle-orm'
import { db, pool, users, sessions } from '../apps/api/src/db/index.js'

afterAll(async () => {
  await pool.end()
})

describe('users/sessions schema', () => {
  it('inserts a user with defaults and links a session', async () => {
    const [user] = await db
      .insert(users)
      .values({ steamId: '76561197960265839', playerId: '111', name: 'Alice' })
      .returning()
    expect(user.provider).toBe('steam')
    expect(user.createdAt).toBeInstanceOf(Date)
    expect(user.playerId).toBe('111')

    await db.insert(sessions).values({
      id: 'a'.repeat(64),
      userId: user.id,
      expiresAt: new Date(Date.now() + 60_000),
    })
    const [session] = await db.select().from(sessions).where(eq(sessions.userId, user.id))
    expect(session.id).toBe('a'.repeat(64))
    expect(session.expiresAt).toBeInstanceOf(Date)
  })

  it('cascades sessions when the user is deleted', async () => {
    const [user] = await db
      .insert(users)
      .values({ steamId: '76561197960265950' })
      .returning()
    await db.insert(sessions).values({
      id: 'b'.repeat(64),
      userId: user.id,
      expiresAt: new Date(Date.now() + 60_000),
    })
    await db.delete(users).where(eq(users.id, user.id))
    const rows = await db.select().from(sessions).where(eq(sessions.id, 'b'.repeat(64)))
    expect(rows).toEqual([])
  })
})
