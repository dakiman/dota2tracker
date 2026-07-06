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
    index('player_matches_start_time_idx').on(t.startTime.desc()),
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

/** Authenticated site users. Steam OpenID only; `provider` is the
 *  discriminator kept so another provider could be added later. */
export const users = pgTable(
  'users',
  {
    id: serial('id').primaryKey(),
    provider: text('provider').notNull().default('steam'),
    steamId: text('steam_id').notNull(),
    playerId: text('player_id').references(() => players.id, {
      onDelete: 'set null',
    }),
    name: text('name').notNull().default(''),
    avatar: text('avatar'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('users_provider_steam_idx').on(t.provider, t.steamId)]
)

/** Session rows keyed by the sha256 hex of the opaque cookie token —
 *  DB dumps land in the backup dir and must not contain live tokens. */
export const sessions = pgTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    userId: integer('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => [index('sessions_expires_idx').on(t.expiresAt)]
)

/** Payload for queued jobs; only fetch-player uses it today. Lives here
 *  (not in the pipeline package) so the schema stays dependency-free. */
export type JobPayload = { playerId?: string }

/** Job queue drained serially by the API's in-process poller. Queue state
 *  only — execution history lives in refresh_runs. Rows are disposable. */
export const jobs = pgTable(
  'jobs',
  {
    id: serial('id').primaryKey(),
    type: text('type').notNull(),
    payload: jsonb('payload').$type<JobPayload>(),
    status: text('status').notNull().default('pending'),
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => [
    // Dedup: at most one PENDING job per (type, target player). Enqueue is
    // INSERT ... ON CONFLICT DO NOTHING, so duplicates are silent no-ops.
    uniqueIndex('jobs_pending_dedup_idx')
      .on(t.type, sql`coalesce(${t.payload}->>'playerId', '')`)
      .where(sql`${t.status} = 'pending'`),
  ]
)
