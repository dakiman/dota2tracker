import { serve } from '@hono/node-server'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { db } from './db/index.js'
import { app } from './app.js'

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
