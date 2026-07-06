/**
 * Initial match sync for a single (just-added) player — the job enqueued by
 * POST /api/players. Payload: { playerId }. ~2 OpenDota calls.
 */
import { eq } from 'drizzle-orm'
import { db, players, type JobPayload } from '@friendtracker/db'
import { syncHeroes, syncPlayerMatches } from '../lib/sync.js'

export async function run(payload: JobPayload | null): Promise<string> {
  const playerId = payload?.playerId
  if (!playerId) throw new Error('fetch-player requires payload.playerId')
  const [player] = await db.select().from(players).where(eq(players.id, playerId))
  if (!player) throw new Error(`player ${playerId} not in DB`)
  const heroIds = await syncHeroes()
  const n = await syncPlayerMatches(playerId, heroIds)
  return `synced ${n} match rows for ${player.name} (${playerId})`
}
