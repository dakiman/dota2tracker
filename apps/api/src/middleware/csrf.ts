import { createMiddleware } from 'hono/factory'
import { allowedOrigins } from '../auth/origin.js'

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/**
 * CSRF defense-in-depth over the SameSite=Lax session cookie: mutating
 * requests must carry an Origin header matching the ALLOWED_ORIGINS
 * allowlist. Missing Origin rejects — every modern browser sends it on
 * cross- AND same-origin POSTs.
 */
export const csrfMiddleware = createMiddleware(async (c, next) => {
  if (MUTATING.has(c.req.method)) {
    const origin = c.req.header('origin')
    if (!origin || !allowedOrigins().includes(origin)) {
      return c.json({ error: 'Invalid origin' }, 403)
    }
  }
  await next()
})
