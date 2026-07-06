/**
 * Hero + per-player match sync helpers, shared by fetch-data (all players)
 * and fetch-player (one just-added player).
 */
import { sql } from 'drizzle-orm'
import { db, heroes, playerMatches } from '@friendtracker/db'
import { heroNameToSlug, deriveRole } from '@friendtracker/shared'
import { fetchJson, sleep, opendotaBase, RATE_MS } from './opendota.js'

const CHUNK = 500

interface OpenDotaHero {
  id: number
  name: string
  localized_name: string
}

// OpenDota only returns the projected fields; the default (no `significant`
// param) already excludes turbo and other non-significant game modes.
const MATCH_PROJECT = [
  'match_id',
  'hero_id',
  'kills',
  'deaths',
  'assists',
  'duration',
  'player_slot',
  'radiant_win',
  'lane_role',
  'is_roaming',
  'start_time',
]
  // OpenDota expects repeated project params, not a comma-separated list
  .map((f) => `project=${f}`)
  .join('&')

interface MatchRow {
  match_id: number
  hero_id: number
  kills: number | null
  deaths: number | null
  assists: number | null
  duration: number
  player_slot: number
  radiant_win: boolean | null
  lane_role: number | null
  is_roaming: boolean | null
  start_time: number
}

/** Upserts the heroes lookup from OpenDota; returns the valid hero-id set. */
export async function syncHeroes(): Promise<Set<number>> {
  const heroList = await fetchJson<OpenDotaHero[]>(`${opendotaBase()}/heroes`)
  await sleep(RATE_MS)
  // Single multi-row upsert instead of one round trip per hero.
  const heroValues = heroList.map((h) => ({
    id: h.id,
    name: h.localized_name,
    slug: heroNameToSlug(h.name),
  }))
  if (heroValues.length > 0) {
    await db.insert(heroes).values(heroValues).onConflictDoUpdate({
      target: heroes.id,
      set: { name: sql`excluded.name`, slug: sql`excluded.slug` },
    })
  }
  console.log(`Synced ${heroList.length} heroes.`)
  return new Set(heroList.map((h) => h.id))
}

/** Fetches one player's full significant-match history and upserts it into
 *  player_matches. Returns the number of rows upserted. */
export async function syncPlayerMatches(playerId: string, heroIds: Set<number>): Promise<number> {
  const matches = await fetchJson<MatchRow[]>(
    `${opendotaBase()}/players/${playerId}/matches?${MATCH_PROJECT}`
  )
  await sleep(RATE_MS)

  const rows = matches
    // radiant_win can be null (hidden/ancient matches) — result unknown, skip
    .filter((m): m is MatchRow & { radiant_win: boolean } => m.radiant_win !== null && heroIds.has(m.hero_id))
    .map((m) => ({
      playerId,
      matchId: m.match_id,
      heroId: m.hero_id,
      won: (m.player_slot < 128) === m.radiant_win,
      kills: m.kills ?? 0,
      deaths: m.deaths ?? 0,
      assists: m.assists ?? 0,
      duration: m.duration,
      startTime: new Date(m.start_time * 1000),
      laneRole: m.lane_role ?? null,
      isRoaming: m.is_roaming ?? null,
      role: deriveRole(m.lane_role, m.is_roaming, m.hero_id),
    }))

  for (let i = 0; i < rows.length; i += CHUNK) {
    await db
      .insert(playerMatches)
      .values(rows.slice(i, i + CHUNK))
      .onConflictDoUpdate({
        target: [playerMatches.playerId, playerMatches.matchId],
        set: {
          heroId: sql`excluded.hero_id`,
          won: sql`excluded.won`,
          kills: sql`excluded.kills`,
          deaths: sql`excluded.deaths`,
          assists: sql`excluded.assists`,
          duration: sql`excluded.duration`,
          startTime: sql`excluded.start_time`,
          laneRole: sql`excluded.lane_role`,
          isRoaming: sql`excluded.is_roaming`,
          role: sql`excluded.role`,
        },
      })
  }
  return rows.length
}
