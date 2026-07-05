import { createMiddleware } from 'hono/factory'
import { getCookie } from 'hono/cookie'
import type { AuthUser } from '@friendtracker/shared'
import { SESSION_COOKIE, sessionUser } from '../auth/session.js'

export type AuthEnv = { Variables: { user: AuthUser | null } }

/** Resolves the session cookie to a user (or null). No DB hit when anonymous. */
export const sessionMiddleware = createMiddleware<AuthEnv>(async (c, next) => {
  const token = getCookie(c, SESSION_COOKIE)
  c.set('user', token ? await sessionUser(token) : null)
  await next()
})
