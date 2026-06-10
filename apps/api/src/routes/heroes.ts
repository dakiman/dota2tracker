import { Hono } from 'hono'
import { and, eq, inArray, or, sql } from 'drizzle-orm'
import { db, heroBuilds, heroStats } from '../db/index.js'
import type { BuildData, HeroBuild, RoleTabStat } from '@friendtracker/shared'

const heroes = new Hono()

heroes.get('/:heroSlug', async (c) => {
  try {
    const heroSlug = c.req.param('heroSlug')?.trim()
    if (!heroSlug || !/^[a-z0-9_]+$/.test(heroSlug)) {
      return c.json({ error: 'Invalid hero slug' }, 400)
    }

    const playersParam = c.req.query('players')
    const playerIds = playersParam
      ?.split(',')
      .map((s) => s.trim())
      .filter((id) => /^\d+$/.test(id))
      .slice(0, 50) ?? null

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

    if (buildRows.length === 0) {
      return c.json({ error: 'Hero build not found' }, 404)
    }

    // Prefer the first row that has actual build content (skill builds or items)
    const first = buildRows.find((r) => {
      try {
        const bd = (typeof r.buildData === 'string' ? JSON.parse(r.buildData) : r.buildData) as BuildData
        return (bd.skillBuilds?.length ?? 0) > 0 || (bd.itemBuild?.startingItems?.length ?? 0) > 0
      } catch {
        return false
      }
    }) ?? buildRows[0]

    // One tab per role; rows are ordered player-specific first, so a player's
    // build wins over the global one for the same role
    const roleTabs: RoleTabStat[] = []
    for (const r of buildRows) {
      if (roleTabs.some((t) => t.role === r.role)) continue
      roleTabs.push({
        role: r.role as RoleTabStat['role'],
        matches: r.totalMatches,
        winRate: r.winRate,
      })
    }

    let buildData: BuildData
    try {
      const rawBuild = first.buildData as BuildData | string
      buildData = typeof rawBuild === 'string' ? JSON.parse(rawBuild) : rawBuild
    } catch {
      buildData = { skillBuilds: [], itemBuild: { startingItems: [], coreItems: [], situationalItems: [], neutralItems: [], lateGameInventories: [] } }
    }
    let statsData
    try {
      const rawStats = first.statsData
      statsData = typeof rawStats === 'string' ? JSON.parse(rawStats) : rawStats ?? undefined
    } catch {
      statsData = undefined
    }

    const payload: HeroBuild = {
      heroId: first.heroId,
      heroName: first.heroName,
      heroSlug: first.heroSlug,
      totalMatches: first.totalMatches,
      winRate: first.winRate,
      roleTabs,
      skillBuilds: buildData.skillBuilds ?? [],
      itemBuild: buildData.itemBuild,
      stats: statsData,
    }

    const statRows = await db
      .select({
        matches: sql<number>`COALESCE(SUM(${heroStats.matches}), 0)::int`,
        wins: sql<number>`COALESCE(SUM(${heroStats.wins}), 0)::int`,
        kills: sql<number>`COALESCE(SUM(${heroStats.kills}), 0)::int`,
        deaths: sql<number>`COALESCE(SUM(${heroStats.deaths}), 0)::int`,
        assists: sql<number>`COALESCE(SUM(${heroStats.assists}), 0)::int`,
      })
      .from(heroStats)
      .where(
        playerIds?.length
          ? and(eq(heroStats.heroSlug, heroSlug), inArray(heroStats.playerId, playerIds))
          : eq(heroStats.heroSlug, heroSlug)
      )
    if (statRows[0] && statRows[0].matches > 0) {
      payload.totalMatches = statRows[0].matches
      payload.winRate = (statRows[0].wins / statRows[0].matches) * 100
      payload.kills = statRows[0].kills
      payload.deaths = statRows[0].deaths
      payload.assists = statRows[0].assists
    }

    return c.json(payload)
  } catch (err) {
    console.error('Route error:', err)
    return c.json({ error: 'Internal server error' }, 500)
  }
})

export default heroes
