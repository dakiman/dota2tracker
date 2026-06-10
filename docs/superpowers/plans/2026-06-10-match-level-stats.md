# Match-Level Stats + Slim API Image Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace stored per-hero aggregates with per-match storage so matches/wins/K/D/A/roles all derive from the same rows, and shrink the API Docker image to prod-deps-only.

**Architecture:** New `player_matches` (source of truth, one row per player per significant match, role derived at ingest) and `heroes` (id→name/slug lookup) tables; `hero_stats` is dropped at the end. Routes and scripts aggregate `player_matches` with `GROUP BY`. The API Dockerfile gets a final stage with a fresh `pnpm install --prod`.

**Tech Stack:** Drizzle ORM (node-postgres), Hono, OpenDota API, pnpm workspaces, Docker.

**Spec:** `docs/superpowers/specs/2026-06-10-match-level-stats-design.md`

**Note on tests:** The owner explicitly deferred adding a test runner. Verification per task is `pnpm lint` (type-checks all packages AND `scripts/` via `tsc -p scripts`); Task 10 is an end-to-end smoke test of the full stack. Do not add a test framework.

**Conventions:** All commands run from repo root `/home/dakiman/dev/dota2tracker`. Commit identity: `git -c user.email=dvancov@hotmail.com -c user.name=dakiman commit ...`. Every commit message ends with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: Commit the pending cleanup baseline

The working tree already contains an approved-but-uncommitted cleanup pass (bug fixes, Dockerfile pins, recreated compose/.env.example, doc rewrites, deleted screenshots). Commit it as-is so subsequent tasks produce focused diffs.

**Files:** everything currently shown by `git status -s` (modifications, deletions, and the untracked `.env.example`, `docker-compose.yml`, `scripts/tsconfig.json`).

- [ ] **Step 1: Verify lint is green before committing**

Run: `pnpm lint`
Expected: exit 0, no errors (shared builds, then api/web/scripts type-check).

- [ ] **Step 2: Commit everything pending**

```bash
git add -A
git -c user.email=dvancov@hotmail.com -c user.name=dakiman commit -m "Cleanup pass: fix player-filter logic, role-tab dupes, seed clobbering; restore compose/.env.example; prune stale docs

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

Run: `git status -s`
Expected: empty output.

---

### Task 2: Add `deriveRole()` to the shared package

**Files:**
- Modify: `packages/shared/src/constants.ts` (append after `getHeroRole`, which is the last function in the file)

- [ ] **Step 1: Append the role-derivation function**

Add to the end of `packages/shared/src/constants.ts`:

```ts
const SUPPORT_ROLES: ReadonlySet<Role> = new Set(['support', 'hard_support'])

/**
 * Derive the role actually played in a match from OpenDota lane data.
 * lane_role: 1 = safe lane, 2 = mid, 3 = offlane, 4 = jungle; null until the
 * match is parsed. HERO_ROLE_MAP decides support vs core within a lane and is
 * the fallback for unparsed matches.
 */
export function deriveRole(
  laneRole: number | null | undefined,
  isRoaming: boolean | null | undefined,
  heroId: number
): Role {
  const supportFlavored = SUPPORT_ROLES.has(getHeroRole(heroId))
  if (isRoaming) return 'support'
  switch (laneRole) {
    case 1:
      return supportFlavored ? 'hard_support' : 'carry'
    case 2:
      return 'mid'
    case 3:
    case 4:
      return supportFlavored ? 'support' : 'offlane'
    default:
      return getHeroRole(heroId)
  }
}
```

- [ ] **Step 2: Type-check**

Run: `pnpm lint`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/constants.ts
git -c user.email=dvancov@hotmail.com -c user.name=dakiman commit -m "Add deriveRole(): per-match role from OpenDota lane data

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Add `heroes` and `player_matches` tables (keep `hero_stats` for now)

`hero_stats` stays until Task 8 so every intermediate task type-checks.

**Files:**
- Modify: `apps/api/src/db/schema.ts`
- Create: `apps/api/src/db/migrations/0002_player_matches.sql`
- Modify: `apps/api/src/db/migrations/meta/_journal.json`

- [ ] **Step 1: Extend the drizzle-orm/pg-core import in `schema.ts`**

Replace the existing import block at the top of `apps/api/src/db/schema.ts`:

```ts
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
```

- [ ] **Step 2: Append the two new tables at the end of `schema.ts`**

```ts
/** OpenDota hero lookup, refreshed by scripts/fetch-data.ts */
export const heroes = pgTable('heroes', {
  id: integer('id').primaryKey(),
  name: text('name').notNull(), // localized, e.g. "Anti-Mage"
  slug: text('slug').notNull(), // e.g. "antimage"
})

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
    startTime: timestamp('start_time').notNull(),
    laneRole: smallint('lane_role'),
    isRoaming: boolean('is_roaming'),
    role: text('role').$type<Role>().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.playerId, t.matchId] }),
    index('player_matches_hero_idx').on(t.heroId),
  ]
)
```

- [ ] **Step 3: Create `apps/api/src/db/migrations/0002_player_matches.sql`**

Hand-written (matching the existing hand-written `0001_partial_hero_builds_idx.sql` pattern — do NOT run `drizzle-kit generate`, it prompts interactively on table drops/renames):

```sql
CREATE TABLE IF NOT EXISTS "heroes" (
	"id" integer PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "player_matches" (
	"player_id" text NOT NULL,
	"match_id" bigint NOT NULL,
	"hero_id" integer NOT NULL,
	"won" boolean NOT NULL,
	"kills" integer DEFAULT 0 NOT NULL,
	"deaths" integer DEFAULT 0 NOT NULL,
	"assists" integer DEFAULT 0 NOT NULL,
	"duration" integer NOT NULL,
	"start_time" timestamp NOT NULL,
	"lane_role" smallint,
	"is_roaming" boolean,
	"role" text NOT NULL,
	CONSTRAINT "player_matches_player_id_match_id_pk" PRIMARY KEY ("player_id","match_id"),
	CONSTRAINT "player_matches_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "players"("id") ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "player_matches_hero_idx" ON "player_matches" ("hero_id");
```

- [ ] **Step 4: Append the journal entry**

In `apps/api/src/db/migrations/meta/_journal.json`, add to the `entries` array after the idx 1 entry:

```json
    {
      "idx": 2,
      "version": "7",
      "when": 1781049600000,
      "tag": "0002_player_matches",
      "breakpoints": true
    }
```

- [ ] **Step 5: Type-check**

Run: `pnpm lint`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/db/schema.ts apps/api/src/db/migrations
git -c user.email=dvancov@hotmail.com -c user.name=dakiman commit -m "Add heroes and player_matches tables

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Rewrite `fetch-data.ts` to sync full match history

**Files:**
- Modify: `scripts/fetch-data.ts` (full replacement)

- [ ] **Step 1: Replace the entire file content of `scripts/fetch-data.ts` with:**

```ts
/**
 * Syncs the heroes lookup table and each player's full significant-match
 * history from OpenDota into player_matches. Idempotent: re-runs upsert every
 * row, picking up lane data for matches parsed since the last run.
 * Run: pnpm fetch-data (from repo root). Requires DATABASE_URL and players in DB.
 */
import 'dotenv/config'
import { sql } from 'drizzle-orm'
import { db, heroes, playerMatches, players } from '../apps/api/src/db/index.js'
import { heroNameToSlug, deriveRole } from '@friendtracker/shared'

const OPENDOTA = 'https://api.opendota.com/api'
const RATE_MS = 1100
const CHUNK = 500

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`OpenDota ${res.status}: ${url}`)
  return res.json() as Promise<T>
}

interface OpenDotaHero {
  id: number
  name: string
  localized_name: string
}

// OpenDota only returns the projected fields; the default (no `significant`
// param) already excludes turbo and other non-significant game modes.
const MATCH_PROJECT = [
  'hero_id',
  'kills',
  'deaths',
  'assists',
  'duration',
  'player_slot',
  'radiant_win',
  'lane_role',
  'is_roaming',
  'start_time',
].join(',')

interface MatchRow {
  match_id: number
  hero_id: number
  kills: number | null
  deaths: number | null
  assists: number | null
  duration: number
  player_slot: number
  radiant_win: boolean
  lane_role: number | null
  is_roaming: boolean | null
  start_time: number
}

async function main() {
  const playerRows = await db.select().from(players)
  if (playerRows.length === 0) {
    console.log('No players in DB. Run seed first.')
    process.exit(0)
  }

  const heroList = await fetchJson<OpenDotaHero[]>(`${OPENDOTA}/heroes`)
  await sleep(RATE_MS)
  for (const h of heroList) {
    const values = { id: h.id, name: h.localized_name, slug: heroNameToSlug(h.name) }
    await db.insert(heroes).values(values).onConflictDoUpdate({
      target: heroes.id,
      set: { name: values.name, slug: values.slug },
    })
  }
  console.log(`Synced ${heroList.length} heroes.`)

  const heroIds = new Set(heroList.map((h) => h.id))

  for (const player of playerRows) {
    const matches = await fetchJson<MatchRow[]>(
      `${OPENDOTA}/players/${player.id}/matches?project=${MATCH_PROJECT}`
    )
    await sleep(RATE_MS)

    const rows = matches
      .filter((m) => heroIds.has(m.hero_id))
      .map((m) => ({
        playerId: player.id,
        matchId: m.match_id,
        heroId: m.hero_id,
        won: (m.player_slot < 128) === m.radiant_win,
        kills: m.kills ?? 0,
        deaths: m.deaths ?? 0,
        assists: m.assists ?? 0,
        duration: m.duration,
        startTime: new Date(m.start_time * 1000),
        laneRole: m.lane_role ?? null,
        isRoaming: m.is_roaming ?? null,
        role: deriveRole(m.lane_role, m.is_roaming, m.hero_id),
      }))

    for (let i = 0; i < rows.length; i += CHUNK) {
      await db
        .insert(playerMatches)
        .values(rows.slice(i, i + CHUNK))
        .onConflictDoUpdate({
          target: [playerMatches.playerId, playerMatches.matchId],
          set: {
            heroId: sql`excluded.hero_id`,
            won: sql`excluded.won`,
            kills: sql`excluded.kills`,
            deaths: sql`excluded.deaths`,
            assists: sql`excluded.assists`,
            duration: sql`excluded.duration`,
            startTime: sql`excluded.start_time`,
            laneRole: sql`excluded.lane_role`,
            isRoaming: sql`excluded.is_roaming`,
            role: sql`excluded.role`,
          },
        })
    }
    console.log(`Upserted ${rows.length} matches for ${player.name} (${player.id})`)
  }

  console.log('Fetch done.')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
```

- [ ] **Step 2: Type-check**

Run: `pnpm lint`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add scripts/fetch-data.ts
git -c user.email=dvancov@hotmail.com -c user.name=dakiman commit -m "fetch-data: sync full match history into player_matches

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Trim `seed.ts` to players + curated build

**Files:**
- Modify: `scripts/seed.ts`

- [ ] **Step 1: Update the import** (line 6) — drop `heroStats`:

```ts
import { db, players, heroBuilds, and, eq, isNull } from '../apps/api/src/db/index.js'
```

- [ ] **Step 2: Delete the sample stats block**

Delete everything from `const sampleHeroStats = [` down to (and including) `console.log('Seeded sample hero_stats.')` — i.e. the `sampleHeroStats` array, the nested `for (const player of SAMPLE_PLAYERS) { for (const h of sampleHeroStats) { ... } }` loop, and that log line. `console.log('Seed done.')` remains as the last statement of `main()`.

- [ ] **Step 3: Update the file header comment** (first line of the doc block):

```ts
/**
 * Seeds players and one curated hero build (Abaddon).
 * Real stats come from `pnpm fetch-data` (player_matches).
 * Run: pnpm seed (from repo root). Requires DATABASE_URL.
 */
```

- [ ] **Step 4: Type-check**

Run: `pnpm lint`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add scripts/seed.ts
git -c user.email=dvancov@hotmail.com -c user.name=dakiman commit -m "seed: drop fake sample hero_stats

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Point `populate-builds.ts` and `fetch-player-builds.ts` at `player_matches`

**Files:**
- Modify: `scripts/populate-builds.ts`
- Modify: `scripts/fetch-player-builds.ts`

- [ ] **Step 1: In `populate-builds.ts`, update the imports** (drop `heroStats`, add `playerMatches` + `heroes`):

```ts
import { db, playerMatches, heroes, heroBuilds, and, eq, isNull } from '../apps/api/src/db/index.js'
```

- [ ] **Step 2: Replace the aggregation query at the top of `main()`**

Replace the `const rows = await db.select({...}).from(heroStats)...having(...)` statement with:

```ts
  const rows = await db
    .select({
      heroId: playerMatches.heroId,
      heroName: heroes.name,
      heroSlug: heroes.slug,
      role: playerMatches.role,
      totalMatches: sql<number>`COUNT(*)::int`,
      wins: sql<number>`COUNT(*) FILTER (WHERE ${playerMatches.won})::int`,
    })
    .from(playerMatches)
    .innerJoin(heroes, eq(playerMatches.heroId, heroes.id))
    .groupBy(playerMatches.heroId, heroes.name, heroes.slug, playerMatches.role)
```

(No `HAVING` needed — a group exists only if it has rows. The console.log line below it referring to "hero+role combinations in hero_stats" should say "in player_matches". The rest of `main()` — the existing/update/insert logic using `row.role as Role` — is unchanged and still type-checks because `playerMatches.role` is typed `Role`.)

- [ ] **Step 3: In `fetch-player-builds.ts`, update the imports** (drop `heroStats`, add `playerMatches` + `heroes`):

```ts
import { db, playerMatches, heroes, heroBuilds, players, and, eq } from '../apps/api/src/db/index.js'
```

- [ ] **Step 4: Replace the per-player hero list query in `main()`**

Replace the `const playerHeroRows = await db.select({...}).from(heroStats).where(eq(heroStats.playerId, pid))` statement with:

```ts
    const playerHeroRows = await db
      .select({
        heroId: playerMatches.heroId,
        heroName: heroes.name,
        heroSlug: heroes.slug,
        matches: sql<number>`COUNT(*)::int`,
      })
      .from(playerMatches)
      .innerJoin(heroes, eq(playerMatches.heroId, heroes.id))
      .where(eq(playerMatches.playerId, pid))
      .groupBy(playerMatches.heroId, heroes.name, heroes.slug)
```

(The `hero.matches < MIN_PARSED_MATCHES` skip and everything downstream is unchanged. `hero_builds` upserts still use `getHeroRole(hero.heroId)` for the build's role — builds stay per primary role by design.)

- [ ] **Step 5: Type-check**

Run: `pnpm lint`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add scripts/populate-builds.ts scripts/fetch-player-builds.ts
git -c user.email=dvancov@hotmail.com -c user.name=dakiman commit -m "Build scripts: aggregate from player_matches instead of hero_stats

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Switch API routes to `player_matches`

**Files:**
- Modify: `apps/api/src/routes/meta.ts` (full replacement)
- Modify: `apps/api/src/routes/heroes.ts` (imports + the stats-override block)

- [ ] **Step 1: Replace the entire content of `apps/api/src/routes/meta.ts` with:**

```ts
import { Hono } from 'hono'
import { and, eq, inArray, sql, desc } from 'drizzle-orm'
import { db, heroes, playerMatches } from '../db/index.js'
import type { HeroStat, Role } from '@friendtracker/shared'

const meta = new Hono()

meta.get('/', async (c) => {
  try {
    const playersParam = c.req.query('players')
    const roleParam = c.req.query('role')

    const VALID_ROLES = ['carry', 'mid', 'offlane', 'support', 'hard_support'] as const
    if (roleParam && !VALID_ROLES.includes(roleParam as any)) {
      return c.json({ error: 'Invalid role' }, 400)
    }

    const playerIds = playersParam
      ?.split(',')
      .map((s) => s.trim())
      .filter((id) => /^\d+$/.test(id))
      .slice(0, 50) ?? null

    const conditions = []
    if (playerIds?.length) {
      conditions.push(inArray(playerMatches.playerId, playerIds))
    }
    if (roleParam) {
      conditions.push(eq(playerMatches.role, roleParam as Role))
    }
    const where = conditions.length ? and(...conditions) : undefined

    const rows = await db
      .select({
        heroId: playerMatches.heroId,
        heroName: heroes.name,
        heroSlug: heroes.slug,
        role: playerMatches.role,
        matches: sql<number>`COUNT(*)::int`,
        wins: sql<number>`COUNT(*) FILTER (WHERE ${playerMatches.won})::int`,
        kills: sql<number>`COALESCE(SUM(${playerMatches.kills}), 0)::int`,
        deaths: sql<number>`COALESCE(SUM(${playerMatches.deaths}), 0)::int`,
        assists: sql<number>`COALESCE(SUM(${playerMatches.assists}), 0)::int`,
      })
      .from(playerMatches)
      .innerJoin(heroes, eq(playerMatches.heroId, heroes.id))
      .where(where)
      .groupBy(playerMatches.heroId, heroes.name, heroes.slug, playerMatches.role)
      .orderBy(desc(sql`COUNT(*)`))
      .limit(500)

    const totalMatches = rows.reduce((sum, r) => sum + r.matches, 0)
    const result: HeroStat[] = rows.map((r) => {
      const winRate = r.matches > 0 ? (r.wins / r.matches) * 100 : 0
      const kda =
        r.deaths > 0
          ? ((r.kills + r.assists) / r.deaths).toFixed(2)
          : `${r.kills + r.assists}`
      const pickRate =
        totalMatches > 0 ? (r.matches / totalMatches) * 100 : undefined
      return {
        heroId: r.heroId,
        heroName: r.heroName,
        heroSlug: r.heroSlug,
        matches: r.matches,
        wins: r.wins,
        winRate,
        kda,
        pickRate,
        role: r.role,
      }
    })

    return c.json(result)
  } catch (err) {
    console.error('Route error:', err)
    return c.json({ error: 'Internal server error' }, 500)
  }
})

export default meta
```

- [ ] **Step 2: In `apps/api/src/routes/heroes.ts`, update the imports**

```ts
import { Hono } from 'hono'
import { and, eq, inArray, or, sql } from 'drizzle-orm'
import { db, heroBuilds, heroes, playerMatches } from '../db/index.js'
import type { BuildData, HeroBuild, RoleTabStat } from '@friendtracker/shared'
```

- [ ] **Step 3: Replace the stats-override block in `heroes.ts`**

Replace from `const statRows = await db` through the closing of the `if (statRows[0] && ...)` block with:

```ts
    const heroRow = await db
      .select({ id: heroes.id })
      .from(heroes)
      .where(eq(heroes.slug, heroSlug))
      .limit(1)

    if (heroRow.length > 0) {
      const statRows = await db
        .select({
          matches: sql<number>`COUNT(*)::int`,
          wins: sql<number>`COUNT(*) FILTER (WHERE ${playerMatches.won})::int`,
          kills: sql<number>`COALESCE(SUM(${playerMatches.kills}), 0)::int`,
          deaths: sql<number>`COALESCE(SUM(${playerMatches.deaths}), 0)::int`,
          assists: sql<number>`COALESCE(SUM(${playerMatches.assists}), 0)::int`,
        })
        .from(playerMatches)
        .where(
          playerIds?.length
            ? and(
                eq(playerMatches.heroId, heroRow[0].id),
                inArray(playerMatches.playerId, playerIds)
              )
            : eq(playerMatches.heroId, heroRow[0].id)
        )
      if (statRows[0] && statRows[0].matches > 0) {
        payload.totalMatches = statRows[0].matches
        payload.winRate = (statRows[0].wins / statRows[0].matches) * 100
        payload.kills = statRows[0].kills
        payload.deaths = statRows[0].deaths
        payload.assists = statRows[0].assists
      }
    }
```

(Everything above it — slug validation, build row selection, roleTabs dedupe, buildData parsing — is untouched. `heroStats` no longer appears anywhere in the file.)

- [ ] **Step 4: Type-check**

Run: `pnpm lint`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/meta.ts apps/api/src/routes/heroes.ts
git -c user.email=dvancov@hotmail.com -c user.name=dakiman commit -m "API routes: aggregate player_matches instead of hero_stats

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: Drop `hero_stats`

**Files:**
- Modify: `apps/api/src/db/schema.ts` (delete the `heroStats` table definition)
- Create: `apps/api/src/db/migrations/0003_drop_hero_stats.sql`
- Modify: `apps/api/src/db/migrations/meta/_journal.json`

- [ ] **Step 1: Delete the `heroStats` definition from `schema.ts`**

Delete the whole `export const heroStats = pgTable('hero_stats', ...)` statement. Leave the pg-core import block unchanged — every name in it is still used by the remaining tables (`serial`/`real`/`uniqueIndex`/`jsonb` by `heroBuilds`, `index`/`bigint`/`boolean`/`smallint`/`primaryKey`/`timestamp` by `playerMatches`, `text`/`integer`/`pgTable` everywhere).

- [ ] **Step 2: Create `apps/api/src/db/migrations/0003_drop_hero_stats.sql`**

```sql
DROP TABLE IF EXISTS "hero_stats";
```

- [ ] **Step 3: Append the journal entry**

In `apps/api/src/db/migrations/meta/_journal.json`, add after the idx 2 entry:

```json
    {
      "idx": 3,
      "version": "7",
      "when": 1781049700000,
      "tag": "0003_drop_hero_stats",
      "breakpoints": true
    }
```

- [ ] **Step 4: Verify nothing references heroStats, then type-check**

Run: `rg -l heroStats apps scripts packages`
Expected: no output.
Run: `pnpm lint`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/db/schema.ts apps/api/src/db/migrations
git -c user.email=dvancov@hotmail.com -c user.name=dakiman commit -m "Drop hero_stats; player_matches is the source of truth

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: Slim API Docker image + docs

**Files:**
- Modify: `apps/api/Dockerfile` (full replacement)
- Modify: `README.md` (Known limitations section)
- Modify: `CLAUDE.md` (Data flow + schema sections)

- [ ] **Step 1: Replace the entire content of `apps/api/Dockerfile` with:**

```dockerfile
FROM node:22-alpine AS builder
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9 --activate
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api
# apps/web is not built here, but its package.json must exist for the
# lockfile importer check to pass with --frozen-lockfile
COPY apps/web/package.json apps/web/package.json
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @friendtracker/shared build && pnpm --filter api build

FROM node:22-alpine
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9 --activate
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN pnpm install --prod --frozen-lockfile
COPY --from=builder /app/packages/shared/dist packages/shared/dist
COPY --from=builder /app/apps/api/dist apps/api/dist
COPY --from=builder /app/apps/api/src/db/migrations apps/api/src/db/migrations
ENV NODE_ENV=production
WORKDIR /app/apps/api
EXPOSE 3000
CMD ["node", "dist/index.js"]
```

(Builder no longer copies `scripts/` — they run from the host. The migrator in `src/index.ts` resolves `src/db/migrations` relative to cwd `/app/apps/api`, which the third COPY satisfies.)

- [ ] **Step 2: Update `README.md` Known limitations**

Replace the whole "Known limitations" section with:

```markdown
## Known limitations

- **Role detection is a lane heuristic**: parsed matches use OpenDota lane data
  (support vs core within a lane decided by the hero's typical role); unparsed matches fall
  back to the static `HERO_ROLE_MAP`. OpenDota has no true position data.
- **No test runner**: `pnpm lint` type-checks all packages, but there are no unit/integration tests.
```

- [ ] **Step 3: Update `CLAUDE.md`**

In the "Data flow" section, replace step 2 with:

```markdown
2. **Fetch** (`scripts/fetch-data.ts`) syncs the `heroes` lookup and each player's full
   significant-match history from OpenDota into `player_matches` (role derived per match).
```

In the "Database schema" section, replace the `hero_stats` bullet with:

```markdown
- `player_matches` — one row per player per significant match (won, K/D/A, duration, lane data,
  derived role); PK `(player_id, match_id)`; source of truth for all stats
- `heroes` — OpenDota hero lookup (`id`, `name`, `slug`), refreshed by fetch-data
```

- [ ] **Step 4: Type-check (docs don't affect it, but confirm nothing broke)**

Run: `pnpm lint`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add apps/api/Dockerfile README.md CLAUDE.md
git -c user.email=dvancov@hotmail.com -c user.name=dakiman commit -m "Slim API image to prod deps + dist; update docs for player_matches

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 10: End-to-end smoke test (local stack)

No file changes — this validates the whole chain: migration, fetch, aggregation, image size.

- [ ] **Step 1: Rebuild and start the local stack**

```bash
sg docker -c 'docker compose up -d --build'
```

Expected: builds succeed; `docker compose ps` shows db/api/web up. Check migration ran:

```bash
sg docker -c 'docker compose logs api' | tail -5
```

Expected: "Migrations done." and "API listening".

- [ ] **Step 2: Confirm image shrank**

```bash
sg docker -c 'docker images' | grep dota2tracker
```

Expected: the api image is roughly 200–300MB (previously 600MB+).

- [ ] **Step 3: Seed and backfill**

```bash
cp -n .env.example .env
pnpm seed
pnpm fetch-data
pnpm populate-builds
```

Expected: seed logs players + Abaddon; fetch-data logs "Synced N heroes." then "Upserted <hundreds-to-thousands> matches" per player; populate-builds logs inserted/updated counts.

- [ ] **Step 4: Verify the API**

```bash
curl -s http://localhost:8743/api/health
curl -s "http://localhost:8743/api/meta" | python3 -c "import json,sys; rows=json.load(sys.stdin); print(len(rows), 'rows'); [print(r['heroName'], r['role'], r['matches'], r['kda']) for r in rows[:5]]"
curl -s "http://localhost:8743/api/meta?role=mid" | python3 -c "import json,sys; rows=json.load(sys.stdin); print(all(r['role']=='mid' for r in rows), len(rows))"
curl -s "http://localhost:8743/api/heroes/abaddon" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['totalMatches'], round(d['winRate'],1), d.get('kills'), d.get('deaths'), d.get('assists'))"
```

Expected: health `{"ok":true}`; meta returns rows with sensible KDA strings (e.g. "2.71"); the role filter returns only mid rows; abaddon returns real aggregate numbers where K/D/A totals are consistent with the match count (all derived from the same rows).

- [ ] **Step 5: Spot-check per-match roles in the DB**

```bash
sg docker -c 'docker compose exec -T db psql -U friendtracker -c "SELECT role, COUNT(*) FROM player_matches GROUP BY role ORDER BY 2 DESC; SELECT COUNT(*) FILTER (WHERE lane_role IS NOT NULL)::float / COUNT(*) AS parsed_share FROM player_matches;"'
```

Expected: all five roles present with plausible distribution; parsed_share > 0 (some matches parsed → lane-derived roles in play).

- [ ] **Step 6: Report results to the user** — include image size before/after, row counts, and any anomalies. Do not deploy to prod; the prod rollout (rebuild via /srv/dakis, then fetch-data/populate-builds against :5474) is a separate user-approved step.
```
