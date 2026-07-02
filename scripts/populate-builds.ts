/**
 * Aggregates player_matches into hero_builds (global, player_id = NULL).
 * Safe to re-run: preserves existing buildData (curated builds like Abaddon),
 * only updates totalMatches and winRate for existing rows.
 * Run: pnpm populate-builds (from repo root). Requires DATABASE_URL.
 */
import 'dotenv/config'
import { db, playerMatches, heroes, heroBuilds, eq, isNull } from '../apps/api/src/db/index.js'
import { inArray, sql } from 'drizzle-orm'
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
      heroId: playerMatches.heroId,
      heroName: heroes.name,
      heroSlug: heroes.slug,
      role: playerMatches.role,
      totalMatches: sql<number>`COUNT(*)::int`,
      wins: sql<number>`COUNT(*) FILTER (WHERE ${playerMatches.won})::int`,
    })
    .from(playerMatches)
    .innerJoin(heroes, eq(playerMatches.heroId, heroes.id))
    .groupBy(playerMatches.heroId, heroes.name, heroes.slug, playerMatches.role)

  console.log(`Found ${rows.length} hero+role combinations in player_matches.`)

  // Single batched upsert against the hero_role_global_idx partial unique index
  // (player_id IS NULL). Only the count columns are refreshed, so curated
  // buildData (e.g. the Abaddon build) on an existing row is preserved.
  if (rows.length > 0) {
    const values = rows.map((row) => ({
      heroId: row.heroId,
      heroSlug: row.heroSlug,
      heroName: row.heroName,
      role: row.role as Role,
      playerId: null,
      totalMatches: row.totalMatches,
      winRate: row.totalMatches > 0 ? (row.wins / row.totalMatches) * 100 : 0,
      buildData: emptyBuildData,
    }))
    const CHUNK = 500
    for (let i = 0; i < values.length; i += CHUNK) {
      await db
        .insert(heroBuilds)
        .values(values.slice(i, i + CHUNK))
        .onConflictDoUpdate({
          target: [heroBuilds.heroSlug, heroBuilds.role],
          targetWhere: sql`${heroBuilds.playerId} IS NULL`,
          set: {
            totalMatches: sql`excluded.total_matches`,
            winRate: sql`excluded.win_rate`,
            heroName: sql`excluded.hero_name`,
            lastUpdated: sql`now()`,
          },
        })
    }
  }

  // Prune stale global aggregate rows: (heroSlug, role) combos that no longer
  // appear in player_matches (e.g. after role-derivation changes). Only empty
  // rows are deleted, so curated builds with real content are never removed.
  const current = new Set(rows.map((r) => `${r.heroSlug}::${r.role}`))
  const globalRows = await db
    .select({
      id: heroBuilds.id,
      heroSlug: heroBuilds.heroSlug,
      role: heroBuilds.role,
      buildData: heroBuilds.buildData,
    })
    .from(heroBuilds)
    .where(isNull(heroBuilds.playerId))
  const stale = globalRows.filter((r) => {
    if (current.has(`${r.heroSlug}::${r.role}`)) return false
    const bd = r.buildData as BuildData | null
    const hasContent =
      (bd?.skillBuilds?.length ?? 0) > 0 ||
      (bd?.itemBuild?.startingItems?.length ?? 0) > 0 ||
      (bd?.itemBuild?.coreItems?.length ?? 0) > 0
    return !hasContent
  })
  if (stale.length > 0) {
    await db.delete(heroBuilds).where(
      inArray(
        heroBuilds.id,
        stale.map((r) => r.id)
      )
    )
  }

  console.log(
    `populate-builds done: ${rows.length} rows upserted, ${stale.length} stale rows pruned.`
  )
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
