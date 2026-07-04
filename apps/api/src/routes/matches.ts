import { Hono } from 'hono'
import { and, desc, eq, inArray, lt, sql } from 'drizzle-orm'
import { db, heroes, playerMatches, players } from '../db/index.js'
import { parsePlayersParam } from './util.js'
import type { MatchesResponse, MatchFeedEntry, MatchParticipant } from '@friendtracker/shared'

const matches = new Hono()

matches.get('/', async (c) => {
  try {
    const playerIds = parsePlayersParam(c.req.query('players'))
    if (playerIds === 'invalid') {
      return c.json({ error: 'Invalid players parameter' }, 400)
    }

    const limitRaw = Number(c.req.query('limit'))
    const limit = Number.isInteger(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 50) : 20
    const beforeRaw = Number(c.req.query('before'))
    const before =
      Number.isFinite(beforeRaw) && beforeRaw > 0 ? new Date(beforeRaw * 1000) : null

    // Step 1: which matches make this page. The players filter picks WHICH
    // matches appear; step 2 still returns every tracked participant of them.
    const conditions = []
    if (playerIds?.length) conditions.push(inArray(playerMatches.playerId, playerIds))
    if (before) conditions.push(lt(playerMatches.startTime, before))

    const groups = await db
      .select({ matchId: playerMatches.matchId })
      .from(playerMatches)
      .where(conditions.length ? and(...conditions) : undefined)
      .groupBy(playerMatches.matchId)
      .orderBy(desc(sql`MAX(${playerMatches.startTime})`))
      .limit(limit)

    const matchIds = groups.map((g) => g.matchId)
    const entries = new Map<number, MatchFeedEntry>()

    if (matchIds.length) {
      const rows = await db
        .select({
          matchId: playerMatches.matchId,
          startTime: playerMatches.startTime,
          duration: playerMatches.duration,
          playerId: playerMatches.playerId,
          playerName: players.name,
          avatar: players.avatar,
          heroId: playerMatches.heroId,
          heroName: heroes.name,
          heroSlug: heroes.slug,
          won: playerMatches.won,
          kills: playerMatches.kills,
          deaths: playerMatches.deaths,
          assists: playerMatches.assists,
          role: playerMatches.role,
        })
        .from(playerMatches)
        .innerJoin(heroes, eq(playerMatches.heroId, heroes.id))
        .innerJoin(players, eq(playerMatches.playerId, players.id))
        .where(inArray(playerMatches.matchId, matchIds))
        .orderBy(playerMatches.playerId)

      for (const r of rows) {
        let entry = entries.get(r.matchId)
        if (!entry) {
          entry = {
            matchId: r.matchId,
            startTime: r.startTime.toISOString(),
            duration: r.duration,
            participants: [],
          }
          entries.set(r.matchId, entry)
        }
        const participant: MatchParticipant = {
          playerId: r.playerId,
          playerName: r.playerName,
          avatar: r.avatar,
          heroId: r.heroId,
          heroName: r.heroName,
          heroSlug: r.heroSlug,
          won: r.won,
          kills: r.kills,
          deaths: r.deaths,
          assists: r.assists,
          role: r.role,
        }
        entry.participants.push(participant)
      }
    }

    // Recency order comes from the group query, not the participant fetch
    const ordered = matchIds
      .map((id) => entries.get(id))
      .filter((e): e is MatchFeedEntry => e !== undefined)

    const last = ordered[ordered.length - 1]
    const nextBefore =
      ordered.length === limit && last
        ? Math.floor(new Date(last.startTime).getTime() / 1000)
        : null

    const payload: MatchesResponse = { matches: ordered, nextBefore }
    return c.json(payload)
  } catch (err) {
    console.error('Route error:', err)
    return c.json({ error: 'Internal server error' }, 500)
  }
})

export default matches
