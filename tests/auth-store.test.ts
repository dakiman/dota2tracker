import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useAuthStore } from '../apps/web/src/stores/auth'

beforeEach(() => {
  setActivePinia(createPinia())
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const ME = { id: 1, steamId: '76561197960265839', playerId: '111', name: 'Alice', avatar: null }

describe('auth store', () => {
  it('load() populates user from /api/auth/me', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ user: ME }), { status: 200 }))
    )
    const auth = useAuthStore()
    await auth.load()
    expect(auth.user).toEqual(ME)
  })

  it('load() is memoized (one fetch for two calls)', async () => {
    const spy = vi.fn(async () => new Response(JSON.stringify({ user: null }), { status: 200 }))
    vi.stubGlobal('fetch', spy)
    const auth = useAuthStore()
    await Promise.all([auth.load(), auth.load()])
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('load() failure leaves user null', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 500 })))
    const auth = useAuthStore()
    await auth.load()
    expect(auth.user).toBeNull()
  })

  it('logout() POSTs and clears the user', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }))
    )
    const auth = useAuthStore()
    auth.user = ME
    await auth.logout()
    expect(auth.user).toBeNull()
    expect(vi.mocked(fetch).mock.calls[0][1]).toMatchObject({ method: 'POST' })
  })

  it('refresh() drops the memo and refetches', async () => {
    const spy = vi.fn(async () => new Response(JSON.stringify({ user: null }), { status: 200 }))
    vi.stubGlobal('fetch', spy)
    const auth = useAuthStore()
    await auth.load()
    await auth.refresh()
    expect(spy).toHaveBeenCalledTimes(2)
  })
})
