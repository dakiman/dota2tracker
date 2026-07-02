/**
 * Recreates and seeds the friendtracker_test database against the local
 * compose Postgres (published on 5474). Runs once per `vitest run`.
 * Requires: sg docker -c 'docker compose up -d db'
 */
import pg from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'

const BASE = process.env.TEST_PG_BASE ?? 'postgresql://friendtracker:devpassword@localhost:5474'

export default async function setup() {
  const admin = new pg.Client({ connectionString: `${BASE}/postgres` })
  await admin.connect()
  await admin.query('DROP DATABASE IF EXISTS friendtracker_test WITH (FORCE)')
  await admin.query('CREATE DATABASE friendtracker_test')
  await admin.end()

  const pool = new pg.Pool({ connectionString: `${BASE}/friendtracker_test` })
  const db = drizzle(pool)
  await migrate(db, { migrationsFolder: 'apps/api/src/db/migrations' })

  await pool.query(`INSERT INTO players (id, name) VALUES ('111', 'Alice'), ('222', 'Bob')`)
  await pool.query(
    `INSERT INTO heroes (id, name, slug) VALUES (1, 'Anti-Mage', 'antimage'), (2, 'Axe', 'axe')`
  )
  await pool.query(`
    INSERT INTO player_matches
      (player_id, match_id, hero_id, won, kills, deaths, assists, duration, start_time, role)
    VALUES
      ('111', 1001, 1, true,  10, 2,  5, 2400, now(), 'carry'),
      ('111', 1002, 1, false,  3, 8,  4, 1800, now(), 'carry'),
      ('222', 1001, 2, true,   5, 5, 15, 2400, now(), 'offlane')
  `)
  await pool.end()
}
