import { createMiddleware } from 'hono/factory'
import { getConnInfo } from '@hono/node-server/conninfo'

/**
 * Fixed-window in-memory rate limiter. Deliberately dependency-free: the
 * API is single-process (no Redis, ever), so a Map is the whole store.
 * Keyed by X-Real-IP (set by nginx) → socket address → 'unknown'.
 * Lazy sweep instead of a timer, so there is nothing to stop on shutdown.
 */
export function rateLimit(opts: { windowMs: number; max: number; now?: () => number }) {
  const hits = new Map<string, { count: number; resetAt: number }>()
  return createMiddleware(async (c, next) => {
    const now = (opts.now ?? Date.now)()
    let key = c.req.header('x-real-ip')
    if (!key) {
      try {
        key = getConnInfo(c).remote.address ?? 'unknown'
      } catch {
        key = 'unknown' // app.request() in tests has no socket
      }
    }
    if (hits.size > 10_000) {
      for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k)
    }
    const entry = hits.get(key)
    if (!entry || entry.resetAt <= now) {
      hits.set(key, { count: 1, resetAt: now + opts.windowMs })
    } else if (++entry.count > opts.max) {
      c.header('Retry-After', String(Math.ceil((entry.resetAt - now) / 1000)))
      return c.json({ error: 'Too many requests' }, 429)
    }
    await next()
  })
}
