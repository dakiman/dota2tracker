/**
 * Syncs the heroes lookup table and each player's full significant-match
 * history from OpenDota into player_matches. Idempotent: re-runs upsert every
 * row, picking up lane data for matches parsed since the last run.
 */
import { db, players } from '@friendtracker/db'
import { syncHeroes, syncPlayerMatches } from '../lib/sync.js'

export async function run(): Promise<string> {
  const playerRows = await db.select().from(players)
  if (playerRows.length === 0) {
    return 'no players in DB — run seed first'
  }

  const heroIds = await syncHeroes()

  let totalRows = 0
  for (const player of playerRows) {
    const n = await syncPlayerMatches(player.id, heroIds)
    totalRows += n
    console.log(`Upserted ${n} matches for ${player.name} (${player.id})`)
  }

  return `synced ${heroIds.size} heroes; upserted ${totalRows} match rows for ${playerRows.length} players`
}
