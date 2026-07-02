import { describe, it, expect, afterAll } from 'vitest'
import { app } from '../apps/api/src/app.js'
import { pool } from '../apps/api/src/db/index.js'

// The app-level pool (created on import with the test DATABASE_URL from
// vitest.config env) must be closed or vitest hangs on exit.
afterAll(async () => {
  await pool.end()
})

describe('GET /api/health', () => {
  it('returns ok', async () => {
    const res = await app.request('/api/health')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })
})

describe('GET /api/config', () => {
  it('lists the seeded players', async () => {
    const res = await app.request('/api/config')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.players.map((p: { id: string }) => p.id).sort()).toEqual(['111', '222'])
    expect(body.siteName).toBe('FriendTracker')
  })
})

describe('GET /api/meta', () => {
  it('aggregates matches per hero+role', async () => {
    const res = await app.request('/api/meta')
    expect(res.status).toBe(200)
    const body = await res.json()
    const am = body.find((r: { heroSlug: string }) => r.heroSlug === 'antimage')
    expect(am).toMatchObject({ matches: 2, wins: 1, role: 'carry', winRate: 50 })
  })

  it('filters by players', async () => {
    const res = await app.request('/api/meta?players=222')
    const body = await res.json()
    expect(body).toHaveLength(1)
    expect(body[0]).toMatchObject({ heroSlug: 'axe', matches: 1, role: 'offlane' })
  })

  it('filters by role', async () => {
    const res = await app.request('/api/meta?role=carry')
    const body = await res.json()
    expect(body).toHaveLength(1)
    expect(body[0].heroSlug).toBe('antimage')
  })

  it('rejects an all-invalid players param with 400', async () => {
    const res = await app.request('/api/meta?players=abc,def')
    expect(res.status).toBe(400)
  })

  it('rejects an invalid role with 400', async () => {
    const res = await app.request('/api/meta?role=jungler')
    expect(res.status).toBe(400)
  })
})

describe('GET /api/heroes/:heroSlug', () => {
  it('404s on an unknown hero', async () => {
    const res = await app.request('/api/heroes/nonexistent_hero')
    expect(res.status).toBe(404)
  })

  it('400s on a malformed slug', async () => {
    const res = await app.request('/api/heroes/Not-A-Slug!')
    expect(res.status).toBe(400)
  })

  it('serves a hero with matches but no build row (fallback path)', async () => {
    const res = await app.request('/api/heroes/antimage')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.heroName).toBe('Anti-Mage')
    expect(body.totalMatches).toBe(2)
    expect(body.wins).toBe(1)
    expect(body.roleTabs).toEqual([
      expect.objectContaining({ role: 'carry', matches: 2, winRate: 50 }),
    ])
    expect(body.builds).toEqual([])
  })

  it('honors the players filter in header stats', async () => {
    const res = await app.request('/api/heroes/axe?players=222')
    const body = await res.json()
    expect(body.totalMatches).toBe(1)
    expect(body.wins).toBe(1)
  })
})
