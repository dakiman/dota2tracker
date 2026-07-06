import { createMiddleware } from 'hono/factory'
import type { AuthEnv } from './session.js'

/** 401 unless a session user is on the context. */
export const requireAuth = createMiddleware<AuthEnv>(async (c, next) => {
  if (!c.get('user')) return c.json({ error: 'Unauthorized' }, 401)
  await next()
})

/** 401 anonymous, 403 signed-in non-admin. */
export const requireAdmin = createMiddleware<AuthEnv>(async (c, next) => {
  const user = c.get('user')
  if (!user) return c.json({ error: 'Unauthorized' }, 401)
  if (!user.isAdmin) return c.json({ error: 'Forbidden' }, 403)
  await next()
})
