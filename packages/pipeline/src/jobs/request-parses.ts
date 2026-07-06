/**
 * Asks OpenDota to parse the group's recent unparsed matches so later
 * fetch-data runs pick up lane/role data (lane_role is only present on
 * parsed matches). Only the last 14 days are eligible — OpenDota can't
 * parse matches whose replays have expired (~2 weeks), so older rows
 * would be wasted requests. Capped per run to stay polite on the free tier.
 */
import { sql } from 'drizzle-orm'
import { db, playerMatches } from '@friendtracker/db'
import { fetchJson, sleep, opendotaBase } from '../lib/opendota.js'

const RATE_MS = 1100
const MAX_REQUESTS = 10

export async function run(): Promise<string> {
  const rows = await db
    .selectDistinct({ matchId: playerMatches.matchId })
    .from(playerMatches)
    .where(
      sql`${playerMatches.laneRole} IS NULL AND ${playerMatches.startTime} > now() - interval '14 days'`
    )
    .orderBy(sql`${playerMatches.matchId} DESC`)
    .limit(MAX_REQUESTS)

  let requested = 0
  for (const { matchId } of rows) {
    try {
      await fetchJson(`${opendotaBase()}/request/${matchId}`, { method: 'POST' })
      requested++
      console.log(`  Requested parse for match ${matchId}`)
    } catch (e) {
      console.error(`  Parse request failed for ${matchId}: ${e instanceof Error ? e.message : e}`)
    }
    await sleep(RATE_MS)
  }

  return `requested parse for ${requested}/${rows.length} unparsed recent matches`
}
