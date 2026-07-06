import { createHash, randomBytes } from 'node:crypto'
import { and, eq, gt } from 'drizzle-orm'
import { db, sessions, users } from '@friendtracker/db'
import type { AuthUser } from '@friendtracker/shared'
import { adminSteamIds } from './admin.js'

export const SESSION_COOKIE = 'session'
export const SESSION_TTL_MS = 30 * 24 * 3600 * 1000
// Sliding expiry, but bump at most once per day per session to bound writes.
const BUMP_THRESHOLD_MS = SESSION_TTL_MS - 24 * 3600 * 1000

/** Sessions are stored keyed by sha256(token) — never the raw bearer token. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export async function createSession(
  userId: number
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString('base64url')
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS)
  await db.insert(sessions).values({ id: hashToken(token), userId, expiresAt })
  return { token, expiresAt }
}

export async function sessionUser(token: string): Promise<AuthUser | null> {
  const id = hashToken(token)
  const [row] = await db
    .select({
      userId: users.id,
      steamId: users.steamId,
      playerId: users.playerId,
      name: users.name,
      avatar: users.avatar,
      expiresAt: sessions.expiresAt,
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(and(eq(sessions.id, id), gt(sessions.expiresAt, new Date())))
  if (!row) return null
  if (row.expiresAt.getTime() - Date.now() < BUMP_THRESHOLD_MS) {
    await db
      .update(sessions)
      .set({ expiresAt: new Date(Date.now() + SESSION_TTL_MS) })
      .where(eq(sessions.id, id))
  }
  return {
    id: row.userId,
    steamId: row.steamId,
    playerId: row.playerId,
    name: row.name,
    avatar: row.avatar,
    isAdmin: adminSteamIds().includes(row.steamId),
  }
}

export async function deleteSession(token: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, hashToken(token)))
}
