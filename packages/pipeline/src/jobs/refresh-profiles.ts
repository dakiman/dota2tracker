/**
 * Daily name/avatar re-sync from OpenDota profiles. Players OpenDota has no
 * profile for (never exposed data) are skipped. NOTE: intentionally
 * overwrites hand-seeded nicknames with current Steam personas.
 */
import { eq } from 'drizzle-orm'
import { db, players } from '@friendtracker/db'
import { fetchJson, sleep, opendotaBase, RATE_MS } from '../lib/opendota.js'

interface PlayerProfile {
  profile?: { personaname?: string; avatarfull?: string }
}

export async function run(): Promise<string> {
  const playerRows = await db.select().from(players)
  let updated = 0
  for (const player of playerRows) {
    try {
      const data = await fetchJson<PlayerProfile>(`${opendotaBase()}/players/${player.id}`)
      if (data.profile?.personaname) {
        await db
          .update(players)
          .set({ name: data.profile.personaname, avatar: data.profile.avatarfull ?? null })
          .where(eq(players.id, player.id))
        updated++
      }
    } catch (e) {
      console.error(`  Profile refresh failed for ${player.id}: ${e instanceof Error ? e.message : e}`)
    }
    await sleep(RATE_MS)
  }
  return `refreshed profiles for ${updated}/${playerRows.length} players`
}
