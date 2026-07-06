import { serve } from '@hono/node-server'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { db, pool, MIGRATIONS_DIR } from '@friendtracker/db'
import { app } from './app.js'

try {
  console.log('Running DB migrations...')
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR })
  console.log('Migrations done.')
} catch (err) {
  console.error('Migration failed:', err)
  process.exit(1)
}

const port = Number(process.env.PORT) || 3000
const server = serve({ fetch: app.fetch, port }, (info) => {
  console.log(`API listening on http://localhost:${info.port}`)
})

let shuttingDown = false
function shutdown(signal: string) {
  if (shuttingDown) return
  shuttingDown = true
  console.log(`${signal} received, shutting down...`)
  server.close((err) => {
    void pool.end().finally(() => process.exit(err ? 1 : 0))
  })
  // In-flight keep-alive connections can hold close() open — don't wait forever.
  setTimeout(() => process.exit(1), 10_000).unref()
}
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
