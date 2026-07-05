import type { Context } from 'hono'

const DEFAULT_ORIGINS = 'http://localhost:5173,http://localhost:3000'

/** Full origins (scheme://host[:port]) allowed to initiate Steam login. */
export function allowedOrigins(): string[] {
  return (process.env.ALLOWED_ORIGINS ?? DEFAULT_ORIGINS)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

/**
 * Resolve the request's origin by matching the Host header against the
 * allowlist. The scheme comes from the allowlist entry — NOT from
 * X-Forwarded-Proto — so a TLS-terminating tunnel upstream of plain-http
 * nginx still yields the correct https realm. Unknown Host → null (403).
 */
export function resolveOrigin(c: Context): string | null {
  const host = c.req.header('host')
  if (!host) return null
  return allowedOrigins().find((o) => new URL(o).host === host) ?? null
}
