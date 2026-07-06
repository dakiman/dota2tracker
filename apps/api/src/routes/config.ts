import { Hono } from 'hono'
import { and, desc, eq } from 'drizzle-orm'
import { db, players, refreshRuns } from '@friendtracker/db'
import type { AppConfig } from '@friendtracker/shared'

const config = new Hono()

config.get('/', async (c) => {
  try {
    const rows = await db.select().from(players)
    const [lastRun] = await db
      .select({ finishedAt: refreshRuns.finishedAt })
      .from(refreshRuns)
      .where(and(eq(refreshRuns.job, 'fetch-data'), eq(refreshRuns.ok, true)))
      .orderBy(desc(refreshRuns.finishedAt))
      .limit(1)
    const siteName = process.env.SITE_NAME ?? 'FriendTracker'
    const payload: AppConfig = {
      siteName,
      players: rows.map((p) => ({
        id: p.id,
        name: p.name,
        avatar: p.avatar ?? undefined,
      })),
      lastRefreshed: lastRun?.finishedAt?.toISOString() ?? null,
    }
    return c.json(payload)
  } catch (err) {
    console.error('Route error:', err)
    return c.json({ error: 'Internal server error' }, 500)
  }
})

export default config
