import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { db, players, users } from '@friendtracker/db'
import { enqueue } from '@friendtracker/pipeline'
import type { AuthEnv } from '../middleware/session.js'
import { requireAuth } from '../middleware/authz.js'
import { steam64ToAccountId, STEAM64_BASE } from '../auth/openid.js'
import { checkAccount } from '../players/validate.js'

const playersRoute = new Hono<AuthEnv>()

playersRoute.post('/', requireAuth, async (c) => {
  try {
    const user = c.get('user')!
    const body = (await c.req.json().catch(() => ({}))) as { accountId?: string }
    const raw = typeof body.accountId === 'string' ? body.accountId.trim() : ''
    const selfAccountId = steam64ToAccountId(user.steamId)

    let accountId = selfAccountId
    if (raw) {
      if (!/^\d{1,20}$/.test(raw)) return c.json({ error: 'invalid_account_id' }, 400)
      // Accept bare account ids and steam64s; normalize the latter
      accountId = BigInt(raw) >= STEAM64_BASE ? steam64ToAccountId(raw) : raw
    }
    // Self-service: your own account needs no privilege (ownership proven
    // by Steam login). Anyone else's requires admin.
    if (accountId !== selfAccountId && !user.isAdmin) {
      return c.json({ error: 'forbidden' }, 403)
    }

    const [existing] = await db.select().from(players).where(eq(players.id, accountId))
    if (existing) return c.json({ error: 'already_tracked' }, 409)

    const check = await checkAccount(accountId)
    if (check === 'unavailable') return c.json({ error: 'opendota_unavailable' }, 503)
    if (check === 'not_found') return c.json({ error: 'account_not_found' }, 404)
    if (!check.hasMatches) {
      return c.json({ error: 'no_public_data', name: check.name, avatar: check.avatar }, 422)
    }

    const [player] = await db
      .insert(players)
      .values({ id: accountId, name: check.name, avatar: check.avatar })
      .returning()
    if (accountId === selfAccountId) {
      // Mirror the login upsert so /api/auth/me reflects the link immediately
      await db.update(users).set({ playerId: accountId }).where(eq(users.id, user.id))
    }
    await enqueue([{ type: 'fetch-player', payload: { playerId: accountId } }])
    return c.json({ player }, 201)
  } catch (err) {
    console.error('Route error:', err)
    return c.json({ error: 'Internal server error' }, 500)
  }
})

export default playersRoute
