/**
 * Fetches hero stats from OpenDota API and upserts into hero_stats table.
 * Run: pnpm fetch-data (from repo root). Requires DATABASE_URL and players in DB.
 */
import 'dotenv/config'
import { db, heroStats, players } from '../apps/api/src/db/index.js'
import { heroNameToSlug, getHeroRole } from '@friendtracker/shared'

const OPENDOTA = 'https://api.opendota.com/api'
const RATE_MS = 1100

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`OpenDota ${res.status}: ${url}`)
  return res.json() as Promise<T>
}

interface OpenDotaHero {
  id: number
  name: string
  localized_name: string
}

interface PlayerHeroRow {
  hero_id: number
  games: number
  win: number
  last_played: number
}

interface MatchRow {
  hero_id: number
  kills: number
  deaths: number
  assists: number
}

async function main() {
  const playerRows = await db.select().from(players)
  if (playerRows.length === 0) {
    console.log('No players in DB. Run seed first.')
    process.exit(0)
  }

  const heroes = (await fetchJson<OpenDotaHero[]>(`${OPENDOTA}/heroes`)) as OpenDotaHero[]
  await sleep(RATE_MS)

  const heroById = new Map(heroes.map((h) => [h.id, h]))

  for (const player of playerRows) {
    const pid = player.id
    const [playerHeroes, matches] = await Promise.all([
      fetchJson<PlayerHeroRow[]>(`${OPENDOTA}/players/${pid}/heroes`),
      fetchJson<MatchRow[]>(`${OPENDOTA}/players/${pid}/matches?limit=200`),
    ])
    await sleep(RATE_MS)

    const kdaByHero: Record<
      number,
      { kills: number; deaths: number; assists: number }
    > = {}
    for (const m of matches) {
      const cur = kdaByHero[m.hero_id] ?? {
        kills: 0,
        deaths: 0,
        assists: 0,
      }
      cur.kills += m.kills
      cur.deaths += m.deaths
      cur.assists += m.assists
      kdaByHero[m.hero_id] = cur
    }

    for (const ph of playerHeroes) {
      if (ph.games === 0) continue
      const hero = heroById.get(ph.hero_id)
      if (!hero) continue
      const slug = heroNameToSlug(hero.name)
      const role = getHeroRole(ph.hero_id)
      const kda = kdaByHero[ph.hero_id] ?? {
        kills: 0,
        deaths: 0,
        assists: 0,
      }
      await db
        .insert(heroStats)
        .values({
          playerId: pid,
          heroId: ph.hero_id,
          heroName: hero.localized_name,
          heroSlug: slug,
          role,
          matches: ph.games,
          wins: ph.win,
          kills: kda.kills,
          deaths: kda.deaths,
          assists: kda.assists,
        })
        .onConflictDoUpdate({
          target: [heroStats.playerId, heroStats.heroId],
          set: {
            heroName: hero.localized_name,
            heroSlug: slug,
            role,
            matches: ph.games,
            wins: ph.win,
            kills: kda.kills,
            deaths: kda.deaths,
            assists: kda.assists,
            lastUpdated: new Date(),
          },
        })
    }
    console.log(`Updated hero_stats for player ${player.name} (${pid})`)
  }

  console.log('Fetch done.')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
