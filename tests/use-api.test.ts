import { describe, it, expect, vi, afterEach } from 'vitest'
import { useApi, apiPost, ApiError } from '../apps/web/src/composables/useApi'

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

describe('apiPost', () => {
  it('sends a JSON body and returns the parsed response', async () => {
    const spy = vi.fn(async () => new Response(JSON.stringify({ player: { id: '1' } }), { status: 201 }))
    vi.stubGlobal('fetch', spy)
    await expect(apiPost('/api/players', { accountId: '42' })).resolves.toEqual({ player: { id: '1' } })
    const [, init] = spy.mock.calls[0] as unknown as [string, RequestInit]
    expect(init.method).toBe('POST')
    expect(init.body).toBe(JSON.stringify({ accountId: '42' }))
    expect(init.headers).toMatchObject({ 'content-type': 'application/json' })
  })

  it('sends no body or content-type when body is omitted', async () => {
    const spy = vi.fn(async () => new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', spy)
    await apiPost('/api/players')
    const [, init] = spy.mock.calls[0] as unknown as [string, RequestInit]
    expect(init.body).toBeUndefined()
  })

  it('surfaces the error payload on ApiError.data', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: 'no_public_data', name: 'chiPe' }), { status: 422 }))
    )
    const err = await apiPost('/api/players').catch((e) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).status).toBe(422)
    expect((err as ApiError).data).toEqual({ error: 'no_public_data', name: 'chiPe' })
  })
})
