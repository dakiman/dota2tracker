/**
 * Syncs the heroes lookup table and each player's full significant-match
 * history from OpenDota into player_matches. Idempotent: re-runs upsert every
 * row, picking up lane data for matches parsed since the last run.
 * Run: pnpm fetch-data (from repo root). Requires DATABASE_URL and players in DB.
 */
import 'dotenv/config'
import { sql } from 'drizzle-orm'
import { db, heroes, playerMatches, players } from '../apps/api/src/db/index.js'
import { heroNameToSlug, deriveRole } from '@friendtracker/shared'
import { fetchJson, sleep } from './lib/opendota.js'

const OPENDOTA = 'https://api.opendota.com/api'
const RATE_MS = 1100
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

export async function run(): Promise<string> {
  const playerRows = await db.select().from(players)
  if (playerRows.length === 0) {
    return 'no players in DB — run seed first'
  }

  const heroList = await fetchJson<OpenDotaHero[]>(`${OPENDOTA}/heroes`)
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

  const heroIds = new Set(heroList.map((h) => h.id))

  let totalRows = 0
  for (const player of playerRows) {
    const matches = await fetchJson<MatchRow[]>(
      `${OPENDOTA}/players/${player.id}/matches?${MATCH_PROJECT}`
    )
    await sleep(RATE_MS)

    const rows = matches
      // radiant_win can be null (hidden/ancient matches) — result unknown, skip
      .filter((m): m is MatchRow & { radiant_win: boolean } => m.radiant_win !== null && heroIds.has(m.hero_id))
      .map((m) => ({
        playerId: player.id,
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
    totalRows += rows.length
    console.log(`Upserted ${rows.length} matches for ${player.name} (${player.id})`)
  }

  return `synced ${heroList.length} heroes; upserted ${totalRows} match rows for ${playerRows.length} players`
}
