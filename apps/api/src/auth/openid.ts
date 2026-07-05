/**
 * Hand-rolled Steam OpenID 2.0 (stateless mode). Steam is the only OP.
 * Verification POSTs the assertion back to Steam (check_authentication),
 * which also enforces one-time response nonces — no local replay store.
 */
export const STEAM64_BASE = 76561197960265728n
const STEAM_OPENID = 'https://steamcommunity.com/openid/login'
const OPENID_NS = 'http://specs.openid.net/auth/2.0'

/** steam64 → 32-bit account id (= players.id). BigInt: steam64 exceeds MAX_SAFE_INTEGER. */
export function steam64ToAccountId(steam64: string): string {
  return (BigInt(steam64) - STEAM64_BASE).toString()
}

/** Where to redirect/verify. OPENID_ENDPOINT overrides for tests; read at call time. */
export function openidEndpoint(): string {
  return process.env.OPENID_ENDPOINT ?? STEAM_OPENID
}

export function buildLoginUrl(origin: string): string {
  const p = new URLSearchParams({
    'openid.ns': OPENID_NS,
    'openid.mode': 'checkid_setup',
    'openid.claimed_id': `${OPENID_NS}/identifier_select`,
    'openid.identity': `${OPENID_NS}/identifier_select`,
    'openid.return_to': `${origin}/api/auth/steam/return`,
    // The realm must be a prefix of return_to — true by construction.
    'openid.realm': origin,
  })
  return `${openidEndpoint()}?${p}`
}

/**
 * Verify the assertion Steam redirected back with. Returns the steam64 id
 * or null on any failure.
 */
export async function verifyAssertion(url: URL, origin: string): Promise<string | null> {
  const q = url.searchParams
  if (q.get('openid.mode') !== 'id_res') return null
  // Steam always echoes its real endpoint here — pinned to the literal so a
  // spoofed assertion can't point verification elsewhere.
  if (q.get('openid.op_endpoint') !== STEAM_OPENID) return null
  if (!q.get('openid.return_to')?.startsWith(`${origin}/api/auth/steam/return`)) return null
  const m = /^https:\/\/steamcommunity\.com\/openid\/id\/(\d{17})$/.exec(
    q.get('openid.claimed_id') ?? ''
  )
  if (!m) return null
  // The signature Steam validates must actually cover the fields we rely on.
  const signed = (q.get('openid.signed') ?? '').split(',')
  const required = ['claimed_id', 'return_to', 'response_nonce', 'op_endpoint']
  if (!required.every((f) => signed.includes(f))) return null

  const body = new URLSearchParams()
  for (const [k, v] of q) if (k.startsWith('openid.')) body.set(k, v)
  body.set('openid.mode', 'check_authentication')
  const res = await fetch(openidEndpoint(), {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) return null
  const text = await res.text()
  return /^is_valid\s*:\s*true\s*$/m.test(text) ? m[1] : null
}
