/** OpenDota profile lookup. Never throws — login must not depend on OpenDota. */
export async function fetchSteamProfile(
  accountId: string
): Promise<{ name: string; avatar: string | null }> {
  const base = process.env.OPENDOTA_URL ?? 'https://api.opendota.com/api'
  try {
    const res = await fetch(`${base}/players/${accountId}`, {
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) throw new Error(`OpenDota ${res.status}`)
    const data = (await res.json()) as {
      profile?: { personaname?: string; avatarfull?: string }
    }
    return {
      name: data.profile?.personaname ?? `Player ${accountId}`,
      avatar: data.profile?.avatarfull ?? null,
    }
  } catch {
    return { name: `Player ${accountId}`, avatar: null }
  }
}
