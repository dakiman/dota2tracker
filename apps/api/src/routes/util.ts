/**
 * Parse/validate the `players` query param shared by the meta, heroes,
 * matches, and together routes.
 *
 * - absent or empty param -> null (no filter)
 * - present but yielding no valid IDs -> 'invalid' (caller responds 400
 *   rather than silently dropping the filter and returning everyone)
 * - otherwise 1-50 digit-string account IDs
 */
export function parsePlayersParam(
  playersParam: string | undefined
): string[] | null | 'invalid' {
  if (!playersParam) return null
  const ids = playersParam
    .split(',')
    .map((s) => s.trim())
    .filter((id) => /^\d+$/.test(id))
    .slice(0, 50)
  return ids.length === 0 ? 'invalid' : ids
}
