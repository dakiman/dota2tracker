import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { serve } from '@hono/node-server'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { db } from './db/index.js'
import config from './routes/config.js'
import meta from './routes/meta.js'
import heroes from './routes/heroes.js'

const app = new Hono()

app.use(cors())

app.route('/api/config', config)
app.route('/api/meta', meta)
app.route('/api/heroes', heroes)

app.get('/api/health', (c) => c.json({ ok: true }))

try {
  console.log('Running DB migrations...')
  await migrate(db, { migrationsFolder: 'src/db/migrations' })
  console.log('Migrations done.')
} catch (err) {
  console.error('Migration failed:', err)
  process.exit(1)
}

const port = Number(process.env.PORT) || 3000
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`API listening on http://localhost:${info.port}`)
})

export default app
