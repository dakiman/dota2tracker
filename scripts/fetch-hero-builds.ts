/**
 * Fetches global hero build data (item popularity, match duration stats) from OpenDota
 * and updates hero_builds rows. Preserves curated builds (e.g. Abaddon).
 * Run: pnpm fetch-hero-builds (from repo root). Requires DATABASE_URL.
 */
import 'dotenv/config'
import { db, heroBuilds, and, eq, isNull } from '../apps/api/src/db/index.js'
import { sql } from 'drizzle-orm'
import type { BuildData, StatsData, ItemGroup, SituationalItem, MatchDurationWinRate } from '@friendtracker/shared'
import { fetchJson, sleep } from './lib/opendota.js'

const OPENDOTA = 'https://api.opendota.com/api'
const RATE_MS = 1100

// --- Item constants ---

interface OpenDotaItem {
  id: number
  img?: string
  dname?: string
}

async function buildItemIdMap(): Promise<Map<number, string>> {
  const items = await fetchJson<Record<string, OpenDotaItem>>(`${OPENDOTA}/constants/items`)
  const map = new Map<number, string>()
  for (const [slug, data] of Object.entries(items)) {
    if (slug.startsWith('recipe_')) continue
    if (data.id != null) map.set(data.id, slug)
  }
  return map
}

// --- Item popularity ---

interface ItemPopularity {
  start_game_items?: Record<string, number>
  early_game_items?: Record<string, number>
  mid_game_items?: Record<string, number>
  late_game_items?: Record<string, number>
}

function topItems(
  phase: Record<string, number> | undefined,
  idMap: Map<number, string>,
  limit: number
): string[] {
  if (!phase) return []
  return Object.entries(phase)
    .map(([id, count]) => ({ slug: idMap.get(Number(id)), count }))
    .filter((x): x is { slug: string; count: number } => x.slug != null)
    .sort((a, b) => b.count - a.count)
    .slice(0, limit)
    .map((x) => x.slug)
}

function buildItemData(pop: ItemPopularity, idMap: Map<number, string>): BuildData['itemBuild'] {
  const startItems = topItems(pop.start_game_items, idMap, 6)
  const earlyItems = topItems(pop.early_game_items, idMap, 4)
  const midItems = topItems(pop.mid_game_items, idMap, 6)
  const lateItems = topItems(pop.late_game_items, idMap, 6)

  const startingItems: ItemGroup[] = startItems.length
    ? [{ items: startItems, matches: 0, winRate: 0 }]
    : []

  const coreItems: ItemGroup[] = []
  if (earlyItems.length) coreItems.push({ items: earlyItems, matches: 0, winRate: 0 })
  if (midItems.slice(0, 3).length) coreItems.push({ items: midItems.slice(0, 3), matches: 0, winRate: 0 })

  const situationalItems: SituationalItem[] = midItems.slice(3, 8).map((slug) => ({
    itemName: slug.replace(/_/g, ' '),
    itemImage: slug,
    purchaseRate: 0,
    avgMinute: 0,
  }))

  const lateGameInventories = lateItems.length
    ? [{ bracket: 'Late game', items: lateItems }]
    : []

  return {
    startingItems,
    coreItems,
    situationalItems,
    neutralItems: [],
    lateGameInventories,
  }
}

// --- Duration stats ---

interface DurationBucket {
  duration_bin: number
  games_played: number
  wins: number
}

function buildDurationStats(buckets: DurationBucket[]): MatchDurationWinRate[] {
  const brackets: { label: string; minSec: number; maxSec: number }[] = [
    { label: '<20 min', minSec: 0, maxSec: 1200 },
    { label: '20-30 min', minSec: 1200, maxSec: 1800 },
    { label: '30-40 min', minSec: 1800, maxSec: 2400 },
    { label: '40-50 min', minSec: 2400, maxSec: 3000 },
    { label: '50+ min', minSec: 3000, maxSec: Infinity },
  ]

  return brackets
    .map(({ label, minSec, maxSec }) => {
      const inRange = buckets.filter(
        (b) => b.duration_bin >= minSec && b.duration_bin < maxSec
      )
      const matches = inRange.reduce((s, b) => s + b.games_played, 0)
      const wins = inRange.reduce((s, b) => s + b.wins, 0)
      if (matches < 10) return null
      return { bracket: label, winRate: Math.round((wins / matches) * 1000) / 10, matches }
    })
    .filter((x): x is MatchDurationWinRate => x != null)
}

// --- Main ---

export async function run(): Promise<string> {
  const idMap = await buildItemIdMap()
  console.log(`Loaded ${idMap.size} item mappings.`)
  await sleep(RATE_MS)

  // Get all global hero_builds (playerId IS NULL)
  const builds = await db
    .select({
      id: heroBuilds.id,
      heroId: heroBuilds.heroId,
      heroName: heroBuilds.heroName,
      heroSlug: heroBuilds.heroSlug,
      buildData: heroBuilds.buildData,
    })
    .from(heroBuilds)
    .where(isNull(heroBuilds.playerId))

  console.log(`Found ${builds.length} global hero builds to process.`)

  let updated = 0
  let skipped = 0

  for (const build of builds) {
    // Skip curated builds that already have real data
    const existing = build.buildData as BuildData | string
    const parsed: BuildData = typeof existing === 'string' ? JSON.parse(existing) : existing
    if (parsed.skillBuilds?.length > 0 || parsed.itemBuild?.startingItems?.length > 0) {
      skipped++
      continue
    }

    try {
      const pop = await fetchJson<ItemPopularity>(`${OPENDOTA}/heroes/${build.heroId}/itemPopularity`)
      await sleep(RATE_MS)
      const durations = await fetchJson<DurationBucket[]>(`${OPENDOTA}/heroes/${build.heroId}/durations`)
      await sleep(RATE_MS)

      const itemBuild = buildItemData(pop, idMap)
      const newBuildData: BuildData = { skillBuilds: [], itemBuild }
      const durationStats = buildDurationStats(durations)
      const statsData: StatsData = durationStats.length
        ? { matchDurationWinRate: durationStats }
        : {}

      await db
        .update(heroBuilds)
        .set({
          buildData: newBuildData,
          statsData: Object.keys(statsData).length > 0 ? statsData : null,
          lastUpdated: new Date(),
        })
        .where(eq(heroBuilds.id, build.id))

      updated++
      console.log(`  Updated ${build.heroName} (${build.heroSlug})`)
    } catch (e) {
      console.error(`  Failed ${build.heroName}: ${e instanceof Error ? e.message : e}`)
    }
  }

  return `${updated} hero builds updated, ${skipped} skipped (curated)`
}
