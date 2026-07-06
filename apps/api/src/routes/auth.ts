import { Hono } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { eq } from 'drizzle-orm'
import type { AuthEnv } from '../middleware/session.js'
import { SESSION_COOKIE, createSession, deleteSession } from '../auth/session.js'
import { db, players, users } from '@friendtracker/db'
import { buildLoginUrl, steam64ToAccountId, verifyAssertion } from '../auth/openid.js'
import { resolveOrigin } from '../auth/origin.js'
import { fetchSteamProfile } from '../auth/profile.js'

const auth = new Hono<AuthEnv>()

auth.get('/me', (c) => c.json({ user: c.get('user') }))

auth.get('/steam/login', (c) => {
  const origin = resolveOrigin(c)
  if (!origin) return c.json({ error: 'Unknown origin' }, 403)
  return c.redirect(buildLoginUrl(origin), 302)
})

auth.get('/steam/return', async (c) => {
  try {
    const origin = resolveOrigin(c)
    if (!origin) return c.json({ error: 'Unknown origin' }, 403)
    const steam64 = await verifyAssertion(new URL(c.req.url), origin)
    if (!steam64) return c.json({ error: 'OpenID verification failed' }, 403)

    const accountId = steam64ToAccountId(steam64)
    const [player] = await db.select().from(players).where(eq(players.id, accountId))
    const profile = await fetchSteamProfile(accountId)
    // Upsert refreshes name/avatar/player link every login, so seeding a
    // player after their first login self-heals on the next one.
    const [user] = await db
      .insert(users)
      .values({
        steamId: steam64,
        playerId: player?.id ?? null,
        name: profile.name,
        avatar: profile.avatar,
      })
      .onConflictDoUpdate({
        target: [users.provider, users.steamId],
        set: { name: profile.name, avatar: profile.avatar, playerId: player?.id ?? null },
      })
      .returning()

    const { token, expiresAt } = await createSession(user.id)
    setCookie(c, SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'Lax',
      path: '/',
      secure: origin.startsWith('https://'),
      expires: expiresAt,
    })
    return c.redirect('/', 302)
  } catch (err) {
    console.error('Route error:', err)
    return c.json({ error: 'Internal server error' }, 500)
  }
})

auth.post('/logout', async (c) => {
  try {
    const token = getCookie(c, SESSION_COOKIE)
    if (token) await deleteSession(token)
    deleteCookie(c, SESSION_COOKIE, { path: '/' })
    return c.json({ ok: true })
  } catch (err) {
    console.error('Route error:', err)
    return c.json({ error: 'Internal server error' }, 500)
  }
})

export default auth
