# Phase 2: API Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the API testable and production-clean: split app construction from bootstrap, add a vitest suite (pure-function unit tests + real-DB route tests), drop wide-open CORS, add graceful shutdown, and migrate the two `timestamp` columns to `timestamptz`.

**Architecture:** `apps/api/src/app.ts` constructs and exports the Hono app; `index.ts` becomes bootstrap only (migrate → serve → shutdown handlers). Pure aggregation functions move out of the CLI scripts into `scripts/lib/` so tests can import them without side effects. One root-level vitest config runs everything; route tests hit a throwaway `friendtracker_test` database created/migrated/seeded by a global-setup script against the local compose Postgres.

**Tech Stack:** Hono 4 + @hono/node-server, Drizzle ORM + node-postgres, vitest (root dev-dependency), pnpm 9 monorepo, Postgres 16 (docker compose, published on 5474).

## Global Constraints

- Repo root: `/home/dakiman/dev/dota2tracker`. All commands run from repo root unless stated.
- Docker commands must be wrapped: `sg docker -c '...'` (shell predates the docker group add).
- `pnpm test` (added in Task 3) **requires the local dev Postgres**: `sg docker -c 'docker compose up -d db'`. Tests use a separate `friendtracker_test` database — they never touch the dev `friendtracker` database.
- Type-check gate for every task: `pnpm lint` must pass. Note `pnpm lint` does NOT type-check the root `tests/` directory — vitest transforms them at run time; `pnpm test` is their gate.
- **Ordering note:** the Phase 1 plan (`2026-07-02-phase1-scheduled-refresh.md`) edits the same script files (adds `run()` exports). These plans are designed to apply in either order — this plan's extractions move code that Phase 1 does not touch — but apply them sequentially, not in parallel worktrees, to avoid pointless merge conflicts.
- Commit after every task with the exact message given.

---

### Task 1: Split `app.ts` (construction) from `index.ts` (bootstrap)

**Files:**
- Create: `apps/api/src/app.ts`
- Modify: `apps/api/src/index.ts`
- Modify: `apps/api/src/db/index.ts` (only if `pool` is not yet exported)

**Interfaces:**
- Produces: named export `app` (a `Hono` instance) from `apps/api/src/app.js` — Task 4's route tests call `app.request(...)` on it; named export `pool` (`pg.Pool`) from `apps/api/src/db/index.js` — used by Task 4 teardown and Task 6 shutdown. Behavior of the running server is unchanged.

- [ ] **Step 1: Ensure the pool is exported**

In `apps/api/src/db/index.ts`, if line 10 is `const pool = new pg.Pool(...)`, change it to `export const pool = new pg.Pool(...)`. (The Phase 1 plan makes the same change — skip if already exported.)

- [ ] **Step 2: Create `apps/api/src/app.ts`**

```ts
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import config from './routes/config.js'
import meta from './routes/meta.js'
import heroes from './routes/heroes.js'

export const app = new Hono()

app.use(cors())

app.route('/api/config', config)
app.route('/api/meta', meta)
app.route('/api/heroes', heroes)

app.get('/api/health', (c) => c.json({ ok: true }))
```

(CORS is carried over verbatim here; removing it is Task 5, gated by a test.)

- [ ] **Step 3: Reduce `apps/api/src/index.ts` to bootstrap**

Replace the whole file with:

```ts
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
```

(The old `export default app` is dropped — nothing imported it; `app` now lives in `app.ts`.)

- [ ] **Step 4: Type-check**

Run: `pnpm --filter api lint`
Expected: exits 0.

- [ ] **Step 5: Verify the server still boots and serves**

Run: `sg docker -c 'docker compose up -d db'` then `pnpm dev:api &`, wait for "API listening", then:

```bash
curl -s http://localhost:3000/api/health
```

Expected: `{"ok":true}`. Kill the dev server afterwards.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/
git commit -m "api: split app construction (app.ts) from bootstrap (index.ts)"
```

---

### Task 2: Extract pure aggregation functions to `scripts/lib/`

**Files:**
- Create: `scripts/lib/duration-stats.ts`
- Create: `scripts/lib/player-aggregates.ts`
- Modify: `scripts/fetch-hero-builds.ts`
- Modify: `scripts/fetch-player-builds.ts`

**Interfaces:**
- Produces:
  - `buildDurationStats(buckets: DurationBucket[]): MatchDurationWinRate[]` and `interface DurationBucket { duration_bin: number; games_played: number; wins: number }` from `scripts/lib/duration-stats.js`
  - `aggregateItemBuild(matches: ParsedMatch[], itemIdMap: Map<number, string>): BuildData['itemBuild']`, `interface ParsedMatch`, `interface PurchaseLogEntry`, `const EXCLUDED_FROM_CORE` from `scripts/lib/player-aggregates.js`
  - Both modules are **side-effect-free on import** (no dotenv, no DB, no network) — that is the point of the extraction; Task 3's unit tests import them directly.
- Non-goals: `aggregateSkillBuild` and `aggregateStats` stay in `fetch-player-builds.ts` (they depend on the module-level OpenDota constants maps; extracting them is future work, noted in ROADMAP Phase 4 territory).

- [ ] **Step 1: Create `scripts/lib/duration-stats.ts`**

Move (verbatim, plus exports) the `DurationBucket` interface and `buildDurationStats` function from `scripts/fetch-hero-builds.ts`:

```ts
/** Pure aggregation of OpenDota /heroes/:id/durations buckets into UI brackets. */
import type { MatchDurationWinRate } from '@friendtracker/shared'

export interface DurationBucket {
  duration_bin: number
  games_played: number
  wins: number
}

export function buildDurationStats(buckets: DurationBucket[]): MatchDurationWinRate[] {
  const brackets: { label: string; minSec: number; maxSec: number }[] = [
    { label: '<20 min', minSec: 0, maxSec: 1200 },
    { label: '20-30 min', minSec: 1200, maxSec: 1800 },
    { label: '30-40 min', minSec: 1800, maxSec: 2400 },
    { label: '40-50 min', minSec: 2400, maxSec: 3000 },
    { label: '50+ min', minSec: 3000, maxSec: Infinity },
  ]

  return brackets
    .map(({ label, minSec, maxSec }) => {
      const inRange = buckets.filter(
        (b) => b.duration_bin >= minSec && b.duration_bin < maxSec
      )
      const matches = inRange.reduce((s, b) => s + b.games_played, 0)
      const wins = inRange.reduce((s, b) => s + b.wins, 0)
      if (matches < 10) return null
      return { bracket: label, winRate: Math.round((wins / matches) * 1000) / 10, matches }
    })
    .filter((x): x is MatchDurationWinRate => x != null)
}
```

- [ ] **Step 2: Point `scripts/fetch-hero-builds.ts` at the lib**

Delete the local `DurationBucket` interface and `buildDurationStats` function (the `// --- Duration stats ---` section). Add to the imports at the top:

```ts
import { buildDurationStats, type DurationBucket } from './lib/duration-stats.js'
```

Remove `MatchDurationWinRate` from the `@friendtracker/shared` type import if it is now unused.

- [ ] **Step 3: Create `scripts/lib/player-aggregates.ts`**

Move the following from `scripts/fetch-player-builds.ts`: the `PurchaseLogEntry` and `ParsedMatch` interfaces, the `EXCLUDED_FROM_CORE` set, and `aggregateItemBuild` — with **one signature change**: `aggregateItemBuild` takes `itemIdMap` as a second parameter instead of reading the module-level variable.

```ts
/**
 * Pure aggregation of parsed OpenDota match details into BuildData item
 * structures. No I/O on import — unit-testable.
 */
import type { BuildData, ItemGroup, SituationalItem } from '@friendtracker/shared'

export interface PurchaseLogEntry {
  time: number
  key: string
}

export interface ParsedMatch {
  matchId: number
  duration: number
  won: boolean
  isRadiant: boolean
  purchaseLog: PurchaseLogEntry[]
  abilityUpgrades: number[]
  finalItems: number[]
  neutralItem: number
  kills: number
  deaths: number
  assists: number
  firstPurchaseTime: Record<string, number>
}

/** Items to exclude from core / situational (consumables & cheap basics) */
export const EXCLUDED_FROM_CORE = new Set([
  'tango',
  'flask',
  'clarity',
  'faerie_fire',
  'enchanted_mango',
  'ward_observer',
  'ward_sentry',
  'smoke_of_deceit',
  'dust',
  'tpscroll',
  'tome_of_knowledge',
  'blood_grenade',
  'branches',
  'magic_stick',
])

export function aggregateItemBuild(
  matches: ParsedMatch[],
  itemIdMap: Map<number, string>
): BuildData['itemBuild'] {
  const totalMatches = matches.length

  // --- Starting items (purchased before horn, time <= 0) ---
  const startingSets = new Map<string, { count: number; wins: number }>()
  for (const m of matches) {
    const starting = m.purchaseLog
      .filter((e) => e.time <= 0)
      .map((e) => e.key)
      .sort()
    if (starting.length === 0) continue
    const key = starting.join(',')
    const cur = startingSets.get(key) ?? { count: 0, wins: 0 }
    cur.count++
    if (m.won) cur.wins++
    startingSets.set(key, cur)
  }

  const startingItems: ItemGroup[] = [...startingSets.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 2)
    .map(([key, { count, wins }]) => ({
      items: key.split(','),
      matches: count,
      winRate: count > 0 ? Math.round((wins / count) * 1000) / 10 : 0,
    }))

  // --- Final inventory item frequency ---
  const itemFreq = new Map<
    string,
    { count: number; wins: number; totalTime: number; timeCount: number }
  >()
  for (const m of matches) {
    const seen = new Set<string>()
    for (const itemId of m.finalItems) {
      const slug = itemIdMap.get(itemId)
      if (!slug || EXCLUDED_FROM_CORE.has(slug)) continue
      if (seen.has(slug)) continue
      seen.add(slug)
      const cur = itemFreq.get(slug) ?? { count: 0, wins: 0, totalTime: 0, timeCount: 0 }
      cur.count++
      if (m.won) cur.wins++
      const purchaseTime = m.firstPurchaseTime[slug]
      if (purchaseTime != null && purchaseTime > 0) {
        cur.totalTime += purchaseTime
        cur.timeCount++
      }
      itemFreq.set(slug, cur)
    }
  }

  const sortedItems = [...itemFreq.entries()].sort((a, b) => b[1].count - a[1].count)

  // Core items: appear in >= 40% of matches
  const coreThreshold = totalMatches * 0.4
  const coreItemSlugs = sortedItems
    .filter(([, data]) => data.count >= coreThreshold)
    .map(([slug]) => slug)

  const coreWins = matches.filter((m) => m.won).length
  const coreItems: ItemGroup[] =
    coreItemSlugs.length > 0
      ? [
          {
            items: coreItemSlugs.slice(0, 6),
            matches: totalMatches,
            winRate: Math.round((coreWins / totalMatches) * 1000) / 10,
          },
        ]
      : []

  // Situational items: appear in 15–40% of matches
  const sitLower = totalMatches * 0.15
  const situationalItems: SituationalItem[] = sortedItems
    .filter(([, data]) => data.count >= sitLower && data.count < coreThreshold)
    .slice(0, 6)
    .map(([slug, data]) => ({
      itemName: slug.replace(/_/g, ' '),
      itemImage: slug,
      purchaseRate: Math.round((data.count / totalMatches) * 100),
      avgMinute: data.timeCount > 0 ? Math.round(data.totalTime / data.timeCount / 60) : 0,
    }))

  // --- Late game inventories by duration bracket ---
  const brackets = [
    { label: '20-35 min', minSec: 1200, maxSec: 2100 },
    { label: '35-50 min', minSec: 2100, maxSec: 3000 },
    { label: '50+ min', minSec: 3000, maxSec: Infinity },
  ]

  const lateGameInventories: Array<{ bracket: string; items: string[] }> = []
  for (const bracket of brackets) {
    const bMatches = matches.filter(
      (m) => m.duration >= bracket.minSec && m.duration < bracket.maxSec
    )
    if (bMatches.length < 2) continue

    const freq = new Map<string, number>()
    for (const m of bMatches) {
      for (const itemId of m.finalItems) {
        const slug = itemIdMap.get(itemId)
        if (!slug || EXCLUDED_FROM_CORE.has(slug)) continue
        freq.set(slug, (freq.get(slug) ?? 0) + 1)
      }
    }

    const topItems = [...freq.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([slug]) => slug)

    if (topItems.length > 0) {
      lateGameInventories.push({ bracket: bracket.label, items: topItems })
    }
  }

  return {
    startingItems,
    coreItems,
    situationalItems,
    neutralItems: [],
    lateGameInventories,
  }
}
```

- [ ] **Step 4: Point `scripts/fetch-player-builds.ts` at the lib**

Delete from `fetch-player-builds.ts`: the `PurchaseLogEntry` interface, the `ParsedMatch` interface, the `EXCLUDED_FROM_CORE` set, and the whole `aggregateItemBuild` function. Add to the imports at the top:

```ts
import {
  aggregateItemBuild,
  type ParsedMatch,
  type PurchaseLogEntry,
} from './lib/player-aggregates.js'
```

Change the one call site (inside the per-hero loop) from:

```ts
      const itemBuild = aggregateItemBuild(parsedMatches)
```

to:

```ts
      const itemBuild = aggregateItemBuild(parsedMatches, itemIdMap)
```

(`itemIdMap` is the module-level map populated by `loadConstants()`; it stays where it is. `aggregateSkillBuild` and `aggregateStats` also stay.)

- [ ] **Step 5: Type-check**

Run: `pnpm lint`
Expected: exits 0. (Common failures: `MatchDurationWinRate`/`ItemGroup`/`SituationalItem` left in an import list where no longer used — remove unused names; or `ParsedMatch` still referenced by `extractPlayerMatch`/`aggregateSkillBuild`/`aggregateStats` — those now use the imported type, which is why the import above is not type-only for the functions.)

- [ ] **Step 6: Commit**

```bash
git add scripts/
git commit -m "scripts: extract pure aggregators to lib/ (side-effect-free imports for tests)"
```

---

### Task 3: Vitest setup + unit tests for the pure functions

**Files:**
- Modify: `package.json` (root — dev-dep + test script)
- Create: `vitest.config.ts` (root)
- Create: `tests/derive-role.test.ts`
- Create: `tests/duration-stats.test.ts`
- Create: `tests/aggregate-item-build.test.ts`

**Interfaces:**
- Consumes: `deriveRole` from `@friendtracker/shared`; `buildDurationStats` and `aggregateItemBuild` from Task 2's libs.
- Produces: `pnpm test` command. The vitest config's `globalSetup` entry is added in Task 4 — in this task the config has no globalSetup, so unit tests run without a database.
- Note: these are **characterization tests** of existing behavior — they should pass on first run. A failure means the Task 2 extraction changed behavior; fix the extraction, not the test.

- [ ] **Step 1: Install vitest and add the test script**

Run: `pnpm add -Dw vitest`

In root `package.json` scripts, add:

```json
    "test": "pnpm --filter @friendtracker/shared build && vitest run",
```

(The shared build is required because tests import `@friendtracker/shared`, which resolves to its `dist/`.)

- [ ] **Step 2: Create root `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // Route tests share one throwaway DB; keep files sequential.
    fileParallelism: false,
    env: {
      DATABASE_URL:
        'postgresql://friendtracker:devpassword@localhost:5474/friendtracker_test',
    },
  },
})
```

- [ ] **Step 3: Write `tests/derive-role.test.ts`**

Hero IDs come from `HERO_ROLE_MAP` in `packages/shared/src/constants.ts`: `1` = Anti-Mage (`carry`), `5` = Crystal Maiden (`support`).

```ts
import { describe, it, expect } from 'vitest'
import { deriveRole } from '@friendtracker/shared'

describe('deriveRole', () => {
  it('maps roaming to support regardless of lane', () => {
    expect(deriveRole(1, true, 1)).toBe('support')
  })

  it('safe lane: carry for core-flavored heroes', () => {
    expect(deriveRole(1, false, 1)).toBe('carry')
  })

  it('safe lane: hard support for support-flavored heroes', () => {
    expect(deriveRole(1, false, 5)).toBe('hard_support')
  })

  it('mid lane is mid regardless of hero flavor', () => {
    expect(deriveRole(2, false, 5)).toBe('mid')
  })

  it('off/jungle lanes: offlane for cores, support for support-flavored', () => {
    expect(deriveRole(3, false, 1)).toBe('offlane')
    expect(deriveRole(3, false, 5)).toBe('support')
    expect(deriveRole(4, false, 1)).toBe('offlane')
  })

  it('falls back to the static hero role when lane data is missing', () => {
    expect(deriveRole(null, null, 1)).toBe('carry')
    expect(deriveRole(null, null, 5)).toBe('support')
  })
})
```

- [ ] **Step 4: Write `tests/duration-stats.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { buildDurationStats } from '../scripts/lib/duration-stats.js'

describe('buildDurationStats', () => {
  it('groups duration bins into brackets and computes win rate to one decimal', () => {
    const stats = buildDurationStats([
      { duration_bin: 1200, games_played: 30, wins: 15 },
      { duration_bin: 1500, games_played: 10, wins: 8 },
    ])
    // both bins fall in [1200, 1800) → "20-30 min": 40 games, 23 wins → 57.5%
    expect(stats).toEqual([{ bracket: '20-30 min', winRate: 57.5, matches: 40 }])
  })

  it('drops brackets with fewer than 10 matches', () => {
    const stats = buildDurationStats([{ duration_bin: 600, games_played: 9, wins: 9 }])
    expect(stats).toEqual([])
  })

  it('returns empty for no buckets', () => {
    expect(buildDurationStats([])).toEqual([])
  })
})
```

- [ ] **Step 5: Write `tests/aggregate-item-build.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { aggregateItemBuild, type ParsedMatch } from '../scripts/lib/player-aggregates.js'

const itemIdMap = new Map<number, string>([
  [1, 'blink'],
  [2, 'black_king_bar'],
  [3, 'tango'],
])

function match(overrides: Partial<ParsedMatch>): ParsedMatch {
  return {
    matchId: 1,
    duration: 2400,
    won: true,
    isRadiant: true,
    purchaseLog: [],
    abilityUpgrades: [],
    finalItems: [],
    neutralItem: 0,
    kills: 0,
    deaths: 0,
    assists: 0,
    firstPurchaseTime: {},
    ...overrides,
  }
}

describe('aggregateItemBuild', () => {
  it('puts items in >=40% of matches into core and excludes consumables', () => {
    const matches = [
      match({ matchId: 1, won: true, finalItems: [1, 3] }), // blink + tango (excluded)
      match({ matchId: 2, won: false, finalItems: [1] }),
    ]
    const build = aggregateItemBuild(matches, itemIdMap)
    expect(build.coreItems).toEqual([{ items: ['blink'], matches: 2, winRate: 50 }])
  })

  it('groups identical starting purchases (time <= 0) ignoring order', () => {
    const matches = [
      match({
        matchId: 1,
        won: true,
        purchaseLog: [
          { time: -60, key: 'tango' },
          { time: -60, key: 'branches' },
        ],
      }),
      match({
        matchId: 2,
        won: false,
        purchaseLog: [
          { time: -60, key: 'branches' },
          { time: -60, key: 'tango' },
        ],
      }),
    ]
    const build = aggregateItemBuild(matches, itemIdMap)
    expect(build.startingItems).toEqual([
      { items: ['branches', 'tango'], matches: 2, winRate: 50 },
    ])
  })

  it('never emits unknown item ids', () => {
    const build = aggregateItemBuild([match({ finalItems: [999] })], itemIdMap)
    expect(build.coreItems).toEqual([])
  })
})
```

- [ ] **Step 6: Run the suite**

Run: `pnpm test`
Expected: all 3 files pass (12 tests). No database needed yet.

- [ ] **Step 7: Commit**

```bash
git add package.json pnpm-lock.yaml vitest.config.ts tests/
git commit -m "test: vitest + unit tests for deriveRole, buildDurationStats, aggregateItemBuild"
```

---

### Task 4: Route tests against a throwaway database

**Files:**
- Create: `tests/global-setup.ts`
- Modify: `vitest.config.ts` (add globalSetup)
- Create: `tests/api-routes.test.ts`

**Interfaces:**
- Consumes: `app` from Task 1 (`apps/api/src/app.js`), `pool` from `apps/api/src/db/index.js`, migrations in `apps/api/src/db/migrations/`.
- Produces: a seeded `friendtracker_test` database (players `111`/Alice + `222`/Bob; heroes `1`/antimage + `2`/axe; three `player_matches` rows), recreated from scratch on every `pnpm test` run. Task 5's CORS test lives in the same file's describe pattern.

- [ ] **Step 1: Create `tests/global-setup.ts`**

```ts
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
```

- [ ] **Step 2: Register it in `vitest.config.ts`**

Add inside the `test` object:

```ts
    globalSetup: ['tests/global-setup.ts'],
```

- [ ] **Step 3: Write `tests/api-routes.test.ts`**

```ts
import { describe, it, expect, afterAll } from 'vitest'
import { app } from '../apps/api/src/app.js'
import { pool } from '../apps/api/src/db/index.js'

// The app-level pool (created on import with the test DATABASE_URL from
// vitest.config env) must be closed or vitest hangs on exit.
afterAll(async () => {
  await pool.end()
})

describe('GET /api/health', () => {
  it('returns ok', async () => {
    const res = await app.request('/api/health')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })
})

describe('GET /api/config', () => {
  it('lists the seeded players', async () => {
    const res = await app.request('/api/config')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.players.map((p: { id: string }) => p.id).sort()).toEqual(['111', '222'])
    expect(body.siteName).toBe('FriendTracker')
  })
})

describe('GET /api/meta', () => {
  it('aggregates matches per hero+role', async () => {
    const res = await app.request('/api/meta')
    expect(res.status).toBe(200)
    const body = await res.json()
    const am = body.find((r: { heroSlug: string }) => r.heroSlug === 'antimage')
    expect(am).toMatchObject({ matches: 2, wins: 1, role: 'carry', winRate: 50 })
  })

  it('filters by players', async () => {
    const res = await app.request('/api/meta?players=222')
    const body = await res.json()
    expect(body).toHaveLength(1)
    expect(body[0]).toMatchObject({ heroSlug: 'axe', matches: 1, role: 'offlane' })
  })

  it('filters by role', async () => {
    const res = await app.request('/api/meta?role=carry')
    const body = await res.json()
    expect(body).toHaveLength(1)
    expect(body[0].heroSlug).toBe('antimage')
  })

  it('rejects an all-invalid players param with 400', async () => {
    const res = await app.request('/api/meta?players=abc,def')
    expect(res.status).toBe(400)
  })

  it('rejects an invalid role with 400', async () => {
    const res = await app.request('/api/meta?role=jungler')
    expect(res.status).toBe(400)
  })
})

describe('GET /api/heroes/:heroSlug', () => {
  it('404s on an unknown hero', async () => {
    const res = await app.request('/api/heroes/nonexistent_hero')
    expect(res.status).toBe(404)
  })

  it('400s on a malformed slug', async () => {
    const res = await app.request('/api/heroes/Not-A-Slug!')
    expect(res.status).toBe(400)
  })

  it('serves a hero with matches but no build row (fallback path)', async () => {
    const res = await app.request('/api/heroes/antimage')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.heroName).toBe('Anti-Mage')
    expect(body.totalMatches).toBe(2)
    expect(body.wins).toBe(1)
    expect(body.roleTabs).toEqual([
      expect.objectContaining({ role: 'carry', matches: 2, winRate: 50 }),
    ])
    expect(body.builds).toEqual([])
  })

  it('honors the players filter in header stats', async () => {
    const res = await app.request('/api/heroes/axe?players=222')
    const body = await res.json()
    expect(body.totalMatches).toBe(1)
    expect(body.wins).toBe(1)
  })
})
```

Note: if the Phase 1 plan has landed, `/api/config` also returns `lastRefreshed: null` here (no refresh_runs rows in the test DB) — the assertions above don't touch it, so both orderings pass.

- [ ] **Step 4: Run the suite**

Run: `sg docker -c 'docker compose up -d db'` then `pnpm test`
Expected: all 4 test files pass. If `DROP DATABASE ... WITH (FORCE)` errors, the local Postgres predates v13 — it doesn't (compose pins postgres:16-alpine), so treat that error as a wrong-database-URL signal instead.

- [ ] **Step 5: Commit**

```bash
git add vitest.config.ts tests/
git commit -m "test: route tests via app.request against throwaway friendtracker_test DB"
```

---

### Task 5: Drop CORS (TDD)

**Files:**
- Create: `tests/cors.test.ts`
- Modify: `apps/api/src/app.ts`

**Interfaces:**
- Consumes: `app` from Task 1; suite from Tasks 3–4.
- Produces: an API that emits no CORS headers. Prod is same-origin (nginx proxies `/api/` — `apps/web/nginx.conf:28`), dev is same-origin (Vite proxies `/api` — `apps/web/vite.config.ts:14`), so nothing legitimate breaks.

- [ ] **Step 1: Write the failing test — `tests/cors.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { app } from '../apps/api/src/app.js'

describe('CORS', () => {
  it('emits no CORS headers — the API is same-origin only', async () => {
    const res = await app.request('/api/health', {
      headers: { Origin: 'https://evil.example' },
    })
    expect(res.headers.get('access-control-allow-origin')).toBeNull()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm test`
Expected: `tests/cors.test.ts` FAILS with `expected '*' to be null` (the `cors()` middleware reflects every origin). All other files still pass.

- [ ] **Step 3: Remove the middleware**

In `apps/api/src/app.ts`, delete both lines:

```ts
import { cors } from 'hono/cors'
```

```ts
app.use(cors())
```

- [ ] **Step 4: Run tests to verify green**

Run: `pnpm test`
Expected: all files pass, including `cors.test.ts`.

- [ ] **Step 5: Verify the dev proxy path still works end-to-end**

Run `pnpm dev:api` and `pnpm dev:web`, open `http://localhost:5173` — meta page loads data (requests go through the Vite proxy, same-origin). Stop both.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/app.ts tests/cors.test.ts
git commit -m "api: drop wide-open CORS; API is same-origin behind nginx/Vite proxy"
```

---

### Task 6: Graceful shutdown

**Files:**
- Modify: `apps/api/src/index.ts`

**Interfaces:**
- Consumes: `pool` export from Task 1.
- Produces: SIGTERM/SIGINT → close server, drain pool, exit 0 — so `docker stop` doesn't sit through the 10 s kill timeout and in-flight requests finish.

- [ ] **Step 1: Add shutdown handling to `apps/api/src/index.ts`**

Replace the whole file with:

```ts
import { serve } from '@hono/node-server'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { db, pool } from './db/index.js'
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
```

- [ ] **Step 2: Type-check**

Run: `pnpm --filter api lint`
Expected: exits 0.

- [ ] **Step 3: Verify the signal path in docker**

Run: `sg docker -c 'docker compose up -d --build api'` then `time sg docker -c 'docker compose stop api'`
Expected: `docker compose logs api` ends with `SIGTERM received, shutting down...`, and the `stop` completes in ~1 s (well under the 10 s SIGKILL timeout).

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/index.ts
git commit -m "api: graceful shutdown — close server and drain pg pool on SIGTERM/SIGINT"
```

---

### Task 7: `timestamptz` migration

**Files:**
- Modify: `apps/api/src/db/schema.ts` (two columns)
- Create (generated, then hand-edited): `apps/api/src/db/migrations/000N_timestamptz.sql`

**Interfaces:**
- Produces: `hero_builds.last_updated` and `player_matches.start_time` become `timestamptz`. No API/type change — node-postgres returns JS `Date` for both types and all writers store UTC-derived `Date`s.

- [ ] **Step 1: Update the schema**

In `apps/api/src/db/schema.ts`:

`heroBuilds.lastUpdated` becomes:

```ts
    lastUpdated: timestamp('last_updated', { withTimezone: true }).defaultNow(),
```

`playerMatches.startTime` becomes:

```ts
    startTime: timestamp('start_time', { withTimezone: true }).notNull(),
```

- [ ] **Step 2: Generate the migration**

Run: `pnpm --filter api db:generate --name timestamptz`
Expected: a new `apps/api/src/db/migrations/000N_timestamptz.sql` containing two `ALTER TABLE ... SET DATA TYPE timestamp with time zone` statements and nothing else.

- [ ] **Step 3: Make the conversion timezone-explicit**

Edit the generated SQL: append a `USING` clause to each `ALTER` so the reinterpretation doesn't depend on the migrating session's timezone (drizzle omits it; the stored values were written from UTC processes):

```sql
ALTER TABLE "hero_builds" ALTER COLUMN "last_updated" SET DATA TYPE timestamp with time zone USING "last_updated" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "player_matches" ALTER COLUMN "start_time" SET DATA TYPE timestamp with time zone USING "start_time" AT TIME ZONE 'UTC';
```

(Keep drizzle's `--> statement-breakpoint` separators exactly as generated.)

- [ ] **Step 4: Apply and verify locally**

Run: `pnpm --filter api db:migrate`
Then: `sg docker -c 'docker compose exec db psql -U friendtracker -c "\\d player_matches"'`
Expected: `start_time | timestamp with time zone | not null`.

- [ ] **Step 5: Run the full suite**

Run: `pnpm lint && pnpm test`
Expected: both pass (global-setup re-runs all migrations, including this one, on the throwaway DB).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/db/
git commit -m "db: migrate start_time and last_updated to timestamptz (explicit UTC reinterpretation)"
```

---

## Deferred (decided, do NOT implement in this plan)

- **Rate limiting** — lands with Phase 3a (first mutating endpoint / public exposure), per ROADMAP.
- **`aggregateSkillBuild` / `aggregateStats` extraction + tests** — needs the OpenDota constants maps refactored into parameters; do it when Phase 3b moves the pipeline into `packages/pipeline`.
