const base = typeof import.meta.env.VITE_API_URL === 'string'
  ? import.meta.env.VITE_API_URL
  : ''

export async function useApi<T>(path: string, query?: Record<string, string>): Promise<T> {
  const url = new URL(path, base || window.location.origin)
  if (query) {
    Object.entries(query).forEach(([k, v]) => url.searchParams.set(k, v))
  }
  const res = await fetch(url.toString())
  if (!res.ok) {
    throw new Error(`API ${res.status}: ${path}`)
  }
  return res.json() as Promise<T>
}
