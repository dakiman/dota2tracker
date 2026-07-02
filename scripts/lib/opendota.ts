/**
 * Shared OpenDota fetch helper. Handles 429 rate limiting with retry-after so a
 * single throttle mid-run doesn't abort the whole (idempotent but slow) script.
 */

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(url, init)
    if (res.status === 429) {
      const retryAfter = Number(res.headers.get('retry-after')) || 60
      console.log(`    Rate limited, sleeping ${retryAfter}s before retry...`)
      await sleep(retryAfter * 1000)
      continue
    }
    if (!res.ok) throw new Error(`OpenDota ${res.status}: ${url}`)
    return res.json() as Promise<T>
  }
  throw new Error(`OpenDota: gave up after 5 retries on ${url}`)
}
