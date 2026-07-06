import { Hono } from 'hono'
import { and, desc, eq, inArray, or, sql } from 'drizzle-orm'
import { db, heroBuilds, heroes as heroesTable, playerMatches } from '@friendtracker/db'
import { parsePlayersParam } from './util.js'
import type { BuildData, HeroBuild, Role, RoleBuild, RoleTabStat, StatsData } from '@friendtracker/shared'

const heroes = new Hono()

const EMPTY_ITEM_BUILD = {
  startingItems: [],
  coreItems: [],
  situationalItems: [],
  neutralItems: [],
  lateGameInventories: [],
}

heroes.get('/:heroSlug', async (c) => {
  try {
    const heroSlug = c.req.param('heroSlug')?.trim()
    if (!heroSlug || !/^[a-z0-9_]+$/.test(heroSlug)) {
      return c.json({ error: 'Invalid hero slug' }, 400)
    }

    const playerIds = parsePlayersParam(c.req.query('players'))
    if (playerIds === 'invalid') {
      return c.json({ error: 'Invalid players parameter' }, 400)
    }

    const buildRows = await db
      .select()
      .from(heroBuilds)
      .where(
        playerIds?.length
          ? and(
              eq(heroBuilds.heroSlug, heroSlug),
              or(
                inArray(heroBuilds.playerId, playerIds),
                sql`${heroBuilds.playerId} IS NULL`
              )
            )
          : eq(heroBuilds.heroSlug, heroSlug)
      )
      .orderBy(sql`${heroBuilds.playerId} IS NULL ASC`, heroBuilds.playerId)

    // The hero itself must exist even if no curated/aggregated build row does —
    // any newly-played hero has player_matches we can still serve.
    const heroRow = await db
      .select({ id: heroesTable.id, name: heroesTable.name, slug: heroesTable.slug })
      .from(heroesTable)
      .where(eq(heroesTable.slug, heroSlug))
      .limit(1)

    if (buildRows.length === 0 && heroRow.length === 0) {
      return c.json({ error: 'Hero not found' }, 404)
    }

    // Build content grouped by role. buildRows are ordered player-specific
    // first, global last, so the first row with content per role wins.
    const buildsByRole = new Map<Role, RoleBuild>()
    for (const r of buildRows) {
      const bd = r.buildData as BuildData | null
      const hasContent =
        (bd?.skillBuilds?.length ?? 0) > 0 ||
        (bd?.itemBuild?.startingItems?.length ?? 0) > 0 ||
        (bd?.itemBuild?.coreItems?.length ?? 0) > 0
      if (!hasContent) continue
      const role = r.role as Role
      if (buildsByRole.has(role)) continue
      buildsByRole.set(role, {
        role,
        playerId: r.playerId ?? null,
        skillBuilds: bd?.skillBuilds ?? [],
        itemBuild: bd?.itemBuild ?? EMPTY_ITEM_BUILD,
        stats: (r.statsData as StatsData | null) ?? undefined,
      })
    }

    const base = heroRow[0]
    const anyBuild = buildRows[0]
    const payload: HeroBuild = {
      heroId: base?.id ?? anyBuild.heroId,
      heroName: base?.name ?? anyBuild.heroName,
      heroSlug: base?.slug ?? anyBuild.heroSlug,
      totalMatches: 0,
      winRate: 0,
      wins: 0,
      roleTabs: [],
      builds: [...buildsByRole.values()],
    }

    if (heroRow.length > 0) {
      const matchFilter = playerIds?.length
        ? and(
            eq(playerMatches.heroId, heroRow[0].id),
            inArray(playerMatches.playerId, playerIds)
          )
        : eq(playerMatches.heroId, heroRow[0].id)

      // Header aggregate over player_matches (all roles combined)
      const statRows = await db
        .select({
          matches: sql<number>`COUNT(*)::int`,
          wins: sql<number>`COUNT(*) FILTER (WHERE ${playerMatches.won})::int`,
          kills: sql<number>`COALESCE(SUM(${playerMatches.kills}), 0)::int`,
          deaths: sql<number>`COALESCE(SUM(${playerMatches.deaths}), 0)::int`,
          assists: sql<number>`COALESCE(SUM(${playerMatches.assists}), 0)::int`,
        })
        .from(playerMatches)
        .where(matchFilter)
      if (statRows[0] && statRows[0].matches > 0) {
        payload.totalMatches = statRows[0].matches
        payload.wins = statRows[0].wins
        payload.winRate = (statRows[0].wins / statRows[0].matches) * 100
        payload.kills = statRows[0].kills
        payload.deaths = statRows[0].deaths
        payload.assists = statRows[0].assists
      }

      // Role tabs from player_matches so they share one source with the header
      // and honor the player filter, instead of stale hero_builds counts.
      const roleRows = await db
        .select({
          role: playerMatches.role,
          matches: sql<number>`COUNT(*)::int`,
          wins: sql<number>`COUNT(*) FILTER (WHERE ${playerMatches.won})::int`,
        })
        .from(playerMatches)
        .where(matchFilter)
        .groupBy(playerMatches.role)
        .orderBy(desc(sql`COUNT(*)`))
      payload.roleTabs = roleRows.map((r) => ({
        role: r.role as RoleTabStat['role'],
        matches: r.matches,
        winRate: r.matches > 0 ? (r.wins / r.matches) * 100 : 0,
      }))
    }

    return c.json(payload)
  } catch (err) {
    console.error('Route error:', err)
    return c.json({ error: 'Internal server error' }, 500)
  }
})

export default heroes
