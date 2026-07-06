import { Hono } from 'hono'
import { and, desc, eq, inArray, lt, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { db, playerMatches } from '@friendtracker/db'
import { parsePlayersParam } from './util.js'
import type { TogetherResponse } from '@friendtracker/shared'

const together = new Hono()

together.get('/', async (c) => {
  try {
    const playerIds = parsePlayersParam(c.req.query('players'))
    if (playerIds === 'invalid') {
      return c.json({ error: 'Invalid players parameter' }, 400)
    }

    // Same team <=> same match + same won value (one match, two teams).
    const a = alias(playerMatches, 'a')
    const b = alias(playerMatches, 'b')

    const duoRows = await db
      .select({
        playerA: a.playerId,
        playerB: b.playerId,
        matches: sql<number>`COUNT(*)::int`,
        wins: sql<number>`COUNT(*) FILTER (WHERE ${a.won})::int`,
      })
      .from(a)
      .innerJoin(
        b,
        and(eq(a.matchId, b.matchId), lt(a.playerId, b.playerId), eq(a.won, b.won))
      )
      .where(
        playerIds?.length
          ? and(inArray(a.playerId, playerIds), inArray(b.playerId, playerIds))
          : undefined
      )
      .groupBy(a.playerId, b.playerId)
      .orderBy(desc(sql`COUNT(*)`))

    const playerFilter = playerIds?.length
      ? sql`WHERE a.player_id IN (${sql.join(playerIds.map((id) => sql`${id}`), sql`, `)})`
      : sql``

    const perPlayer = await db.execute(sql`
      SELECT a.player_id AS "playerId",
             COUNT(*) FILTER (WHERE w.cnt > 0)::int           AS "togetherMatches",
             COUNT(*) FILTER (WHERE w.cnt > 0 AND a.won)::int AS "togetherWins",
             COUNT(*) FILTER (WHERE w.cnt = 0)::int           AS "soloMatches",
             COUNT(*) FILTER (WHERE w.cnt = 0 AND a.won)::int AS "soloWins"
      FROM player_matches a
      JOIN LATERAL (
        SELECT COUNT(*) AS cnt
        FROM player_matches b
        WHERE b.match_id = a.match_id
          AND b.player_id <> a.player_id
          AND b.won = a.won
      ) w ON true
      ${playerFilter}
      GROUP BY a.player_id
      ORDER BY a.player_id
    `)

    const pct = (wins: number, total: number) => (total > 0 ? (wins / total) * 100 : 0)

    const perPlayerRows = perPlayer.rows as Array<{
      playerId: string
      togetherMatches: number
      togetherWins: number
      soloMatches: number
      soloWins: number
    }>

    const payload: TogetherResponse = {
      duos: duoRows.map((d) => ({
        playerA: d.playerA,
        playerB: d.playerB,
        matches: d.matches,
        wins: d.wins,
        winRate: pct(d.wins, d.matches),
      })),
      players: perPlayerRows.map((p) => ({
        playerId: p.playerId,
        togetherMatches: p.togetherMatches,
        togetherWins: p.togetherWins,
        togetherWinRate: pct(p.togetherWins, p.togetherMatches),
        soloMatches: p.soloMatches,
        soloWins: p.soloWins,
        soloWinRate: pct(p.soloWins, p.soloMatches),
      })),
    }
    return c.json(payload)
  } catch (err) {
    console.error('Route error:', err)
    return c.json({ error: 'Internal server error' }, 500)
  }
})

export default together
