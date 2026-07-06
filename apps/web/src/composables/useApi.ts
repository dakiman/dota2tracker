const base = typeof import.meta.env.VITE_API_URL === 'string'
  ? import.meta.env.VITE_API_URL
  : ''

/** Thrown for every useApi failure. status is the HTTP status, 0 for timeout/network.
 *  data carries the parsed error payload when the server sent JSON. */
export class ApiError extends Error {
  constructor(message: string, public readonly status: number, public readonly data?: unknown) {
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

/** POST JSON (or an empty body) to the API. Error payloads land on ApiError.data. */
export async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  const url = new URL(path, base || window.location.origin)
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 15000)
  try {
    const res = await fetch(url.toString(), {
      method: 'POST',
      ...(body !== undefined && {
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
      signal: controller.signal,
    })
    const data: unknown = await res.json().catch(() => undefined)
    if (!res.ok) {
      throw new ApiError(`API ${res.status}: ${path}`, res.status, data)
    }
    return data as T
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
