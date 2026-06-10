/**
 * Fetches per-player hero build data from OpenDota match details.
 * For each player+hero with enough matches, fetches recent match details,
 * extracts purchase_log and ability_upgrades_arr, aggregates into BuildData,
 * and upserts player-specific hero_builds rows.
 *
 * Run: pnpm fetch-player-builds (from repo root). Requires DATABASE_URL + players in DB.
 */
import 'dotenv/config'
import { db, playerMatches, heroes, heroBuilds, players, and, eq } from '../apps/api/src/db/index.js'
import { sql } from 'drizzle-orm'
import { getHeroRole } from '@friendtracker/shared'
import type {
  BuildData,
  StatsData,
  SkillBuild,
  TalentChoice,
  ItemGroup,
  SituationalItem,
  MatchDurationWinRate,
} from '@friendtracker/shared'

const OPENDOTA = 'https://api.opendota.com/api'
const RATE_MS = 1100
const MIN_PARSED_MATCHES = 3
const MATCHES_TO_FETCH = 20

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

async function fetchJson<T>(url: string): Promise<T> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(url)
    if (res.status === 429) {
      const retryAfter = Number(res.headers.get('retry-after')) || 60
      console.log(`    Rate limited, sleeping ${retryAfter}s before retry...`)
      await sleep(retryAfter * 1000)
      continue
    }
    if (!res.ok) throw new Error(`OpenDota ${res.status}: ${url}`)
    return res.json() as Promise<T>
  }
  throw new Error(`OpenDota: gave up after 5 retries on ${url}`)
}

// ---------------------------------------------------------------------------
// OpenDota response types
// ---------------------------------------------------------------------------

interface MatchListEntry {
  match_id: number
  player_slot: number
  radiant_win: boolean
  duration: number
  hero_id: number
  version: number | null
}

interface PurchaseLogEntry {
  time: number
  key: string
}

interface MatchPlayer {
  account_id: number
  player_slot: number
  hero_id: number
  purchase_log: PurchaseLogEntry[] | null
  ability_upgrades_arr: number[] | null
  item_0: number
  item_1: number
  item_2: number
  item_3: number
  item_4: number
  item_5: number
  item_neutral: number
  radiant_win: boolean
  win: number
  kills: number
  deaths: number
  assists: number
  first_purchase_time?: Record<string, number>
}

interface MatchDetail {
  match_id: number
  duration: number
  radiant_win: boolean
  players: MatchPlayer[]
}

interface HeroAbilityInfo {
  abilities: string[]
  talents: Array<{ name: string; level: number }>
}

// ---------------------------------------------------------------------------
// Constants (loaded once from OpenDota)
// ---------------------------------------------------------------------------

let abilityIdMap: Record<string, string> = {}
let heroAbilitiesMap: Record<string, HeroAbilityInfo> = {}
let abilitiesData: Record<string, { dname?: string }> = {}
let itemIdMap: Map<number, string> = new Map()

async function loadConstants() {
  console.log('Loading OpenDota constants...')

  abilityIdMap = await fetchJson<Record<string, string>>(`${OPENDOTA}/constants/ability_ids`)
  await sleep(RATE_MS)

  heroAbilitiesMap = await fetchJson<Record<string, HeroAbilityInfo>>(
    `${OPENDOTA}/constants/hero_abilities`
  )
  await sleep(RATE_MS)

  abilitiesData = await fetchJson<Record<string, { dname?: string }>>(
    `${OPENDOTA}/constants/abilities`
  )
  await sleep(RATE_MS)

  const items = await fetchJson<Record<string, { id: number }>>(`${OPENDOTA}/constants/items`)
  for (const [slug, data] of Object.entries(items)) {
    if (data.id != null) itemIdMap.set(data.id, slug)
  }
  await sleep(RATE_MS)

  console.log(
    `  Loaded ${Object.keys(abilityIdMap).length} ability IDs, ` +
      `${Object.keys(heroAbilitiesMap).length} hero abilities, ${itemIdMap.size} items`
  )
}

// ---------------------------------------------------------------------------
// Match detail cache (avoids re-fetching when multiple players share a match)
// ---------------------------------------------------------------------------

const matchCache = new Map<number, MatchDetail>()

async function getMatchDetail(matchId: number): Promise<MatchDetail> {
  if (matchCache.has(matchId)) return matchCache.get(matchId)!
  const detail = await fetchJson<MatchDetail>(`${OPENDOTA}/matches/${matchId}`)
  matchCache.set(matchId, detail)
  await sleep(RATE_MS)
  return detail
}

// ---------------------------------------------------------------------------
// Parsed match extraction
// ---------------------------------------------------------------------------

interface ParsedMatch {
  matchId: number
  duration: number
  won: boolean
  isRadiant: boolean
  purchaseLog: PurchaseLogEntry[]
  abilityUpgrades: number[]
  finalItems: number[]
  neutralItem: number
  kills: number
  deaths: number
  assists: number
  firstPurchaseTime: Record<string, number>
}

function extractPlayerMatch(match: MatchDetail, accountId: string): ParsedMatch | null {
  const player = match.players.find((p) => String(p.account_id) === accountId)
  if (!player) return null
  // Skip unparsed matches (no detailed data)
  if (!player.purchase_log && !player.ability_upgrades_arr) return null

  const isRadiant = player.player_slot < 128

  return {
    matchId: match.match_id,
    duration: match.duration,
    won: isRadiant === match.radiant_win,
    isRadiant,
    purchaseLog: player.purchase_log ?? [],
    abilityUpgrades: player.ability_upgrades_arr ?? [],
    finalItems: [
      player.item_0,
      player.item_1,
      player.item_2,
      player.item_3,
      player.item_4,
      player.item_5,
    ].filter((id) => id > 0),
    neutralItem: player.item_neutral,
    kills: player.kills,
    deaths: player.deaths,
    assists: player.assists,
    firstPurchaseTime: player.first_purchase_time ?? {},
  }
}

// ---------------------------------------------------------------------------
// Item aggregation
// ---------------------------------------------------------------------------

/** Items to exclude from core / situational (consumables & cheap basics) */
const EXCLUDED_FROM_CORE = new Set([
  'tango',
  'flask',
  'clarity',
  'faerie_fire',
  'enchanted_mango',
  'ward_observer',
  'ward_sentry',
  'smoke_of_deceit',
  'dust',
  'tpscroll',
  'tome_of_knowledge',
  'blood_grenade',
  'branches',
  'magic_stick',
])

function aggregateItemBuild(matches: ParsedMatch[]): BuildData['itemBuild'] {
  const totalMatches = matches.length

  // --- Starting items (purchased before horn, time <= 0) ---
  const startingSets = new Map<string, { count: number; wins: number }>()
  for (const m of matches) {
    const starting = m.purchaseLog
      .filter((e) => e.time <= 0)
      .map((e) => e.key)
      .sort()
    if (starting.length === 0) continue
    const key = starting.join(',')
    const cur = startingSets.get(key) ?? { count: 0, wins: 0 }
    cur.count++
    if (m.won) cur.wins++
    startingSets.set(key, cur)
  }

  const startingItems: ItemGroup[] = [...startingSets.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 2)
    .map(([key, { count, wins }]) => ({
      items: key.split(','),
      matches: count,
      winRate: count > 0 ? Math.round((wins / count) * 1000) / 10 : 0,
    }))

  // --- Final inventory item frequency ---
  const itemFreq = new Map<
    string,
    { count: number; wins: number; totalTime: number; timeCount: number }
  >()
  for (const m of matches) {
    const seen = new Set<string>()
    for (const itemId of m.finalItems) {
      const slug = itemIdMap.get(itemId)
      if (!slug || EXCLUDED_FROM_CORE.has(slug)) continue
      if (seen.has(slug)) continue
      seen.add(slug)
      const cur = itemFreq.get(slug) ?? { count: 0, wins: 0, totalTime: 0, timeCount: 0 }
      cur.count++
      if (m.won) cur.wins++
      const purchaseTime = m.firstPurchaseTime[slug]
      if (purchaseTime != null && purchaseTime > 0) {
        cur.totalTime += purchaseTime
        cur.timeCount++
      }
      itemFreq.set(slug, cur)
    }
  }

  const sortedItems = [...itemFreq.entries()].sort((a, b) => b[1].count - a[1].count)

  // Core items: appear in >= 40% of matches
  const coreThreshold = totalMatches * 0.4
  const coreItemSlugs = sortedItems
    .filter(([, data]) => data.count >= coreThreshold)
    .map(([slug]) => slug)

  const coreWins = matches.filter((m) => m.won).length
  const coreItems: ItemGroup[] =
    coreItemSlugs.length > 0
      ? [
          {
            items: coreItemSlugs.slice(0, 6),
            matches: totalMatches,
            winRate: Math.round((coreWins / totalMatches) * 1000) / 10,
          },
        ]
      : []

  // Situational items: appear in 15–40% of matches
  const sitLower = totalMatches * 0.15
  const situationalItems: SituationalItem[] = sortedItems
    .filter(([, data]) => data.count >= sitLower && data.count < coreThreshold)
    .slice(0, 6)
    .map(([slug, data]) => ({
      itemName: slug.replace(/_/g, ' '),
      itemImage: slug,
      purchaseRate: Math.round((data.count / totalMatches) * 100),
      avgMinute: data.timeCount > 0 ? Math.round(data.totalTime / data.timeCount / 60) : 0,
    }))

  // --- Late game inventories by duration bracket ---
  const brackets = [
    { label: '20-35 min', minSec: 1200, maxSec: 2100 },
    { label: '35-50 min', minSec: 2100, maxSec: 3000 },
    { label: '50+ min', minSec: 3000, maxSec: Infinity },
  ]

  const lateGameInventories: Array<{ bracket: string; items: string[] }> = []
  for (const bracket of brackets) {
    const bMatches = matches.filter(
      (m) => m.duration >= bracket.minSec && m.duration < bracket.maxSec
    )
    if (bMatches.length < 2) continue

    const freq = new Map<string, number>()
    for (const m of bMatches) {
      for (const itemId of m.finalItems) {
        const slug = itemIdMap.get(itemId)
        if (!slug || EXCLUDED_FROM_CORE.has(slug)) continue
        freq.set(slug, (freq.get(slug) ?? 0) + 1)
      }
    }

    const topItems = [...freq.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([slug]) => slug)

    if (topItems.length > 0) {
      lateGameInventories.push({ bracket: bracket.label, items: topItems })
    }
  }

  return {
    startingItems,
    coreItems,
    situationalItems,
    neutralItems: [],
    lateGameInventories,
  }
}

// ---------------------------------------------------------------------------
// Skill build aggregation
// ---------------------------------------------------------------------------

function aggregateSkillBuild(matches: ParsedMatch[], heroSlug: string): SkillBuild[] {
  const withSkills = matches.filter((m) => m.abilityUpgrades.length > 0)
  if (withSkills.length === 0) return []

  // Hero's talent tree: heroAbilitiesMap is keyed by npc_dota_hero_<slug>
  const heroTalents: Array<{ name: string; level: number }> =
    heroAbilitiesMap[`npc_dota_hero_${heroSlug}`]?.talents ?? []

  // Build talent tier map: dotaLevel -> [leftName, rightName]
  const talentTiers = new Map<10 | 15 | 20 | 25, [string, string]>()
  if (heroTalents.length > 0) {
    const byLevel = new Map<number, string[]>()
    for (const t of heroTalents) {
      const arr = byLevel.get(t.level) ?? []
      arr.push(t.name)
      byLevel.set(t.level, arr)
    }
    const tierMap: Record<number, 10 | 15 | 20 | 25> = { 1: 10, 2: 15, 3: 20, 4: 25 }
    for (const [level, names] of byLevel) {
      const tier = tierMap[level]
      if (tier && names.length >= 2) {
        talentTiers.set(tier, [names[0], names[1]])
      }
    }
  }

  // Most common ability at each of the first 10 non-talent levels
  const levelCounts: Map<string, number>[] = Array.from({ length: 10 }, () => new Map())

  for (const m of withSkills) {
    let idx = 0
    for (const abilityId of m.abilityUpgrades) {
      if (idx >= 10) break
      const name = abilityIdMap[String(abilityId)]
      if (!name) continue
      if (name.startsWith('special_bonus_') || name === 'attribute_bonus') continue
      const counts = levelCounts[idx]
      counts.set(name, (counts.get(name) ?? 0) + 1)
      idx++
    }
  }

  const levels: string[] = levelCounts.map((counts) => {
    if (counts.size === 0) return ''
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0]
  })

  // Talent pick counts per tier
  const talentPicks = new Map<
    number,
    { left: number; right: number; leftWins: number; rightWins: number }
  >()

  for (const m of withSkills) {
    for (const abilityId of m.abilityUpgrades) {
      const name = abilityIdMap[String(abilityId)]
      if (!name || !name.startsWith('special_bonus_')) continue
      for (const [tier, [leftName, rightName]] of talentTiers) {
        const stats = talentPicks.get(tier) ?? {
          left: 0,
          right: 0,
          leftWins: 0,
          rightWins: 0,
        }
        if (name === leftName) {
          stats.left++
          if (m.won) stats.leftWins++
          talentPicks.set(tier, stats)
        } else if (name === rightName) {
          stats.right++
          if (m.won) stats.rightWins++
          talentPicks.set(tier, stats)
        }
      }
    }
  }

  const talents: TalentChoice[] = []
  for (const tier of [10, 15, 20, 25] as const) {
    const pair = talentTiers.get(tier)
    if (!pair) continue
    const [leftName, rightName] = pair

    const stats = talentPicks.get(tier)
    const leftLabel =
      abilitiesData[leftName]?.dname ??
      leftName.replace(/^special_bonus_/, '').replace(/_/g, ' ')
    const rightLabel =
      abilitiesData[rightName]?.dname ??
      rightName.replace(/^special_bonus_/, '').replace(/_/g, ' ')

    const picked: 'left' | 'right' =
      (stats?.left ?? 0) >= (stats?.right ?? 0) ? 'left' : 'right'
    const winnerWins = picked === 'left' ? (stats?.leftWins ?? 0) : (stats?.rightWins ?? 0)
    const winnerTotal = picked === 'left' ? (stats?.left ?? 0) : (stats?.right ?? 0)
    const winRate = winnerTotal > 0 ? Math.round((winnerWins / winnerTotal) * 1000) / 10 : 0

    talents.push({ level: tier, left: leftLabel, right: rightLabel, picked, winRate })
  }

  if (levels.every((l) => l === '') && talents.length === 0) return []

  return [{ levels, talents }]
}

// ---------------------------------------------------------------------------
// Stats aggregation
// ---------------------------------------------------------------------------

function aggregateStats(matches: ParsedMatch[]): StatsData {
  if (matches.length === 0) return {}

  const radiantMatches = matches.filter((m) => m.isRadiant)
  const direMatches = matches.filter((m) => !m.isRadiant)
  const radiantWins = radiantMatches.filter((m) => m.won).length
  const direWins = direMatches.filter((m) => m.won).length

  const durationBrackets = [
    { label: '<20 min', minSec: 0, maxSec: 1200 },
    { label: '20-30 min', minSec: 1200, maxSec: 1800 },
    { label: '30-40 min', minSec: 1800, maxSec: 2400 },
    { label: '40-50 min', minSec: 2400, maxSec: 3000 },
    { label: '50+ min', minSec: 3000, maxSec: Infinity },
  ]

  const matchDurationWinRate: MatchDurationWinRate[] = durationBrackets
    .map(({ label, minSec, maxSec }) => {
      const inRange = matches.filter((m) => m.duration >= minSec && m.duration < maxSec)
      if (inRange.length < 2) return null
      const wins = inRange.filter((m) => m.won).length
      return {
        bracket: label,
        winRate: Math.round((wins / inRange.length) * 1000) / 10,
        matches: inRange.length,
      }
    })
    .filter((x): x is MatchDurationWinRate => x != null)

  const stats: StatsData = {}
  if (radiantMatches.length > 0)
    stats.radiantWinRate = Math.round((radiantWins / radiantMatches.length) * 1000) / 10
  if (direMatches.length > 0)
    stats.direWinRate = Math.round((direWins / direMatches.length) * 1000) / 10
  if (matchDurationWinRate.length > 0) stats.matchDurationWinRate = matchDurationWinRate

  return stats
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  await loadConstants()

  const playerRows = await db.select().from(players)
  if (playerRows.length === 0) {
    console.log('No players in DB. Run seed first.')
    process.exit(0)
  }

  let totalUpdated = 0
  let totalSkipped = 0

  for (const player of playerRows) {
    const pid = player.id
    console.log(`\nProcessing player ${player.name} (${pid})...`)

    const playerHeroRows = await db
      .select({
        heroId: playerMatches.heroId,
        heroName: heroes.name,
        heroSlug: heroes.slug,
        matches: sql<number>`COUNT(*)::int`,
      })
      .from(playerMatches)
      .innerJoin(heroes, eq(playerMatches.heroId, heroes.id))
      .where(eq(playerMatches.playerId, pid))
      .groupBy(playerMatches.heroId, heroes.name, heroes.slug)

    for (const hero of playerHeroRows) {
      if (hero.matches < MIN_PARSED_MATCHES) {
        totalSkipped++
        continue
      }

      console.log(`  Fetching matches for ${hero.heroName}...`)

      let matchList: MatchListEntry[]
      try {
        matchList = await fetchJson<MatchListEntry[]>(
          `${OPENDOTA}/players/${pid}/matches?hero_id=${hero.heroId}&limit=${MATCHES_TO_FETCH}`
        )
        await sleep(RATE_MS)
      } catch (e) {
        console.error(`    Failed to fetch match list: ${e instanceof Error ? e.message : e}`)
        continue
      }

      // Fetch full match details and extract player data
      const parsedMatches: ParsedMatch[] = []
      for (const entry of matchList) {
        try {
          const detail = await getMatchDetail(entry.match_id)
          const parsed = extractPlayerMatch(detail, pid)
          if (parsed && (parsed.purchaseLog.length > 0 || parsed.abilityUpgrades.length > 0)) {
            parsedMatches.push(parsed)
          }
        } catch {
          // Skip failed match fetches
          continue
        }
      }

      if (parsedMatches.length < MIN_PARSED_MATCHES) {
        console.log(
          `    Only ${parsedMatches.length} parsed matches, skipping (need ${MIN_PARSED_MATCHES})`
        )
        totalSkipped++
        continue
      }

      console.log(`    Aggregating ${parsedMatches.length} parsed matches...`)

      const itemBuild = aggregateItemBuild(parsedMatches)
      const skillBuilds = aggregateSkillBuild(parsedMatches, hero.heroSlug)
      const statsData = aggregateStats(parsedMatches)

      const buildData: BuildData = { skillBuilds, itemBuild }
      const role = getHeroRole(hero.heroId)
      const wins = parsedMatches.filter((m) => m.won).length
      const winRate = Math.round((wins / parsedMatches.length) * 1000) / 10

      // Upsert into hero_builds with this player's ID
      const existing = await db
        .select({ id: heroBuilds.id })
        .from(heroBuilds)
        .where(
          and(
            eq(heroBuilds.heroSlug, hero.heroSlug),
            eq(heroBuilds.role, role),
            eq(heroBuilds.playerId, pid)
          )
        )
        .limit(1)

      if (existing.length > 0) {
        await db
          .update(heroBuilds)
          .set({
            buildData,
            statsData: Object.keys(statsData).length > 0 ? statsData : null,
            totalMatches: parsedMatches.length,
            winRate,
            lastUpdated: new Date(),
          })
          .where(eq(heroBuilds.id, existing[0].id))
      } else {
        await db.insert(heroBuilds).values({
          heroId: hero.heroId,
          heroSlug: hero.heroSlug,
          heroName: hero.heroName,
          role,
          playerId: pid,
          totalMatches: parsedMatches.length,
          winRate,
          buildData,
          statsData: Object.keys(statsData).length > 0 ? statsData : null,
        })
      }

      totalUpdated++
      console.log(`    Updated ${hero.heroName} build for ${player.name}`)
    }
  }

  console.log(`\nfetch-player-builds done: ${totalUpdated} updated, ${totalSkipped} skipped.`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
