import { Hono } from 'hono'
import { and, eq, inArray, sql, desc } from 'drizzle-orm'
import { db, heroes, playerMatches } from '../db/index.js'
import type { HeroStat, Role } from '@friendtracker/shared'

const meta = new Hono()

meta.get('/', async (c) => {
  try {
    const playersParam = c.req.query('players')
    const roleParam = c.req.query('role')

    const VALID_ROLES = ['carry', 'mid', 'offlane', 'support', 'hard_support'] as const
    if (roleParam && !VALID_ROLES.includes(roleParam as any)) {
      return c.json({ error: 'Invalid role' }, 400)
    }

    const playerIds = playersParam
      ?.split(',')
      .map((s) => s.trim())
      .filter((id) => /^\d+$/.test(id))
      .slice(0, 50) ?? null

    // A non-empty players param that yields no valid IDs is malformed — 400
    // rather than silently dropping the filter and returning everyone.
    if (playersParam && playerIds && playerIds.length === 0) {
      return c.json({ error: 'Invalid players parameter' }, 400)
    }

    const conditions = []
    if (playerIds?.length) {
      conditions.push(inArray(playerMatches.playerId, playerIds))
    }
    if (roleParam) {
      conditions.push(eq(playerMatches.role, roleParam as Role))
    }
    const where = conditions.length ? and(...conditions) : undefined

    const rows = await db
      .select({
        heroId: playerMatches.heroId,
        heroName: heroes.name,
        heroSlug: heroes.slug,
        role: playerMatches.role,
        matches: sql<number>`COUNT(*)::int`,
        wins: sql<number>`COUNT(*) FILTER (WHERE ${playerMatches.won})::int`,
        kills: sql<number>`COALESCE(SUM(${playerMatches.kills}), 0)::int`,
        deaths: sql<number>`COALESCE(SUM(${playerMatches.deaths}), 0)::int`,
        assists: sql<number>`COALESCE(SUM(${playerMatches.assists}), 0)::int`,
      })
      .from(playerMatches)
      .innerJoin(heroes, eq(playerMatches.heroId, heroes.id))
      .where(where)
      .groupBy(playerMatches.heroId, heroes.name, heroes.slug, playerMatches.role)
      .orderBy(desc(sql`COUNT(*)`))
      .limit(500)

    const result: HeroStat[] = rows.map((r) => {
      const winRate = r.matches > 0 ? (r.wins / r.matches) * 100 : 0
      const kda =
        r.deaths > 0
          ? ((r.kills + r.assists) / r.deaths).toFixed(2)
          : `${r.kills + r.assists}`
      return {
        heroId: r.heroId,
        heroName: r.heroName,
        heroSlug: r.heroSlug,
        matches: r.matches,
        wins: r.wins,
        winRate,
        kda,
        role: r.role,
      }
    })

    return c.json(result)
  } catch (err) {
    console.error('Route error:', err)
    return c.json({ error: 'Internal server error' }, 500)
  }
})

export default meta
