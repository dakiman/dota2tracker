import { Hono } from 'hono'
import { deleteCookie, getCookie } from 'hono/cookie'
import type { AuthEnv } from '../middleware/session.js'
import { SESSION_COOKIE, deleteSession } from '../auth/session.js'

const auth = new Hono<AuthEnv>()

auth.get('/me', (c) => c.json({ user: c.get('user') }))

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
