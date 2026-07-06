/**
 * Pure aggregation of parsed OpenDota match details into BuildData item
 * structures. No I/O on import — unit-testable.
 */
import type { BuildData, ItemGroup, SituationalItem } from '@friendtracker/shared'

export interface PurchaseLogEntry {
  time: number
  key: string
}

export interface ParsedMatch {
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

/** Items to exclude from core / situational (consumables & cheap basics) */
export const EXCLUDED_FROM_CORE = new Set([
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

export function aggregateItemBuild(
  matches: ParsedMatch[],
  itemIdMap: Map<number, string>
): BuildData['itemBuild'] {
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
