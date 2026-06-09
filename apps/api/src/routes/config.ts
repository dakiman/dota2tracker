import { Hono } from 'hono'
import { db, players } from '../db/index.js'
import type { AppConfig } from '@friendtracker/shared'

const config = new Hono()

config.get('/', async (c) => {
  try {
    const rows = await db.select().from(players)
    const siteName = process.env.SITE_NAME ?? 'FriendTracker'
    const payload: AppConfig = {
      siteName,
      players: rows.map((p) => ({
        id: p.id,
        name: p.name,
        avatar: p.avatar ?? undefined,
      })),
    }
    return c.json(payload)
  } catch (err) {
    console.error('Route error:', err)
    return c.json({ error: 'Internal server error' }, 500)
  }
})

export default config
