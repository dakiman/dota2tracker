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
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import type { Role } from '@friendtracker/shared'
import type { BuildData, StatsData } from '@friendtracker/shared'

export const players = pgTable('players', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  avatar: text('avatar'),
})

export const heroStats = pgTable(
  'hero_stats',
  {
    id: serial('id').primaryKey(),
    playerId: text('player_id')
      .references(() => players.id, { onDelete: 'cascade' })
      .notNull(),
    heroId: integer('hero_id').notNull(),
    heroName: text('hero_name').notNull(),
    heroSlug: text('hero_slug').notNull(),
    role: text('role').$type<Role>().notNull(),
    matches: integer('matches').notNull().default(0),
    wins: integer('wins').notNull().default(0),
    kills: integer('kills').notNull().default(0),
    deaths: integer('deaths').notNull().default(0),
    assists: integer('assists').notNull().default(0),
    lastUpdated: timestamp('last_updated').defaultNow(),
  },
  (t) => [
    uniqueIndex('player_hero_idx').on(t.playerId, t.heroId),
    index('hero_slug_idx').on(t.heroSlug),
    index('role_idx').on(t.role),
  ]
)

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
    lastUpdated: timestamp('last_updated').defaultNow(),
  },
  (t) => [
    uniqueIndex('hero_role_global_idx').on(t.heroSlug, t.role).where(sql`${t.playerId} IS NULL`),
    uniqueIndex('hero_role_player_idx').on(t.heroSlug, t.role, t.playerId).where(sql`${t.playerId} IS NOT NULL`),
  ]
)
