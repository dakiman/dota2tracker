import { describe, it, expect, vi, afterEach } from 'vitest'
import { useApi, ApiError } from '../apps/web/src/composables/useApi'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useApi', () => {
  it('returns parsed JSON on success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }))
    )
    await expect(useApi('/api/health')).resolves.toEqual({ ok: true })
  })

  it('throws ApiError carrying the HTTP status on non-OK responses', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 404 })))
    const err = await useApi('/api/heroes/nope').catch((e) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).status).toBe(404)
  })

  it('throws ApiError with status 0 on network failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed')
      })
    )
    const err = await useApi('/api/meta').catch((e) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).status).toBe(0)
  })
})
