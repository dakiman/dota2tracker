import { fileURLToPath } from 'node:url'
import { drizzle } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import * as schema from './schema.js'

const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  throw new Error('DATABASE_URL is required')
}

export const pool = new pg.Pool({ connectionString })
export const db = drizzle(pool, { schema })
export * from './schema.js'
export { and, eq, isNull } from 'drizzle-orm'

/** Absolute path to this package's migrations dir. Resolves relative to the
 *  module file, so it is correct from src/ (tsx) and dist/ (built) alike. */
export const MIGRATIONS_DIR = fileURLToPath(new URL('../migrations', import.meta.url))
