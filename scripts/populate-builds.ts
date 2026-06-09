/**
 * Aggregates hero_stats into hero_builds (global, player_id = NULL).
 * Safe to re-run: preserves existing buildData (curated builds like Abaddon),
 * only updates totalMatches and winRate for existing rows.
 * Run: pnpm populate-builds (from repo root). Requires DATABASE_URL.
 */
import 'dotenv/config'
import { db, heroStats, heroBuilds, and, eq, isNull } from '../apps/api/src/db/index.js'
import { sql } from 'drizzle-orm'
import type { BuildData, Role } from '@friendtracker/shared'

const emptyBuildData: BuildData = {
  skillBuilds: [],
  itemBuild: {
    startingItems: [],
    coreItems: [],
    situationalItems: [],
    neutralItems: [],
    lateGameInventories: [],
  },
}

async function main() {
  const rows = await db
    .select({
      heroId: heroStats.heroId,
      heroName: heroStats.heroName,
      heroSlug: heroStats.heroSlug,
      role: heroStats.role,
      totalMatches: sql<number>`SUM(${heroStats.matches})::int`,
      wins: sql<number>`SUM(${heroStats.wins})::int`,
    })
    .from(heroStats)
    .groupBy(heroStats.heroId, heroStats.heroName, heroStats.heroSlug, heroStats.role)
    .having(sql`SUM(${heroStats.matches}) > 0`)

  console.log(`Found ${rows.length} hero+role combinations in hero_stats.`)

  let inserted = 0
  let updated = 0

  for (const row of rows) {
    const winRate = row.totalMatches > 0 ? (row.wins / row.totalMatches) * 100 : 0

    const existing = await db
      .select({ id: heroBuilds.id })
      .from(heroBuilds)
      .where(
        and(
          eq(heroBuilds.heroSlug, row.heroSlug),
          eq(heroBuilds.role, row.role as Role),
          isNull(heroBuilds.playerId)
        )
      )
      .limit(1)

    if (existing.length > 0) {
      await db
        .update(heroBuilds)
        .set({ totalMatches: row.totalMatches, winRate, lastUpdated: new Date() })
        .where(
          and(
            eq(heroBuilds.heroSlug, row.heroSlug),
            eq(heroBuilds.role, row.role as Role),
            isNull(heroBuilds.playerId)
          )
        )
      updated++
    } else {
      await db.insert(heroBuilds).values({
        heroId: row.heroId,
        heroSlug: row.heroSlug,
        heroName: row.heroName,
        role: row.role as Role,
        playerId: null,
        totalMatches: row.totalMatches,
        winRate,
        buildData: emptyBuildData,
      })
      inserted++
    }
  }

  console.log(`populate-builds done: ${inserted} inserted, ${updated} updated.`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
