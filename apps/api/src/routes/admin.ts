import { Hono } from 'hono'
import { enqueue } from '@friendtracker/pipeline'
import type { AuthEnv } from '../middleware/session.js'
import { requireAdmin } from '../middleware/authz.js'

const admin = new Hono<AuthEnv>()

admin.post('/refresh', requireAdmin, async (c) => {
  try {
    // The standard 6h trio; queue order = pipeline order. Pending dedup
    // makes hammering the button a no-op.
    const inserted = await enqueue([
      { type: 'fetch-data' },
      { type: 'populate-builds' },
      { type: 'request-parses' },
    ])
    return c.json({ queued: inserted > 0 }, inserted > 0 ? 202 : 200)
  } catch (err) {
    console.error('Route error:', err)
    return c.json({ error: 'Internal server error' }, 500)
  }
})

export default admin
