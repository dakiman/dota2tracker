import { describe, it, expect, afterAll, beforeAll } from 'vitest'
import { app } from '../apps/api/src/app.js'
import { pool } from '@friendtracker/db'

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

describe('GET /api/together', () => {
  // Extra fixture: match 1003 where 111 and 222 are on OPPOSITE teams
  // (different won values) — must not count as a duo game.
  beforeAll(async () => {
    await pool.query(`
      INSERT INTO player_matches
        (player_id, match_id, hero_id, won, kills, deaths, assists, duration, start_time, role)
      VALUES
        ('111', 1003, 2, false, 1, 9, 2, 2000, '2026-01-03T10:00:00Z', 'offlane'),
        ('222', 1003, 1, true,  9, 1, 8, 2000, '2026-01-03T10:00:00Z', 'carry')
    `)
  })

  afterAll(async () => {
    await pool.query(`DELETE FROM player_matches WHERE match_id = 1003`)
  })

  it('counts same-team games as duos, ignores opposite-team games', async () => {
    const res = await app.request('/api/together')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.duos).toEqual([
      { playerA: '111', playerB: '222', matches: 1, wins: 1, winRate: 100 },
    ])
  })

  it('splits each player into together vs solo', async () => {
    const res = await app.request('/api/together')
    const body = await res.json()
    const alice = body.players.find((p: { playerId: string }) => p.playerId === '111')
    // 1001 together (won); 1002 and 1003 solo (no tracked same-team friend), both lost
    expect(alice).toMatchObject({
      togetherMatches: 1,
      togetherWins: 1,
      togetherWinRate: 100,
      soloMatches: 2,
      soloWins: 0,
      soloWinRate: 0,
    })
    const bob = body.players.find((p: { playerId: string }) => p.playerId === '222')
    expect(bob).toMatchObject({
      togetherMatches: 1,
      togetherWins: 1,
      soloMatches: 1,
      soloWins: 1,
    })
  })

  it('players filter requires both duo members to be selected', async () => {
    const res = await app.request('/api/together?players=111')
    const body = await res.json()
    expect(body.duos).toEqual([])
    expect(body.players).toHaveLength(1)
    expect(body.players[0].playerId).toBe('111')
  })

  it('rejects an all-invalid players param with 400', async () => {
    const res = await app.request('/api/together?players=abc')
    expect(res.status).toBe(400)
  })
})
