const base = typeof import.meta.env.VITE_API_URL === 'string'
  ? import.meta.env.VITE_API_URL
  : ''

/** Thrown for every useApi failure. status is the HTTP status, 0 for timeout/network. */
export class ApiError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message)
    this.name = 'ApiError'
  }
}

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
      throw new ApiError(`API ${res.status}: ${path}`, res.status)
    }
    return await res.json() as T
  } catch (e) {
    if (e instanceof ApiError) throw e
    if (e instanceof DOMException && e.name === 'AbortError') {
      throw new ApiError(`Request timeout: ${path}`, 0)
    }
    throw new ApiError(`Network error: ${path}`, 0)
  } finally {
    clearTimeout(timeoutId)
  }
}
