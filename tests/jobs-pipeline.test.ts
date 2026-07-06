import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createServer, type Server } from 'node:http'
import { eq } from 'drizzle-orm'
import { db, pool, players, playerMatches } from '@friendtracker/db'
import { registry } from '@friendtracker/pipeline'

let mock: Server

beforeAll(async () => {
  mock = createServer((req, res) => {
    const url = req.url ?? ''
    res.setHeader('content-type', 'application/json')
    if (url.startsWith('/heroes')) {
      // Same ids/names as the seeded heroes — upsert stays a no-op for other tests
      res.end(
        JSON.stringify([
          { id: 1, name: 'npc_dota_hero_antimage', localized_name: 'Anti-Mage' },
          { id: 2, name: 'npc_dota_hero_axe', localized_name: 'Axe' },
        ])
      )
    } else if (url.includes('/players/501/matches')) {
      res.end(
        JSON.stringify([
          { match_id: 9001, hero_id: 1, kills: 5, deaths: 2, assists: 7, duration: 2100, player_slot: 1, radiant_win: true, lane_role: 1, is_roaming: false, start_time: 1767348000 },
          { match_id: 9002, hero_id: 2, kills: 1, deaths: 9, assists: 3, duration: 1900, player_slot: 130, radiant_win: true, lane_role: null, is_roaming: null, start_time: 1767261600 },
        ])
      )
    } else if (url.includes('/players/501')) {
      res.end(JSON.stringify({ profile: { personaname: 'Fresh Persona', avatarfull: 'https://a.example/n.jpg' } }))
    } else {
      // Other players: OpenDota knows nothing (no profile key) — must be skipped
      res.end(JSON.stringify({}))
    }
  })
  await new Promise<void>((resolve) => mock.listen(0, '127.0.0.1', resolve))
  const addr = mock.address()
  if (typeof addr === 'object' && addr) {
    process.env.OPENDOTA_URL = `http://127.0.0.1:${addr.port}`
  }
  await db.insert(players).values({ id: '501', name: 'Newbie' })
})

afterAll(async () => {
  delete process.env.OPENDOTA_URL
  await db.delete(players).where(eq(players.id, '501')) // cascades player_matches
  await new Promise((resolve) => mock.close(resolve))
  await pool.end()
})

describe('fetch-player', () => {
  it('syncs a single player\'s matches', async () => {
    const summary = await registry['fetch-player']({ playerId: '501' })
    expect(summary).toContain('2 match rows')
    const rows = await db.select().from(playerMatches).where(eq(playerMatches.playerId, '501'))
    expect(rows).toHaveLength(2)
    const m1 = rows.find((r) => r.matchId === 9001)!
    expect(m1.won).toBe(true) // radiant slot, radiant won
    const m2 = rows.find((r) => r.matchId === 9002)!
    expect(m2.won).toBe(false) // dire slot, radiant won
  })

  it('throws without a playerId payload', async () => {
    await expect(registry['fetch-player'](null)).rejects.toThrow(/playerId/)
  })

  it('throws for a player not in the DB', async () => {
    await expect(registry['fetch-player']({ playerId: '999999' })).rejects.toThrow(/not in DB/)
  })
})

describe('refresh-profiles', () => {
  it('updates only players OpenDota has a profile for', async () => {
    const summary = await registry['refresh-profiles'](null)
    const [p] = await db.select().from(players).where(eq(players.id, '501'))
    expect(p.name).toBe('Fresh Persona')
    expect(p.avatar).toBe('https://a.example/n.jpg')
    const [alice] = await db.select().from(players).where(eq(players.id, '111'))
    expect(alice.name).toBe('Alice') // mock returns {} for 111 — untouched
    expect(summary).toMatch(/^refreshed profiles for 1\//)
  })
})
