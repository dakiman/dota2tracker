const base = typeof import.meta.env.VITE_API_URL === 'string'
  ? import.meta.env.VITE_API_URL
  : ''

export async function useApi<T>(path: string, query?: Record<string, string>): Promise<T> {
  const url = new URL(path, base || window.location.origin)
  if (query) {
    Object.entries(query).forEach(([k, v]) => url.searchParams.set(k, v))
  }
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 15000)
  try {
    const res = await fetch(url.toString(), { signal: controller.signal })
    if (!res.ok) {
      throw new Error(`API ${res.status}: ${path}`)
    }
    return await res.json() as T
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') {
      throw new Error(`Request timeout: ${path}`)
    }
    throw e
  } finally {
    clearTimeout(timeoutId)
  }
}
