import { describe, it, expect, afterAll } from 'vitest'
import { app } from '../apps/api/src/app.js'
import { pool } from '../apps/api/src/db/index.js'

// Seeded by tests/global-setup.ts:
//   match 1001 @ 2026-01-02T10:00Z (epoch 1767348000): 111 won (antimage), 222 won (axe) — same team
//   match 1002 @ 2026-01-01T10:00Z (epoch 1767261600): 111 lost (antimage) — solo

afterAll(async () => {
  await pool.end()
})

describe('GET /api/matches', () => {
  it('groups by match and orders by recency', async () => {
    const res = await app.request('/api/matches')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.matches).toHaveLength(2)
    expect(body.matches[0].matchId).toBe(1001)
    expect(body.matches[0].participants).toHaveLength(2)
    expect(
      body.matches[0].participants.map((p: { playerId: string }) => p.playerId).sort()
    ).toEqual(['111', '222'])
    expect(body.matches[1].matchId).toBe(1002)
    expect(body.nextBefore).toBeNull()
  })

  it('exposes hero, player, and per-player result on participants', async () => {
    const res = await app.request('/api/matches')
    const body = await res.json()
    const alice = body.matches[0].participants.find(
      (p: { playerId: string }) => p.playerId === '111'
    )
    expect(alice).toMatchObject({
      playerName: 'Alice',
      heroSlug: 'antimage',
      heroName: 'Anti-Mage',
      won: true,
      kills: 10,
      deaths: 2,
      assists: 5,
      role: 'carry',
    })
    expect(body.matches[0].startTime).toBe('2026-01-02T10:00:00.000Z')
  })

  it('filters which matches appear but shows all participants', async () => {
    const res = await app.request('/api/matches?players=222')
    const body = await res.json()
    expect(body.matches).toHaveLength(1)
    expect(body.matches[0].matchId).toBe(1001)
    expect(body.matches[0].participants).toHaveLength(2)
  })

  it('pages with the before cursor', async () => {
    const res = await app.request('/api/matches?before=1767348000')
    const body = await res.json()
    expect(body.matches).toHaveLength(1)
    expect(body.matches[0].matchId).toBe(1002)
  })

  it('returns nextBefore when the page is full', async () => {
    const res = await app.request('/api/matches?limit=1')
    const body = await res.json()
    expect(body.matches).toHaveLength(1)
    expect(body.matches[0].matchId).toBe(1001)
    expect(body.nextBefore).toBe(1767348000)
  })

  it('ignores a malformed limit', async () => {
    const res = await app.request('/api/matches?limit=banana')
    expect(res.status).toBe(200)
    expect((await res.json()).matches).toHaveLength(2)
  })

  it('rejects an all-invalid players param with 400', async () => {
    const res = await app.request('/api/matches?players=abc')
    expect(res.status).toBe(400)
  })
})
