import { Hono } from 'hono'
import { and, inArray, sql } from 'drizzle-orm'
import { db, heroStats } from '../db/index.js'
import type { HeroStat } from '@friendtracker/shared'

const meta = new Hono()

meta.get('/', async (c) => {
  const playersParam = c.req.query('players')
  const roleParam = c.req.query('role')
  const playerIds = playersParam
    ? playersParam.split(',').map((s) => s.trim()).filter(Boolean)
    : null

  const conditions = []
  if (playerIds?.length) {
    conditions.push(inArray(heroStats.playerId, playerIds))
  }
  if (roleParam) {
    conditions.push(sql`${heroStats.role} = ${roleParam}`)
  }
  const where = conditions.length ? and(...conditions) : undefined

  const rows = await db
    .select({
      heroId: heroStats.heroId,
      heroName: heroStats.heroName,
      heroSlug: heroStats.heroSlug,
      role: heroStats.role,
      matches: sql<number>`COALESCE(SUM(${heroStats.matches}), 0)::int`,
      wins: sql<number>`COALESCE(SUM(${heroStats.wins}), 0)::int`,
      kills: sql<number>`COALESCE(SUM(${heroStats.kills}), 0)::int`,
      deaths: sql<number>`COALESCE(SUM(${heroStats.deaths}), 0)::int`,
      assists: sql<number>`COALESCE(SUM(${heroStats.assists}), 0)::int`,
    })
    .from(heroStats)
    .where(where)
    .groupBy(heroStats.heroId, heroStats.heroName, heroStats.heroSlug, heroStats.role)

  const totalMatches = rows.reduce((sum, r) => sum + r.matches, 0)
  const result: HeroStat[] = rows.map((r) => {
    const winRate = r.matches > 0 ? (r.wins / r.matches) * 100 : 0
    const kda =
      r.deaths > 0
        ? `${(r.kills + r.assists) / r.deaths}`.replace(/(\.\d{1,2}).*/, '$1')
        : `${r.kills + r.assists}`
    const pickRate =
      totalMatches > 0 ? (r.matches / totalMatches) * 100 : undefined
    return {
      heroId: r.heroId,
      heroName: r.heroName,
      heroSlug: r.heroSlug,
      matches: r.matches,
      wins: r.wins,
      winRate,
      kda,
      pickRate,
      role: r.role as HeroStat['role'],
    }
  })

  return c.json(result)
})

export default meta
