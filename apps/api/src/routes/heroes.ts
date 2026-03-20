import { Hono } from 'hono'
import { and, eq, inArray, or, sql } from 'drizzle-orm'
import { db, heroBuilds, heroStats } from '../db/index.js'
import type { BuildData, HeroBuild, RoleTabStat } from '@friendtracker/shared'

const heroes = new Hono()

heroes.get('/:heroSlug', async (c) => {
  const heroSlug = c.req.param('heroSlug')
  const playersParam = c.req.query('players')
  const playerIds = playersParam
    ? playersParam.split(',').map((s) => s.trim()).filter(Boolean)
    : null

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
    .orderBy(sql`${heroBuilds.playerId} IS NULL DESC`, heroBuilds.playerId)

  if (buildRows.length === 0) {
    return c.json({ error: 'Hero build not found' }, 404)
  }

  const first = buildRows[0]
  const roleTabs: RoleTabStat[] = buildRows.map((r) => ({
    role: r.role as RoleTabStat['role'],
    matches: r.totalMatches,
    winRate: r.winRate,
  }))

  const rawBuild = first.buildData as BuildData | string
  const buildData: BuildData =
    typeof rawBuild === 'string' ? JSON.parse(rawBuild) : rawBuild
  const rawStats = first.statsData
  const statsData =
    typeof rawStats === 'string' ? JSON.parse(rawStats) : rawStats ?? undefined

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

  if (playerIds?.length) {
    const statRows = await db
      .select({
        matches: sql<number>`COALESCE(SUM(${heroStats.matches}), 0)::int`,
        wins: sql<number>`COALESCE(SUM(${heroStats.wins}), 0)::int`,
      })
      .from(heroStats)
      .where(
        and(
          eq(heroStats.heroSlug, heroSlug),
          inArray(heroStats.playerId, playerIds)
        )
      )
    if (statRows[0] && statRows[0].matches > 0) {
      payload.totalMatches = statRows[0].matches
      payload.winRate = (statRows[0].wins / statRows[0].matches) * 100
    }
  }

  return c.json(payload)
})

export default heroes
