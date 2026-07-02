import {
  pgTable,
  text,
  integer,
  real,
  serial,
  timestamp,
  uniqueIndex,
  index,
  jsonb,
  bigint,
  boolean,
  smallint,
  primaryKey,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import type { Role } from '@friendtracker/shared'
import type { BuildData, StatsData } from '@friendtracker/shared'

export const players = pgTable('players', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  avatar: text('avatar'),
})

export const heroBuilds = pgTable(
  'hero_builds',
  {
    id: serial('id').primaryKey(),
    heroId: integer('hero_id').notNull(),
    heroSlug: text('hero_slug').notNull(),
    heroName: text('hero_name').notNull(),
    role: text('role').$type<Role>().notNull(),
    playerId: text('player_id').references(() => players.id, {
      onDelete: 'set null',
    }),
    totalMatches: integer('total_matches').notNull().default(0),
    winRate: real('win_rate').notNull().default(0),
    buildData: jsonb('build_data').$type<BuildData>().notNull(),
    statsData: jsonb('stats_data').$type<StatsData>(),
    lastUpdated: timestamp('last_updated', { withTimezone: true }).defaultNow(),
  },
  (t) => [
    uniqueIndex('hero_role_global_idx').on(t.heroSlug, t.role).where(sql`${t.playerId} IS NULL`),
    uniqueIndex('hero_role_player_idx').on(t.heroSlug, t.role, t.playerId).where(sql`${t.playerId} IS NOT NULL`),
  ]
)

/** OpenDota hero lookup, refreshed by scripts/fetch-data.ts */
export const heroes = pgTable(
  'heroes',
  {
    id: integer('id').primaryKey(),
    name: text('name').notNull(), // localized, e.g. "Anti-Mage"
    slug: text('slug').notNull(), // e.g. "antimage"
  },
  (t) => [uniqueIndex('heroes_slug_idx').on(t.slug)]
)

/** One row per player per significant match — source of truth for all stats */
export const playerMatches = pgTable(
  'player_matches',
  {
    playerId: text('player_id')
      .references(() => players.id, { onDelete: 'cascade' })
      .notNull(),
    matchId: bigint('match_id', { mode: 'number' }).notNull(),
    heroId: integer('hero_id').notNull(),
    won: boolean('won').notNull(),
    kills: integer('kills').notNull().default(0),
    deaths: integer('deaths').notNull().default(0),
    assists: integer('assists').notNull().default(0),
    duration: integer('duration').notNull(),
    startTime: timestamp('start_time', { withTimezone: true }).notNull(),
    laneRole: smallint('lane_role'),
    isRoaming: boolean('is_roaming'),
    role: text('role').$type<Role>().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.playerId, t.matchId] }),
    index('player_matches_hero_idx').on(t.heroId),
  ]
)

/** One row per pipeline job run — written by scripts/run-job.ts */
export const refreshRuns = pgTable('refresh_runs', {
  id: serial('id').primaryKey(),
  job: text('job').notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  ok: boolean('ok'),
  detail: jsonb('detail').$type<{ summary?: string; error?: string }>(),
})
