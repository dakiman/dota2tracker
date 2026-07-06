/**
 * OpenDota account validation for POST /api/players. Discriminators
 * verified empirically 2026-07-05:
 *   - /players/{id} → {"error":"Not Found"} ⇒ account doesn't exist
 *   - profile present but /matches → [] ⇒ exists, no public match data
 *     (a brand-new zero-game account looks identical — UI copy covers both;
 *     `fh_unavailable` is NOT a discriminator, it's true for public accounts)
 * Network errors / 5xx ⇒ 'unavailable' — validation fails closed.
 */
export type AccountCheck =
  | 'not_found'
  | 'unavailable'
  | { name: string; avatar: string | null; hasMatches: boolean }

export async function checkAccount(accountId: string): Promise<AccountCheck> {
  const base = process.env.OPENDOTA_URL ?? 'https://api.opendota.com/api'
  try {
    const res = await fetch(`${base}/players/${accountId}`, {
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok && res.status !== 404) return 'unavailable'
    const data = (await res.json()) as {
      error?: string
      profile?: { personaname?: string; avatarfull?: string }
    }
    if (data.error || !data.profile) return 'not_found'

    const matchesRes = await fetch(`${base}/players/${accountId}/matches?project=match_id&limit=1`, {
      signal: AbortSignal.timeout(10_000),
    })
    if (!matchesRes.ok) return 'unavailable'
    const matches = (await matchesRes.json()) as unknown[]
    return {
      name: data.profile.personaname ?? `Player ${accountId}`,
      avatar: data.profile.avatarfull ?? null,
      hasMatches: matches.length > 0,
    }
  } catch {
    return 'unavailable'
  }
}
