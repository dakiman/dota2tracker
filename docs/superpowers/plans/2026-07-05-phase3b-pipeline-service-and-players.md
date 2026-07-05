# Phase 3b — Pipeline-as-service + Self-service Players Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the pipeline into workspace packages (`@friendtracker/db` + `@friendtracker/pipeline`) so the API can run fetches in-process, add a DB-backed job queue with an in-process poller as the single executor, demote the cron refresh container to an enqueuer, and ship the first auth-protected mutations: `POST /api/players` (with OpenDota validation and the "Expose Public Match Data" UX) and `POST /api/admin/refresh` — plus the authorization model (env-designated admins), CSRF origin-check, and a small web UI.

**Architecture:** Per the approved spec `docs/superpowers/specs/2026-07-05-phase3b-pipeline-service-design.md`. Schema/client/migrations move to `packages/db`; job code moves to `packages/pipeline` (which also owns the job registry, `enqueue`, and the queue runner); `scripts/` shrinks to thin CLIs. A `jobs` table (partial-unique pending-dedup index) feeds the existing `refresh_runs` log via a shared `withRunLog` bracket. The API poller (`setInterval` + `.unref()`, serial drain, boot recovery) executes all pipeline jobs; the refresh container's cron lines become `enqueue-job` calls (only `backup-db` stays a direct run — pg_dump lives only in that image). Admins come from `ADMIN_STEAM_IDS`; CSRF is an Origin-allowlist middleware on mutating methods.

**Tech Stack:** Hono 4.12, Drizzle ORM 0.36 / drizzle-kit 0.28, pg, node:http mocks, Vue 3 + Pinia, vitest 4 (root `tests/`, throwaway `friendtracker_test` DB), pnpm 9 monorepo. **No new dependencies.**

## Global Constraints

- Node >= 20, pnpm 9. **No new dependencies** (runtime or dev) — queue, poller, CSRF, authz are hand-rolled.
- Tests need the local compose Postgres: `sg docker -c 'docker compose -p dota2tracker up -d db'` (publishes **5474**; must not run while the prod db container is up). All `docker` commands go through `sg docker -c '...'`.
- Full test run: `pnpm test`. **Narrow runs change in Task 1:** packages must be built first — `pnpm --filter "./packages/*" build && pnpm exec vitest run tests/<file>.test.ts`. Type-check: `pnpm lint`.
- Route pattern: whole handler in `try/catch` → `console.error('Route error:', err)` + `{ error: 'Internal server error' }, 500`.
- Don't break graceful shutdown in `apps/api/src/index.ts`: no new timers without `.unref()`; `pool.end()` stays the only pool teardown.
- The API Docker image excludes `scripts/` — API source must never import from `scripts/`.
- **Never touch `/srv/dakis` or the prod stack** — prod steps are operator notes only.
- **Docker image builds are verified once, in Task 13** — Dockerfile edits in Tasks 1/2 are not build-tested mid-plan.
- Test conventions: unique-per-test `x-real-ip` header on any route request (strict 10/min limiters on `/api/auth/*`, `/api/players`, `/api/admin/*`); **from Task 8 on, every mutating (POST) `app.request` must send `origin: 'http://localhost:5173'`**; distinct `steam_id`s per file (see Useful constants); every test file importing app or db ends with `afterAll(async () => { await pool.end() })`; files touching the `jobs` table clear it in `beforeEach`.
- Test files share one `friendtracker_test` DB, seeded with players `111`/`222` and heroes 1 (`antimage`)/2 (`axe`); vitest runs files sequentially (`fileParallelism: false`).
- Vue: 2-space indent, no semicolons, single quotes, theme colors are CSS vars `--color-dota-*`.
- Commit style: `db:`/`infra:`/`api:`/`web:`/`docs:`/`refactor:` prefix, imperative, plus the `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` trailer.

**Useful constants:** steam64 = accountId + 76561197960265728. IDs reserved per file (no collisions with existing files, which use accountIds 111/222/999/1110 and steam64s …270001-4):

| file | accountId → steam64 |
|---|---|
| `tests/jobs-pipeline.test.ts` | player `501` (no user needed) |
| `tests/authz.test.ts` | admin `76561197960266333`; users `76561197960266334`, `76561197960266335` |
| `tests/players-route.test.ts` | self-adder 501 → `76561197960266229`; private 502 → `76561197960266230`; not-found target `503`; opendota-down target `504`; steam64-input target 506 → `76561197960266234`; admin `76561197960266337` |
| `tests/admin-refresh.test.ts` | admin `76561197960266338`; non-admin `76561197960266339` |

---

### Task 1: Extract `packages/db` (schema, client, migrations)

Everything under `apps/api/src/db/` moves verbatim into a new workspace package so both the API and `packages/pipeline` (Task 2) can depend on it without a cycle. The API keeps running `migrate()` at boot, now via an exported `MIGRATIONS_DIR` that resolves relative to the package (works from `src/` under tsx and from `dist/` when built).

**Files:**
- Create: `packages/db/package.json`, `packages/db/tsconfig.json`, `packages/db/drizzle.config.ts`
- Move: `apps/api/src/db/schema.ts` → `packages/db/src/schema.ts`; `apps/api/src/db/index.ts` → `packages/db/src/index.ts`; `apps/api/src/db/migrations/` → `packages/db/migrations/`
- Modify: `apps/api/src/index.ts`, `apps/api/package.json`, root `package.json`, `tests/global-setup.ts`, `apps/api/Dockerfile`, `infra/refresh/Dockerfile`, all files importing the old db path (sed below)
- Delete: `apps/api/drizzle.config.ts`, `apps/api/src/db/`

**Interfaces:**
- Produces (consumed by every later task): package `@friendtracker/db` exporting `db`, `pool`, all schema tables (`players`, `playerMatches`, `heroes`, `heroBuilds`, `refreshRuns`, `users`, `sessions`), `and`/`eq`/`isNull` re-exports, and `MIGRATIONS_DIR: string`. Drizzle commands become `pnpm --filter @friendtracker/db db:generate|db:migrate|db:studio`.

- [ ] **Step 1: Create the package skeleton**

Create `packages/db/package.json`:

```json
{
  "name": "@friendtracker/db",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "default": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsc",
    "lint": "tsc --noEmit",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "drizzle-kit migrate",
    "db:studio": "drizzle-kit studio"
  },
  "dependencies": {
    "@friendtracker/shared": "workspace:*",
    "drizzle-orm": "^0.36.0",
    "pg": "^8.20.0"
  },
  "devDependencies": {
    "@types/pg": "^8.11.10",
    "drizzle-kit": "^0.28.0",
    "typescript": "^5.9.2"
  }
}
```

Create `packages/db/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "declaration": true,
    "declarationMap": true
  },
  "include": ["src/**/*"]
}
```

Create `packages/db/drizzle.config.ts` (same content as the old `apps/api/drizzle.config.ts`, new paths):

```ts
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  schema: './src/schema.ts',
  out: './migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgresql://friendtracker:devpassword@localhost:5474/friendtracker',
  },
})
```

- [ ] **Step 2: Move the schema, client, and migrations**

```bash
cd /home/dakiman/dev/dota2tracker
mkdir -p packages/db/src
git mv apps/api/src/db/schema.ts packages/db/src/schema.ts
git mv apps/api/src/db/index.ts packages/db/src/index.ts
git mv apps/api/src/db/migrations packages/db/migrations
git rm apps/api/drizzle.config.ts
```

Then edit `packages/db/src/index.ts` — append the `MIGRATIONS_DIR` export (add `import { fileURLToPath } from 'node:url'` at the top):

```ts
/** Absolute path to this package's migrations dir. Resolves relative to the
 *  module file, so it is correct from src/ (tsx) and dist/ (built) alike. */
export const MIGRATIONS_DIR = fileURLToPath(new URL('../migrations', import.meta.url))
```

(No other changes — `schema.ts` and the rest of `index.ts` move verbatim; the internal `./schema.js` import still resolves.)

- [ ] **Step 3: Rewrite every import of the old path**

```bash
cd /home/dakiman/dev/dota2tracker
grep -rl "\.\./db/index\.js" apps/api/src | xargs sed -i "s|'\.\./db/index\.js'|'@friendtracker/db'|g"
sed -i "s|'\.\./apps/api/src/db/index\.js'|'@friendtracker/db'|g" scripts/*.ts tests/*.ts
```

Expected touched files: `apps/api/src/routes/{config,meta,heroes,matches,together,auth}.ts`, `apps/api/src/auth/session.ts`, `scripts/{seed,fetch-data,populate-builds,fetch-hero-builds,fetch-player-builds,request-parses,run-job}.ts`, and the tests that import db. Confirm nothing is left:

```bash
grep -rn "apps/api/src/db\|'\.\./db/index" apps/api/src scripts tests && echo LEFTOVERS || echo CLEAN
```

Expected: `CLEAN`.

- [ ] **Step 4: Rewire bootstrap, manifests, and test setup**

`apps/api/src/index.ts` — change the import and the migrate call:

```ts
import { db, pool, MIGRATIONS_DIR } from '@friendtracker/db'
```

and

```ts
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR })
```

`apps/api/package.json` — remove the `db:generate`/`db:migrate`/`db:studio` scripts and the `drizzle-kit` devDependency; add to dependencies:

```json
    "@friendtracker/db": "workspace:*",
```

Root `package.json` — add `"@friendtracker/db": "workspace:*"` to `dependencies`, and change two scripts (packages now build in topo order before lint/tests):

```json
    "lint": "pnpm --filter \"./packages/*\" build && pnpm -r lint && tsc -p scripts",
    "test": "pnpm --filter \"./packages/*\" build && vitest run",
```

`tests/global-setup.ts` — change the migrations path:

```ts
  await migrate(db, { migrationsFolder: 'packages/db/migrations' })
```

Then: `pnpm install` (updates the lockfile with the new workspace package).

- [ ] **Step 5: Update both Dockerfiles (build-verified in Task 13)**

`apps/api/Dockerfile` builder stage — after `COPY packages/shared packages/shared` add:

```dockerfile
COPY packages/db packages/db
```

and replace the build line with:

```dockerfile
RUN pnpm --filter "./packages/*" build && pnpm --filter api build
```

Runtime stage — after the `packages/shared/package.json` COPY add:

```dockerfile
COPY packages/db/package.json packages/db/package.json
```

after the shared-dist COPY add:

```dockerfile
COPY --from=builder /app/packages/db/dist packages/db/dist
COPY --from=builder /app/packages/db/migrations packages/db/migrations
```

and **delete** the old line `COPY --from=builder /app/apps/api/src/db/migrations apps/api/src/db/migrations`.

`infra/refresh/Dockerfile` — after `COPY packages/shared packages/shared` add:

```dockerfile
COPY packages/db packages/db
```

replace `RUN pnpm --filter @friendtracker/shared build` with:

```dockerfile
RUN pnpm --filter "./packages/*" build
```

and **delete** the line `COPY apps/api/src/db apps/api/src/db`.

- [ ] **Step 6: Acid tests — suite green, generation still clean**

```bash
pnpm lint && pnpm test
pnpm --filter @friendtracker/db db:generate
```

Expected: lint clean, all existing tests PASS, and `db:generate` reports `No schema changes, nothing to migrate 😴` with `git status -s` showing no new migration files (the `meta/` snapshots moved with the folder, so the diff base is intact). **If it generates a migration, STOP and report** — the move broke snapshot bookkeeping.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor: extract @friendtracker/db workspace package (schema, client, migrations)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Extract `packages/pipeline` (jobs, libs, registry)

The five pipeline jobs and their libs move out of `scripts/` into a package the API can import. While moving, two seams are added: `opendotaBase()` (env-overridable OpenDota URL, read at call time — the test mock seam) and `syncHeroes()`/`syncPlayerMatches()` extracted from `fetch-data` (reused by Task 5's `fetch-player`). `run-job.ts` becomes a thin CLI over the package's job registry (plus `backup-db`, which stays in `scripts/` — pg_dump exists only in the refresh image).

**Files:**
- Create: `packages/pipeline/package.json`, `packages/pipeline/tsconfig.json`, `packages/pipeline/src/index.ts`, `packages/pipeline/src/registry.ts`, `packages/pipeline/src/lib/sync.ts`
- Move: `scripts/lib/opendota.ts` → `packages/pipeline/src/lib/opendota.ts`; `scripts/lib/duration-stats.ts` → `packages/pipeline/src/lib/duration-stats.ts`; `scripts/lib/player-aggregates.ts` → `packages/pipeline/src/lib/player-aggregates.ts`; `scripts/{fetch-data,populate-builds,fetch-hero-builds,fetch-player-builds,request-parses}.ts` → `packages/pipeline/src/jobs/`
- Modify: `scripts/run-job.ts`, root `package.json`, `vitest.config.ts`, `infra/refresh/Dockerfile`, `tests/aggregate-item-build.test.ts`, `tests/duration-stats.test.ts`
- Keep in place: `scripts/backup-db.ts`, `scripts/lib/backup-rotation.ts`, `scripts/seed.ts`

**Interfaces:**
- Consumes: `@friendtracker/db` (Task 1).
- Produces (consumed by Tasks 3–6, 9–11): package `@friendtracker/pipeline` exporting `registry: Record<string, JobFn>`, `JOB_TYPES: string[]`, `type JobFn = (payload: JobPayload | null) => Promise<string>`, `type JobPayload = { playerId?: string }`, lib re-exports (`fetchJson`, `sleep`, `opendotaBase`, `RATE_MS`, aggregators, duration stats), and `syncHeroes(): Promise<Set<number>>` / `syncPlayerMatches(playerId: string, heroIds: Set<number>): Promise<number>` via `lib/sync.js` (package-internal).

- [ ] **Step 1: Create the package skeleton**

Create `packages/pipeline/package.json`:

```json
{
  "name": "@friendtracker/pipeline",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "default": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsc",
    "lint": "tsc --noEmit"
  },
  "dependencies": {
    "@friendtracker/db": "workspace:*",
    "@friendtracker/shared": "workspace:*",
    "drizzle-orm": "^0.36.0"
  },
  "devDependencies": {
    "typescript": "^5.9.2"
  }
}
```

Create `packages/pipeline/tsconfig.json` (identical shape to `packages/db/tsconfig.json`):

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "declaration": true,
    "declarationMap": true
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 2: Move the libs and jobs**

```bash
cd /home/dakiman/dev/dota2tracker
mkdir -p packages/pipeline/src/lib packages/pipeline/src/jobs
git mv scripts/lib/opendota.ts packages/pipeline/src/lib/opendota.ts
git mv scripts/lib/duration-stats.ts packages/pipeline/src/lib/duration-stats.ts
git mv scripts/lib/player-aggregates.ts packages/pipeline/src/lib/player-aggregates.ts
for f in fetch-data populate-builds fetch-hero-builds fetch-player-builds request-parses; do
  git mv scripts/$f.ts packages/pipeline/src/jobs/$f.ts
done
```

- [ ] **Step 3: Add the env seam to the OpenDota lib**

Append to `packages/pipeline/src/lib/opendota.ts`:

```ts
/** OpenDota base URL. OPENDOTA_URL overrides for tests; read at call time. */
export function opendotaBase(): string {
  return process.env.OPENDOTA_URL ?? 'https://api.opendota.com/api'
}

/** Delay between OpenDota calls. Overridable so tests don't sleep. */
export const RATE_MS = Number(process.env.OPENDOTA_RATE_MS ?? 1100)
```

And in `vitest.config.ts`, add to `test.env`:

```ts
      OPENDOTA_RATE_MS: '0',
```

- [ ] **Step 4: Fix up the moved job files**

Mechanical edits to the five files now in `packages/pipeline/src/jobs/`:

```bash
cd /home/dakiman/dev/dota2tracker/packages/pipeline/src/jobs
# CLIs load dotenv; library code must not
sed -i "/^import 'dotenv\/config'$/d" *.ts
# lib imports are now one level up
sed -i "s|'\./lib/|'../lib/|g" *.ts
# call-time base URL instead of a module const
sed -i 's|\${OPENDOTA}|\${opendotaBase()}|g' *.ts
sed -i "/^const OPENDOTA = 'https:\/\/api.opendota.com\/api'$/d" *.ts
```

Then add `opendotaBase` to the existing `../lib/opendota.js` import in the three files that call OpenDota and survive this task unmodified — `fetch-hero-builds.ts`, `fetch-player-builds.ts`, `request-parses.ts` (e.g. `import { fetchJson, sleep, opendotaBase } from '../lib/opendota.js'`). `populate-builds.ts` never imports the OpenDota lib (pure DB aggregation) — the seds no-op on it; `fetch-data.ts` is fully replaced in Step 5. Local `const RATE_MS = 1100` lines stay as-is where present.

- [ ] **Step 5: Extract sync helpers and slim fetch-data**

Create `packages/pipeline/src/lib/sync.ts` (bodies lifted verbatim from the old `fetch-data.ts`):

```ts
/**
 * Hero + per-player match sync helpers, shared by fetch-data (all players)
 * and fetch-player (one just-added player).
 */
import { sql } from 'drizzle-orm'
import { db, heroes, playerMatches } from '@friendtracker/db'
import { heroNameToSlug, deriveRole } from '@friendtracker/shared'
import { fetchJson, sleep, opendotaBase, RATE_MS } from './opendota.js'

const CHUNK = 500

interface OpenDotaHero {
  id: number
  name: string
  localized_name: string
}

// OpenDota only returns the projected fields; the default (no `significant`
// param) already excludes turbo and other non-significant game modes.
const MATCH_PROJECT = [
  'match_id',
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
]
  // OpenDota expects repeated project params, not a comma-separated list
  .map((f) => `project=${f}`)
  .join('&')

interface MatchRow {
  match_id: number
  hero_id: number
  kills: number | null
  deaths: number | null
  assists: number | null
  duration: number
  player_slot: number
  radiant_win: boolean | null
  lane_role: number | null
  is_roaming: boolean | null
  start_time: number
}

/** Upserts the heroes lookup from OpenDota; returns the valid hero-id set. */
export async function syncHeroes(): Promise<Set<number>> {
  const heroList = await fetchJson<OpenDotaHero[]>(`${opendotaBase()}/heroes`)
  await sleep(RATE_MS)
  // Single multi-row upsert instead of one round trip per hero.
  const heroValues = heroList.map((h) => ({
    id: h.id,
    name: h.localized_name,
    slug: heroNameToSlug(h.name),
  }))
  if (heroValues.length > 0) {
    await db.insert(heroes).values(heroValues).onConflictDoUpdate({
      target: heroes.id,
      set: { name: sql`excluded.name`, slug: sql`excluded.slug` },
    })
  }
  console.log(`Synced ${heroList.length} heroes.`)
  return new Set(heroList.map((h) => h.id))
}

/** Fetches one player's full significant-match history and upserts it into
 *  player_matches. Returns the number of rows upserted. */
export async function syncPlayerMatches(playerId: string, heroIds: Set<number>): Promise<number> {
  const matches = await fetchJson<MatchRow[]>(
    `${opendotaBase()}/players/${playerId}/matches?${MATCH_PROJECT}`
  )
  await sleep(RATE_MS)

  const rows = matches
    // radiant_win can be null (hidden/ancient matches) — result unknown, skip
    .filter((m): m is MatchRow & { radiant_win: boolean } => m.radiant_win !== null && heroIds.has(m.hero_id))
    .map((m) => ({
      playerId,
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
  return rows.length
}
```

Replace the entire contents of `packages/pipeline/src/jobs/fetch-data.ts` with:

```ts
/**
 * Syncs the heroes lookup table and each player's full significant-match
 * history from OpenDota into player_matches. Idempotent: re-runs upsert every
 * row, picking up lane data for matches parsed since the last run.
 */
import { db, players } from '@friendtracker/db'
import { syncHeroes, syncPlayerMatches } from '../lib/sync.js'

export async function run(): Promise<string> {
  const playerRows = await db.select().from(players)
  if (playerRows.length === 0) {
    return 'no players in DB — run seed first'
  }

  const heroIds = await syncHeroes()

  let totalRows = 0
  for (const player of playerRows) {
    const n = await syncPlayerMatches(player.id, heroIds)
    totalRows += n
    console.log(`Upserted ${n} matches for ${player.name} (${player.id})`)
  }

  return `synced ${heroIds.size} heroes; upserted ${totalRows} match rows for ${playerRows.length} players`
}
```

- [ ] **Step 6: Registry + package index**

Create `packages/pipeline/src/registry.ts`:

```ts
/**
 * The job registry: every pipeline job the queue runner and CLIs can
 * execute, keyed by job-type string. backup-db is NOT here — it needs
 * pg_dump and runs only in the refresh container via scripts/run-job.ts.
 */
import { run as fetchData } from './jobs/fetch-data.js'
import { run as populateBuilds } from './jobs/populate-builds.js'
import { run as fetchHeroBuilds } from './jobs/fetch-hero-builds.js'
import { run as fetchPlayerBuilds } from './jobs/fetch-player-builds.js'
import { run as requestParses } from './jobs/request-parses.js'

export type JobPayload = { playerId?: string }
export type JobFn = (payload: JobPayload | null) => Promise<string>

export const registry: Record<string, JobFn> = {
  'fetch-data': () => fetchData(),
  'populate-builds': () => populateBuilds(),
  'fetch-hero-builds': () => fetchHeroBuilds(),
  'fetch-player-builds': () => fetchPlayerBuilds(),
  'request-parses': () => requestParses(),
}

export const JOB_TYPES = Object.keys(registry)
```

Create `packages/pipeline/src/index.ts`:

```ts
export { registry, JOB_TYPES, type JobFn, type JobPayload } from './registry.js'
export * from './lib/player-aggregates.js'
export * from './lib/duration-stats.js'
export { fetchJson, sleep, opendotaBase, RATE_MS } from './lib/opendota.js'
```

- [ ] **Step 7: Slim run-job.ts to a CLI over the registry**

Replace the `JOBS` map and job invocation in `scripts/run-job.ts` (keep the header comment, dotenv import, and the refresh_runs bracket exactly as they are):

```ts
import 'dotenv/config'
import { eq } from 'drizzle-orm'
import { db, pool, refreshRuns } from '@friendtracker/db'
import { registry, type JobFn } from '@friendtracker/pipeline'

const JOBS: Record<string, JobFn> = {
  ...registry,
  'backup-db': async () => (await import('./backup-db.js')).run(),
}

async function main() {
  const name = process.argv[2]
  const job = name ? JOBS[name] : undefined
  if (!name || !job) {
    console.error(`Usage: tsx scripts/run-job.ts <${Object.keys(JOBS).join('|')}>`)
    process.exit(2)
  }

  const [row] = await db
    .insert(refreshRuns)
    .values({ job: name })
    .returning({ id: refreshRuns.id })

  try {
    const summary = await job(null)
    await db
      .update(refreshRuns)
      .set({ finishedAt: new Date(), ok: true, detail: { summary } })
      .where(eq(refreshRuns.id, row.id))
    console.log(`[run-job] ${name} ok: ${summary}`)
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    await db
      .update(refreshRuns)
      .set({ finishedAt: new Date(), ok: false, detail: { error } })
      .where(eq(refreshRuns.id, row.id))
    console.error(`[run-job] ${name} FAILED: ${error}`)
    process.exitCode = 1
  } finally {
    await pool.end()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
```

(That is the full new file content. Task 4 replaces the inline bracket with `withRunLog`.)

- [ ] **Step 8: Manifests, test imports, refresh image**

Root `package.json` — add `"@friendtracker/pipeline": "workspace:*"` to `dependencies`. Then `pnpm install`.

`tests/aggregate-item-build.test.ts` and `tests/duration-stats.test.ts` — change their lib imports to the package:

```bash
cd /home/dakiman/dev/dota2tracker
sed -i "s|'\.\./scripts/lib/player-aggregates\.js'|'@friendtracker/pipeline'|;s|'\.\./scripts/lib/duration-stats\.js'|'@friendtracker/pipeline'|" tests/aggregate-item-build.test.ts tests/duration-stats.test.ts
```

`infra/refresh/Dockerfile` — after `COPY packages/db packages/db` add:

```dockerfile
COPY packages/pipeline packages/pipeline
```

(The `pnpm --filter "./packages/*" build` line from Task 1 already builds it.)

- [ ] **Step 9: Verify the suite and the manual CLI path**

```bash
pnpm lint && pnpm test
```

Expected: clean lint (including the two new packages' `tsc --noEmit`), all tests PASS. Spot-check that the CLI still resolves (no DB write needed — bad job name exits 2):

```bash
pnpm tsx scripts/run-job.ts nonsense; echo "exit=$?"
```

Expected: usage line listing `fetch-data|populate-builds|fetch-hero-builds|fetch-player-builds|request-parses|backup-db`, `exit=2`.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "refactor: extract @friendtracker/pipeline package with job registry

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: `jobs` table + `enqueue()`

The queue table (generated migration 0008) with the pending-dedup partial unique index, and the `enqueue` helper both the API routes and the `enqueue-job` CLI will use. Dedup relies on `INSERT ... ON CONFLICT DO NOTHING` — Postgres applies it to partial unique indexes even without a named conflict target.

**Files:**
- Modify: `packages/db/src/schema.ts`
- Generated: `packages/db/migrations/0008_<random>.sql`, `migrations/meta/0008_snapshot.json`, appended `meta/_journal.json`
- Create: `packages/pipeline/src/queue.ts`
- Modify: `packages/pipeline/src/index.ts`
- Test: `tests/jobs-queue.test.ts`

**Interfaces:**
- Consumes: `registry` (Task 2).
- Produces (consumed by Tasks 4, 9, 10, 11): table `jobs` (`id serial PK`, `type text NOT NULL`, `payload jsonb NULL` typed `JobPayload`, `status text NOT NULL DEFAULT 'pending'`, `error text NULL`, `created_at timestamptz NOT NULL DEFAULT now()`, `started_at`/`finished_at timestamptz NULL`, partial unique `jobs_pending_dedup_idx`); Drizzle object `jobs` exported from `@friendtracker/db`; `enqueue(items: Array<{ type: string; payload?: JobPayload }>): Promise<number>` from `@friendtracker/pipeline` (returns rows actually inserted; throws on a type not in the registry).

- [ ] **Step 1: Write the failing test**

Create `tests/jobs-queue.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { db, pool, jobs } from '@friendtracker/db'
import { enqueue } from '@friendtracker/pipeline'

afterAll(async () => {
  await pool.end()
})

beforeEach(async () => {
  await db.delete(jobs)
})

describe('jobs schema + enqueue', () => {
  it('inserts pending rows in argument order', async () => {
    const n = await enqueue([{ type: 'fetch-data' }, { type: 'populate-builds' }])
    expect(n).toBe(2)
    const rows = await db.select().from(jobs).orderBy(jobs.id)
    expect(rows.map((r) => r.type)).toEqual(['fetch-data', 'populate-builds'])
    expect(rows[0].status).toBe('pending')
    expect(rows[0].payload).toBeNull()
    expect(rows[0].createdAt).toBeInstanceOf(Date)
    expect(rows[0].startedAt).toBeNull()
  })

  it('dedups a pending job of the same type', async () => {
    expect(await enqueue([{ type: 'fetch-data' }])).toBe(1)
    expect(await enqueue([{ type: 'fetch-data' }])).toBe(0)
  })

  it('dedups per payload player, not globally', async () => {
    expect(await enqueue([{ type: 'fetch-player', payload: { playerId: '501' } }])).toBe(1)
    expect(await enqueue([{ type: 'fetch-player', payload: { playerId: '502' } }])).toBe(1)
    expect(await enqueue([{ type: 'fetch-player', payload: { playerId: '501' } }])).toBe(0)
  })

  it('does not dedup against running/finished rows', async () => {
    await enqueue([{ type: 'fetch-data' }])
    await db.update(jobs).set({ status: 'running' })
    expect(await enqueue([{ type: 'fetch-data' }])).toBe(1)
  })

  it('rejects job types outside the registry', async () => {
    await expect(enqueue([{ type: 'backup-db' }])).rejects.toThrow(/unknown job type/)
  })
})
```

Note: `'fetch-player'` only enters the registry in Task 5 — see Step 4 for how this test goes green now.

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter "./packages/*" build && pnpm exec vitest run tests/jobs-queue.test.ts`
Expected: FAIL — `jobs` is not exported from `@friendtracker/db`.

- [ ] **Step 3: Add the table and generate migration 0008**

Append to `packages/db/src/schema.ts` (add `import type` nothing — `sql` is already imported):

```ts
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
```

Then generate and inspect:

```bash
pnpm --filter @friendtracker/db db:generate
```

Expected: new `packages/db/migrations/0008_<random_name>.sql` + `meta/0008_snapshot.json` + appended journal entry (idx 8). **Open the SQL and verify** it contains only `CREATE TABLE "jobs" (...)` and one index statement equivalent to:

```sql
CREATE UNIQUE INDEX "jobs_pending_dedup_idx" ON "jobs" USING btree ("type",coalesce("payload"->>'playerId', '')) WHERE "jobs"."status" = 'pending';
```

If drizzle-kit mangles the expression, hand-edit the generated SQL file to exactly that statement (snapshot stays as generated — it records the same index definition). **Any `ALTER` touching existing tables → STOP and report.**

- [ ] **Step 4: Implement `enqueue`**

Create `packages/pipeline/src/queue.ts`:

```ts
import { db, jobs, type JobPayload } from '@friendtracker/db'
import { registry } from './registry.js'

/**
 * Insert queue rows one by one, in order (serial ids = execution order).
 * The pending-dedup unique index turns duplicates into silent no-ops.
 * Returns how many rows were actually inserted.
 */
export async function enqueue(
  items: Array<{ type: string; payload?: JobPayload }>
): Promise<number> {
  let inserted = 0
  for (const item of items) {
    if (!(item.type in registry)) throw new Error(`unknown job type: ${item.type}`)
    const rows = await db
      .insert(jobs)
      .values({ type: item.type, payload: item.payload ?? null })
      .onConflictDoNothing()
      .returning({ id: jobs.id })
    inserted += rows.length
  }
  return inserted
}
```

Append to `packages/pipeline/src/index.ts`:

```ts
export { enqueue } from './queue.js'
```

**Single source of truth for `JobPayload`:** the type now lives in the schema (`@friendtracker/db`), so in `packages/pipeline/src/registry.ts` replace the local definition:

```ts
export type JobPayload = { playerId?: string }
```

with an import + re-export (the `JobFn` signature and `packages/pipeline/src/index.ts`'s `export ... type JobPayload } from './registry.js'` line keep working unchanged):

```ts
import type { JobPayload } from '@friendtracker/db'

export type { JobPayload }
```

**Temporary registry stub:** the test enqueues `'fetch-player'`, which Task 5 implements. Add a placeholder entry to the `registry` object in `packages/pipeline/src/registry.ts` now (Task 5 replaces it):

```ts
  // Implemented in Task 5 (fetch-player job); registered now so enqueue
  // accepts the type — the poller would fail it with a clear error.
  'fetch-player': async () => {
    throw new Error('fetch-player not implemented yet')
  },
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter "./packages/*" build && pnpm exec vitest run tests/jobs-queue.test.ts`
Expected: PASS (5 tests — global-setup applies migration 0008). Then `pnpm test && pnpm lint` — all green.

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/schema.ts packages/db/migrations packages/pipeline/src/queue.ts packages/pipeline/src/registry.ts packages/pipeline/src/index.ts tests/jobs-queue.test.ts
git commit -m "db: jobs queue table (generated 0008) + pipeline enqueue with pending dedup

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: `withRunLog` + queue runner (claim, drain, recover, prune)

The refresh_runs bracket is extracted from `run-job.ts` into the pipeline package so the queue runner logs exactly like the CLI does. The runner claims jobs one at a time (`FOR UPDATE SKIP LOCKED`), drains serially in id order, and exposes boot-recovery and pruning helpers for the API poller (Task 6).

**Files:**
- Create: `packages/pipeline/src/run-log.ts`, `packages/pipeline/src/runner.ts`
- Modify: `packages/pipeline/src/index.ts`, `scripts/run-job.ts`
- Test: `tests/jobs-runner.test.ts`

**Interfaces:**
- Consumes: `jobs` table + `enqueue` (Task 3), `registry` (Task 2).
- Produces (consumed by Tasks 6, 9): from `@friendtracker/pipeline`: `withRunLog(name: string, fn: () => Promise<string>): Promise<RunResult>` where `type RunResult = { ok: true; summary: string } | { ok: false; error: string }` (never throws); `runPendingJobs(reg?: Record<string, JobFn>): Promise<number>` (drains the queue, returns jobs processed; `reg` injectable for tests); `recoverOrphanedJobs(): Promise<number>`; `pruneOldJobs(): Promise<number>`.

- [ ] **Step 1: Write the failing test**

Create `tests/jobs-runner.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { desc, eq } from 'drizzle-orm'
import { db, pool, jobs, refreshRuns } from '@friendtracker/db'
import {
  enqueue,
  runPendingJobs,
  recoverOrphanedJobs,
  pruneOldJobs,
  type JobFn,
} from '@friendtracker/pipeline'

afterAll(async () => {
  await pool.end()
})

beforeEach(async () => {
  await db.delete(jobs)
})

describe('runPendingJobs', () => {
  it('drains claimed jobs in id order, marks them done, logs to refresh_runs', async () => {
    const calls: string[] = []
    const reg: Record<string, JobFn> = {
      'fetch-data': async () => {
        calls.push('fetch-data')
        return 'synced'
      },
      'populate-builds': async () => {
        calls.push('populate-builds')
        return 'built'
      },
    }
    await enqueue([{ type: 'fetch-data' }, { type: 'populate-builds' }])
    expect(await runPendingJobs(reg)).toBe(2)
    expect(calls).toEqual(['fetch-data', 'populate-builds'])
    const rows = await db.select().from(jobs).orderBy(jobs.id)
    expect(rows.map((r) => r.status)).toEqual(['done', 'done'])
    expect(rows[0].startedAt).toBeInstanceOf(Date)
    expect(rows[0].finishedAt).toBeInstanceOf(Date)
    const [run] = await db
      .select()
      .from(refreshRuns)
      .where(eq(refreshRuns.job, 'fetch-data'))
      .orderBy(desc(refreshRuns.id))
      .limit(1)
    expect(run.ok).toBe(true)
    expect(run.detail).toEqual({ summary: 'synced' })
  })

  it('marks a throwing job failed (jobs.error + refresh_runs) and keeps draining', async () => {
    const reg: Record<string, JobFn> = {
      'fetch-data': async () => {
        throw new Error('boom')
      },
      'populate-builds': async () => 'ok',
    }
    await enqueue([{ type: 'fetch-data' }, { type: 'populate-builds' }])
    expect(await runPendingJobs(reg)).toBe(2)
    const rows = await db.select().from(jobs).orderBy(jobs.id)
    expect(rows[0].status).toBe('failed')
    expect(rows[0].error).toBe('boom')
    expect(rows[1].status).toBe('done')
    const [run] = await db
      .select()
      .from(refreshRuns)
      .where(eq(refreshRuns.job, 'fetch-data'))
      .orderBy(desc(refreshRuns.id))
      .limit(1)
    expect(run.ok).toBe(false)
  })

  it('fails a job whose type is not in the registry', async () => {
    await db.insert(jobs).values({ type: 'bogus' })
    expect(await runPendingJobs({})).toBe(1)
    const [row] = await db.select().from(jobs)
    expect(row.status).toBe('failed')
    expect(row.error).toMatch(/unknown job type/)
  })

  it('passes the payload to the job fn', async () => {
    let got: unknown
    const reg: Record<string, JobFn> = {
      'fetch-player': async (p) => {
        got = p
        return 'ok'
      },
    }
    await enqueue([{ type: 'fetch-player', payload: { playerId: '77' } }])
    await runPendingJobs(reg)
    expect(got).toEqual({ playerId: '77' })
  })

  it('returns 0 on an empty queue', async () => {
    expect(await runPendingJobs({})).toBe(0)
  })
})

describe('recovery + pruning', () => {
  it('re-pends running rows (orphans from a killed process)', async () => {
    await enqueue([{ type: 'fetch-data' }])
    await db.update(jobs).set({ status: 'running', startedAt: new Date() })
    expect(await recoverOrphanedJobs()).toBe(1)
    const [row] = await db.select().from(jobs)
    expect(row.status).toBe('pending')
    expect(row.startedAt).toBeNull()
  })

  it('prunes only finished rows older than 30 days', async () => {
    const old = new Date(Date.now() - 31 * 24 * 3600 * 1000)
    await db.insert(jobs).values([
      { type: 'fetch-data', status: 'done', finishedAt: old },
      { type: 'populate-builds', status: 'done', finishedAt: new Date() },
      { type: 'request-parses', status: 'pending' },
    ])
    expect(await pruneOldJobs()).toBe(1)
    expect(await db.select().from(jobs)).toHaveLength(2)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter "./packages/*" build && pnpm exec vitest run tests/jobs-runner.test.ts`
Expected: FAIL — `runPendingJobs` not exported from `@friendtracker/pipeline`.

- [ ] **Step 3: Implement run-log and runner**

Create `packages/pipeline/src/run-log.ts`:

```ts
import { eq } from 'drizzle-orm'
import { db, refreshRuns } from '@friendtracker/db'

export type RunResult = { ok: true; summary: string } | { ok: false; error: string }

/**
 * Brackets a job with a refresh_runs row (started/finished/ok/detail) —
 * the single logging story for cron CLIs and the API poller alike.
 * Never throws; failures come back as { ok: false }.
 */
export async function withRunLog(name: string, fn: () => Promise<string>): Promise<RunResult> {
  const [row] = await db.insert(refreshRuns).values({ job: name }).returning({ id: refreshRuns.id })
  try {
    const summary = await fn()
    await db
      .update(refreshRuns)
      .set({ finishedAt: new Date(), ok: true, detail: { summary } })
      .where(eq(refreshRuns.id, row.id))
    return { ok: true, summary }
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    await db
      .update(refreshRuns)
      .set({ finishedAt: new Date(), ok: false, detail: { error } })
      .where(eq(refreshRuns.id, row.id))
    return { ok: false, error }
  }
}
```

Create `packages/pipeline/src/runner.ts`:

```ts
import { sql } from 'drizzle-orm'
import { db, type JobPayload } from '@friendtracker/db'
import { registry, type JobFn } from './registry.js'
import { withRunLog } from './run-log.js'

type ClaimedJob = { id: number; type: string; payload: JobPayload | null }

/** Claim the oldest pending job. Single-process today; SKIP LOCKED is free
 *  correctness insurance if that ever changes. */
async function claimNext(): Promise<ClaimedJob | null> {
  const res = await db.execute(sql`
    UPDATE jobs SET status = 'running', started_at = now()
    WHERE id = (
      SELECT id FROM jobs WHERE status = 'pending'
      ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED
    )
    RETURNING id, type, payload
  `)
  return (res.rows[0] as ClaimedJob | undefined) ?? null
}

/**
 * Drain the queue serially in id order. Each job is bracketed with a
 * refresh_runs row, then its queue row is marked done/failed. No retries —
 * the 6h cron re-enqueues the same job types, which is the retry.
 * Returns the number of jobs processed. `reg` is injectable for tests.
 */
export async function runPendingJobs(reg: Record<string, JobFn> = registry): Promise<number> {
  let processed = 0
  for (;;) {
    const job = await claimNext()
    if (!job) return processed
    processed++
    const fn = reg[job.type]
    const result = fn
      ? await withRunLog(job.type, () => fn(job.payload))
      : ({ ok: false, error: `unknown job type: ${job.type}` } as const)
    await db.execute(sql`
      UPDATE jobs SET status = ${result.ok ? 'done' : 'failed'},
        error = ${result.ok ? null : result.error},
        finished_at = now()
      WHERE id = ${job.id}
    `)
  }
}

/** Any 'running' row at boot is an orphan from a killed process — with a
 *  single executor and idempotent jobs, re-pending is always safe. */
export async function recoverOrphanedJobs(): Promise<number> {
  const res = await db.execute(
    sql`UPDATE jobs SET status = 'pending', started_at = NULL WHERE status = 'running'`
  )
  return res.rowCount ?? 0
}

/** Queue rows are disposable; refresh_runs is the permanent history. */
export async function pruneOldJobs(): Promise<number> {
  const res = await db.execute(
    sql`DELETE FROM jobs WHERE status IN ('done', 'failed') AND finished_at < now() - interval '30 days'`
  )
  return res.rowCount ?? 0
}
```

Append to `packages/pipeline/src/index.ts`:

```ts
export { withRunLog, type RunResult } from './run-log.js'
export { runPendingJobs, recoverOrphanedJobs, pruneOldJobs } from './runner.js'
```

- [ ] **Step 4: Rewire run-job.ts onto withRunLog**

Replace `main()` (and drop the now-unused `eq`/`refreshRuns` imports) in `scripts/run-job.ts` — full new file:

```ts
/**
 * Single CLI entrypoint for direct (non-queued) job runs: manual dev runs
 * and the refresh container's backup-db cron line. Queued execution goes
 * through the API poller instead. Usage: tsx scripts/run-job.ts <job-name>
 */
import 'dotenv/config'
import { pool } from '@friendtracker/db'
import { registry, withRunLog, type JobFn } from '@friendtracker/pipeline'

const JOBS: Record<string, JobFn> = {
  ...registry,
  'backup-db': async () => (await import('./backup-db.js')).run(),
}

async function main() {
  const name = process.argv[2]
  const job = name ? JOBS[name] : undefined
  if (!name || !job) {
    console.error(`Usage: tsx scripts/run-job.ts <${Object.keys(JOBS).join('|')}>`)
    process.exit(2)
  }

  const result = await withRunLog(name, () => job(null))
  if (result.ok) {
    console.log(`[run-job] ${name} ok: ${result.summary}`)
  } else {
    console.error(`[run-job] ${name} FAILED: ${result.error}`)
    process.exitCode = 1
  }
  await pool.end()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter "./packages/*" build && pnpm exec vitest run tests/jobs-runner.test.ts`
Expected: PASS (7 tests). Then `pnpm test && pnpm lint` — all green.

- [ ] **Step 6: Commit**

```bash
git add packages/pipeline/src/run-log.ts packages/pipeline/src/runner.ts packages/pipeline/src/index.ts scripts/run-job.ts tests/jobs-runner.test.ts
git commit -m "api: queue runner with refresh_runs bracket, boot recovery, pruning

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: New jobs — `fetch-player`, `refresh-profiles` — and the wider parse window

`fetch-player` is the initial sync for a just-added player (payload `{ playerId }`), built on Task 2's sync helpers. `refresh-profiles` re-syncs `players.name`/`avatar` from OpenDota daily — note this intentionally overwrites hand-seeded nicknames with Steam personas (approved scope decision). `request-parses` widens from 14 to 30 days and raises its cap.

**Files:**
- Create: `packages/pipeline/src/jobs/fetch-player.ts`, `packages/pipeline/src/jobs/refresh-profiles.ts`
- Modify: `packages/pipeline/src/registry.ts`, `packages/pipeline/src/jobs/request-parses.ts`
- Test: `tests/jobs-pipeline.test.ts`

**Interfaces:**
- Consumes: `syncHeroes`/`syncPlayerMatches` (Task 2), `registry` (Task 2/3).
- Produces (consumed by Tasks 9, 10): registry entries `'fetch-player'` (real implementation, replaces the Task 3 stub) and `'refresh-profiles'`.

- [ ] **Step 1: Write the failing test**

Create `tests/jobs-pipeline.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createServer, type Server } from 'node:http'
import { eq } from 'drizzle-orm'
import { db, pool, players, playerMatches } from '@friendtracker/db'
import { registry } from '@friendtracker/pipeline'

let mock: Server

beforeAll(async () => {
  mock = createServer((req, res) => {
    const url = req.url ?? ''
    res.setHeader('content-type', 'application/json')
    if (url.startsWith('/heroes')) {
      // Same ids/names as the seeded heroes — upsert stays a no-op for other tests
      res.end(
        JSON.stringify([
          { id: 1, name: 'npc_dota_hero_antimage', localized_name: 'Anti-Mage' },
          { id: 2, name: 'npc_dota_hero_axe', localized_name: 'Axe' },
        ])
      )
    } else if (url.includes('/players/501/matches')) {
      res.end(
        JSON.stringify([
          { match_id: 9001, hero_id: 1, kills: 5, deaths: 2, assists: 7, duration: 2100, player_slot: 1, radiant_win: true, lane_role: 1, is_roaming: false, start_time: 1767348000 },
          { match_id: 9002, hero_id: 2, kills: 1, deaths: 9, assists: 3, duration: 1900, player_slot: 130, radiant_win: true, lane_role: null, is_roaming: null, start_time: 1767261600 },
        ])
      )
    } else if (url.includes('/players/501')) {
      res.end(JSON.stringify({ profile: { personaname: 'Fresh Persona', avatarfull: 'https://a.example/n.jpg' } }))
    } else {
      // Other players: OpenDota knows nothing (no profile key) — must be skipped
      res.end(JSON.stringify({}))
    }
  })
  await new Promise<void>((resolve) => mock.listen(0, '127.0.0.1', resolve))
  const addr = mock.address()
  if (typeof addr === 'object' && addr) {
    process.env.OPENDOTA_URL = `http://127.0.0.1:${addr.port}`
  }
  await db.insert(players).values({ id: '501', name: 'Newbie' })
})

afterAll(async () => {
  delete process.env.OPENDOTA_URL
  await db.delete(players).where(eq(players.id, '501')) // cascades player_matches
  await new Promise((resolve) => mock.close(resolve))
  await pool.end()
})

describe('fetch-player', () => {
  it('syncs a single player\'s matches', async () => {
    const summary = await registry['fetch-player']({ playerId: '501' })
    expect(summary).toContain('2 match rows')
    const rows = await db.select().from(playerMatches).where(eq(playerMatches.playerId, '501'))
    expect(rows).toHaveLength(2)
    const m1 = rows.find((r) => r.matchId === 9001)!
    expect(m1.won).toBe(true) // radiant slot, radiant won
    const m2 = rows.find((r) => r.matchId === 9002)!
    expect(m2.won).toBe(false) // dire slot, radiant won
  })

  it('throws without a playerId payload', async () => {
    await expect(registry['fetch-player'](null)).rejects.toThrow(/playerId/)
  })

  it('throws for a player not in the DB', async () => {
    await expect(registry['fetch-player']({ playerId: '999999' })).rejects.toThrow(/not in DB/)
  })
})

describe('refresh-profiles', () => {
  it('updates only players OpenDota has a profile for', async () => {
    const summary = await registry['refresh-profiles'](null)
    const [p] = await db.select().from(players).where(eq(players.id, '501'))
    expect(p.name).toBe('Fresh Persona')
    expect(p.avatar).toBe('https://a.example/n.jpg')
    const [alice] = await db.select().from(players).where(eq(players.id, '111'))
    expect(alice.name).toBe('Alice') // mock returns {} for 111 — untouched
    expect(summary).toMatch(/^refreshed profiles for 1\//)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter "./packages/*" build && pnpm exec vitest run tests/jobs-pipeline.test.ts`
Expected: FAIL — the Task 3 `fetch-player` stub throws `not implemented yet`, and `refresh-profiles` is not in the registry.

- [ ] **Step 3: Implement the two jobs and register them**

Create `packages/pipeline/src/jobs/fetch-player.ts`:

```ts
/**
 * Initial match sync for a single (just-added) player — the job enqueued by
 * POST /api/players. Payload: { playerId }. ~2 OpenDota calls.
 */
import { eq } from 'drizzle-orm'
import { db, players, type JobPayload } from '@friendtracker/db'
import { syncHeroes, syncPlayerMatches } from '../lib/sync.js'

export async function run(payload: JobPayload | null): Promise<string> {
  const playerId = payload?.playerId
  if (!playerId) throw new Error('fetch-player requires payload.playerId')
  const [player] = await db.select().from(players).where(eq(players.id, playerId))
  if (!player) throw new Error(`player ${playerId} not in DB`)
  const heroIds = await syncHeroes()
  const n = await syncPlayerMatches(playerId, heroIds)
  return `synced ${n} match rows for ${player.name} (${playerId})`
}
```

Create `packages/pipeline/src/jobs/refresh-profiles.ts`:

```ts
/**
 * Daily name/avatar re-sync from OpenDota profiles. Players OpenDota has no
 * profile for (never exposed data) are skipped. NOTE: intentionally
 * overwrites hand-seeded nicknames with current Steam personas.
 */
import { eq } from 'drizzle-orm'
import { db, players } from '@friendtracker/db'
import { fetchJson, sleep, opendotaBase, RATE_MS } from '../lib/opendota.js'

interface PlayerProfile {
  profile?: { personaname?: string; avatarfull?: string }
}

export async function run(): Promise<string> {
  const playerRows = await db.select().from(players)
  let updated = 0
  for (const player of playerRows) {
    try {
      const data = await fetchJson<PlayerProfile>(`${opendotaBase()}/players/${player.id}`)
      if (data.profile?.personaname) {
        await db
          .update(players)
          .set({ name: data.profile.personaname, avatar: data.profile.avatarfull ?? null })
          .where(eq(players.id, player.id))
        updated++
      }
    } catch (e) {
      console.error(`  Profile refresh failed for ${player.id}: ${e instanceof Error ? e.message : e}`)
    }
    await sleep(RATE_MS)
  }
  return `refreshed profiles for ${updated}/${playerRows.length} players`
}
```

In `packages/pipeline/src/registry.ts`: add the two imports, **replace the Task 3 `'fetch-player'` stub** with the real entry, and register `refresh-profiles`:

```ts
import { run as fetchPlayer } from './jobs/fetch-player.js'
import { run as refreshProfiles } from './jobs/refresh-profiles.js'
```

```ts
  'fetch-player': (p) => fetchPlayer(p),
  'refresh-profiles': () => refreshProfiles(),
```

- [ ] **Step 4: Widen the parse window**

In `packages/pipeline/src/jobs/request-parses.ts`:

- `const MAX_REQUESTS = 10` → `const MAX_REQUESTS = 40`
- `interval '14 days'` → `interval '30 days'`
- Update the header comment's second sentence to: `Only the last 30 days are eligible — replays typically expire after ~2 weeks, but stragglers survive longer and failed requests are cheap and logged. Capped per run to stay polite on the free tier.`

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter "./packages/*" build && pnpm exec vitest run tests/jobs-pipeline.test.ts`
Expected: PASS (4 tests). Then `pnpm test && pnpm lint` — all green.

- [ ] **Step 6: Commit**

```bash
git add packages/pipeline/src/jobs/fetch-player.ts packages/pipeline/src/jobs/refresh-profiles.ts packages/pipeline/src/registry.ts packages/pipeline/src/jobs/request-parses.ts tests/jobs-pipeline.test.ts
git commit -m "api: fetch-player + refresh-profiles jobs, 30-day parse-request window

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: In-process poller wired into the API

Thin timer wrapper around Task 4's runner: recover + prune at boot, tick every 5 s (`.unref()`), in-flight guard, and a shutdown that races the in-flight job against a 5 s grace (Docker SIGKILLs at 10 s anyway; boot recovery re-pends an orphaned row). Loop mechanics are already covered by `tests/jobs-runner.test.ts`; this task's verification is a live smoke test against the dev DB.

**Files:**
- Create: `apps/api/src/jobs/poller.ts`
- Modify: `apps/api/src/index.ts`, `apps/api/package.json`

**Interfaces:**
- Consumes: `runPendingJobs`/`recoverOrphanedJobs`/`pruneOldJobs` (Task 4).
- Produces: `startPoller(): Promise<void>`, `stopPoller(): Promise<void>` from `apps/api/src/jobs/poller.js` (bootstrap-only; nothing else imports it).

- [ ] **Step 1: Add the pipeline dependency to the API**

`apps/api/package.json` — add to dependencies:

```json
    "@friendtracker/pipeline": "workspace:*",
```

Then `pnpm install`.

- [ ] **Step 2: Implement the poller**

Create `apps/api/src/jobs/poller.ts`:

```ts
/**
 * In-process job poller — the single executor for all pipeline jobs.
 * Serial by construction: one tick drains the whole queue; overlapping
 * ticks no-op on the in-flight guard. The interval is .unref()ed so it
 * never holds the process open (graceful-shutdown constraint).
 */
import { recoverOrphanedJobs, pruneOldJobs, runPendingJobs } from '@friendtracker/pipeline'

const POLL_MS = 5_000
const SHUTDOWN_GRACE_MS = 5_000

let interval: NodeJS.Timeout | null = null
let inFlight: Promise<void> | null = null

export async function startPoller(): Promise<void> {
  const recovered = await recoverOrphanedJobs()
  if (recovered > 0) console.log(`[poller] re-pended ${recovered} orphaned job(s)`)
  const pruned = await pruneOldJobs()
  if (pruned > 0) console.log(`[poller] pruned ${pruned} old job row(s)`)

  interval = setInterval(() => {
    if (inFlight) return
    inFlight = runPendingJobs()
      .then((n) => {
        if (n > 0) console.log(`[poller] processed ${n} job(s)`)
      })
      .catch((e) => console.error('[poller] tick failed:', e))
      .finally(() => {
        inFlight = null
      })
  }, POLL_MS)
  interval.unref()
  console.log(`[poller] polling every ${POLL_MS / 1000}s`)
}

/**
 * Stop ticking, give an in-flight job a short grace, then return. A job
 * outliving the grace is abandoned — process exit kills it and boot
 * recovery re-pends its row (all jobs are idempotent upserts).
 */
export async function stopPoller(): Promise<void> {
  if (interval) clearInterval(interval)
  interval = null
  if (inFlight) {
    await Promise.race([
      inFlight,
      new Promise<void>((resolve) => {
        setTimeout(resolve, SHUTDOWN_GRACE_MS).unref()
      }),
    ])
  }
}
```

- [ ] **Step 3: Wire bootstrap and shutdown**

In `apps/api/src/index.ts`: add the import, start the poller after `serve(...)`, and stop it before `pool.end()` in shutdown. Full new file:

```ts
import { serve } from '@hono/node-server'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { db, pool, MIGRATIONS_DIR } from '@friendtracker/db'
import { app } from './app.js'
import { startPoller, stopPoller } from './jobs/poller.js'

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

await startPoller()

let shuttingDown = false
function shutdown(signal: string) {
  if (shuttingDown) return
  shuttingDown = true
  console.log(`${signal} received, shutting down...`)
  server.close((err) => {
    void stopPoller()
      .then(() => pool.end())
      .finally(() => process.exit(err ? 1 : 0))
  })
  // In-flight keep-alive connections can hold close() open — don't wait forever.
  setTimeout(() => process.exit(1), 10_000).unref()
}
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
```

- [ ] **Step 4: Lint + suite**

Run: `pnpm lint && pnpm test`
Expected: green (tests never import `index.ts`, so no poller runs during tests).

- [ ] **Step 5: Live smoke test against the dev DB**

The dev API run migrates the dev `friendtracker` DB to 0008 — intended. An unknown job type exercises claim → fail → finish without touching OpenDota:

```bash
cd /home/dakiman/dev/dota2tracker
PORT=3210 DATABASE_URL=postgresql://friendtracker:devpassword@localhost:5474/friendtracker pnpm dev:api > /tmp/claude-1000/-home-dakiman-dev-dota2tracker/1bc12fcd-de11-4229-af5f-b48a7fbe51d0/scratchpad/poller-smoke.log 2>&1 &
sleep 8
sg docker -c "docker compose -p dota2tracker exec db psql -U friendtracker -c \"INSERT INTO jobs (type) VALUES ('smoke-test')\""
sleep 8
sg docker -c "docker compose -p dota2tracker exec db psql -U friendtracker -c \"SELECT type, status, error FROM jobs WHERE type = 'smoke-test'\""
```

Expected: the SELECT shows `smoke-test | failed | unknown job type: smoke-test`, and the log contains `[poller] polling every 5s` and `[poller] processed 1 job(s)`. Clean up (kill via the `%1` job or `pkill -f 'tsx watch src/index.ts'`):

```bash
kill %1 2>/dev/null || pkill -f 'tsx watch src/index.ts'
sg docker -c "docker compose -p dota2tracker exec db psql -U friendtracker -c \"DELETE FROM jobs WHERE type = 'smoke-test'\""
```

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/jobs/poller.ts apps/api/src/index.ts apps/api/package.json pnpm-lock.yaml
git commit -m "api: in-process job poller (5s tick, boot recovery, graceful stop)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: `isAdmin` on AuthUser + `requireAuth`/`requireAdmin` guards

Adminship is computed at request time from `ADMIN_STEAM_IDS` (comma-separated steam64s, parsed like `ALLOWED_ORIGINS`) — no schema change. `AuthUser` gains `isAdmin`, which changes the shape `/api/auth/me` returns, so two existing assertions in `tests/auth-routes.test.ts` must be updated.

**Files:**
- Create: `apps/api/src/auth/admin.ts`, `apps/api/src/middleware/authz.ts`
- Modify: `packages/shared/src/types.ts`, `apps/api/src/auth/session.ts`, `tests/auth-routes.test.ts`, `.env.example`
- Test: `tests/authz.test.ts`

**Interfaces:**
- Consumes: `sessionUser` (3a), `sessionMiddleware`/`AuthEnv` (3a).
- Produces (consumed by Tasks 10–12): `AuthUser.isAdmin: boolean`; `adminSteamIds(): string[]` from `auth/admin.js`; `requireAuth` (anonymous → 401) and `requireAdmin` (anonymous → 401, non-admin → 403) from `middleware/authz.js`. Env: `ADMIN_STEAM_IDS` (default empty — nobody is admin).

- [ ] **Step 1: Write the failing test**

Create `tests/authz.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Hono } from 'hono'
import { app } from '../apps/api/src/app.js'
import { db, pool, users } from '@friendtracker/db'
import { createSession } from '../apps/api/src/auth/session.js'
import { sessionMiddleware, type AuthEnv } from '../apps/api/src/middleware/session.js'
import { requireAuth, requireAdmin } from '../apps/api/src/middleware/authz.js'

const ADMIN_STEAM64 = '76561197960266333'

beforeAll(() => {
  // Whitespace-tolerant parsing is part of the contract
  process.env.ADMIN_STEAM_IDS = ` ${ADMIN_STEAM64}, `
})

afterAll(async () => {
  delete process.env.ADMIN_STEAM_IDS
  await pool.end()
})

function guardApp() {
  const a = new Hono<AuthEnv>()
  a.use('*', sessionMiddleware)
  a.get('/auth', requireAuth, (c) => c.json({ ok: true }))
  a.get('/admin', requireAdmin, (c) => c.json({ ok: true }))
  return a
}

async function sessionFor(steamId: string): Promise<string> {
  const [user] = await db
    .insert(users)
    .values({ steamId, name: 'Guard Tester' })
    .onConflictDoUpdate({
      target: [users.provider, users.steamId],
      set: { name: 'Guard Tester' },
    })
    .returning()
  const { token } = await createSession(user.id)
  return token
}

describe('requireAuth / requireAdmin', () => {
  it('401s anonymous requests', async () => {
    const a = guardApp()
    expect((await a.request('/auth')).status).toBe(401)
    expect((await a.request('/admin')).status).toBe(401)
  })

  it('lets a signed-in user through requireAuth but 403s requireAdmin', async () => {
    const token = await sessionFor('76561197960266334')
    const a = guardApp()
    const headers = { cookie: `session=${token}` }
    expect((await a.request('/auth', { headers })).status).toBe(200)
    expect((await a.request('/admin', { headers })).status).toBe(403)
  })

  it('lets an ADMIN_STEAM_IDS user through requireAdmin', async () => {
    const token = await sessionFor(ADMIN_STEAM64)
    const a = guardApp()
    expect((await a.request('/admin', { headers: { cookie: `session=${token}` } })).status).toBe(200)
  })
})

describe('isAdmin on /api/auth/me', () => {
  it('is false for a user outside ADMIN_STEAM_IDS', async () => {
    const token = await sessionFor('76561197960266335')
    const res = await app.request('/api/auth/me', {
      headers: { cookie: `session=${token}`, 'x-real-ip': '10.8.0.1' },
    })
    expect((await res.json()).user.isAdmin).toBe(false)
  })

  it('is true for an ADMIN_STEAM_IDS user', async () => {
    const token = await sessionFor(ADMIN_STEAM64)
    const res = await app.request('/api/auth/me', {
      headers: { cookie: `session=${token}`, 'x-real-ip': '10.8.0.2' },
    })
    expect((await res.json()).user.isAdmin).toBe(true)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter "./packages/*" build && pnpm exec vitest run tests/authz.test.ts`
Expected: FAIL — cannot find module `../apps/api/src/middleware/authz.js`.

- [ ] **Step 3: Implement**

Append to `packages/shared/src/types.ts`, inside the `AuthUser` interface (after `avatar`):

```ts
  /** True when the user's steamId is in the ADMIN_STEAM_IDS env allowlist. */
  isAdmin: boolean
```

Create `apps/api/src/auth/admin.ts`:

```ts
/** steam64 ids granted admin — comma-separated env allowlist, same shape as
 *  ALLOWED_ORIGINS. Read at call time; default empty (nobody is admin). */
export function adminSteamIds(): string[] {
  return (process.env.ADMIN_STEAM_IDS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}
```

In `apps/api/src/auth/session.ts`: add `import { adminSteamIds } from './admin.js'` and extend `sessionUser`'s return object:

```ts
  return {
    id: row.userId,
    steamId: row.steamId,
    playerId: row.playerId,
    name: row.name,
    avatar: row.avatar,
    isAdmin: adminSteamIds().includes(row.steamId),
  }
```

Create `apps/api/src/middleware/authz.ts`:

```ts
import { createMiddleware } from 'hono/factory'
import type { AuthEnv } from './session.js'

/** 401 unless a session user is on the context. */
export const requireAuth = createMiddleware<AuthEnv>(async (c, next) => {
  if (!c.get('user')) return c.json({ error: 'Unauthorized' }, 401)
  await next()
})

/** 401 anonymous, 403 signed-in non-admin. */
export const requireAdmin = createMiddleware<AuthEnv>(async (c, next) => {
  const user = c.get('user')
  if (!user) return c.json({ error: 'Unauthorized' }, 401)
  if (!user.isAdmin) return c.json({ error: 'Forbidden' }, 403)
  await next()
})
```

`.env.example` — append:

```
# Comma-separated steam64 ids allowed to add arbitrary players and trigger refreshes
ADMIN_STEAM_IDS=
```

- [ ] **Step 4: Fix the two changed assertions in tests/auth-routes.test.ts**

The `toEqual` on `/api/auth/me`'s user (Task 5 of the 3a plan, "returns the user for a valid session cookie") gains `isAdmin: false`:

```ts
    expect(body.user).toEqual({
      id: user.id,
      steamId: '76561197960270001',
      playerId: null,
      name: 'Session Tester',
      avatar: null,
      isAdmin: false,
    })
```

Search the file for any other exact-shape assertion on a user object (`rg -n "toEqual\(\{" tests/auth-routes.test.ts`) and add `isAdmin: false` wherever the full AuthUser shape is asserted.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter "./packages/*" build && pnpm exec vitest run tests/authz.test.ts tests/auth-routes.test.ts`
Expected: PASS. Then `pnpm test && pnpm lint` — all green.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/types.ts apps/api/src/auth/admin.ts apps/api/src/auth/session.ts apps/api/src/middleware/authz.ts tests/authz.test.ts tests/auth-routes.test.ts .env.example
git commit -m "api: env-designated admins (ADMIN_STEAM_IDS) + requireAuth/requireAdmin guards

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: CSRF origin-check middleware

Origin-allowlist check on mutating methods under `/api/*`, layered over the SameSite=Lax cookie. Missing Origin rejects (every modern browser sends it on POST). From here on, **every mutating test request must carry `origin: 'http://localhost:5173'`** — the two existing logout tests are updated in this task.

**Files:**
- Create: `apps/api/src/middleware/csrf.ts`
- Modify: `apps/api/src/app.ts`, `tests/auth-routes.test.ts`
- Test: `tests/csrf.test.ts`

**Interfaces:**
- Consumes: `allowedOrigins()` (3a, `auth/origin.js`).
- Produces (consumed by Tasks 10–11 implicitly via app wiring): `csrfMiddleware` from `middleware/csrf.js`, mounted on `/api/*` between the rate limiters and the session middleware.

- [ ] **Step 1: Write the failing test**

Create `tests/csrf.test.ts`:

```ts
import { describe, it, expect, afterAll } from 'vitest'
import { app } from '../apps/api/src/app.js'
import { pool } from '@friendtracker/db'

afterAll(async () => {
  await pool.end()
})

describe('csrf origin check', () => {
  it('403s a mutating request with no Origin header', async () => {
    const res = await app.request('/api/auth/logout', {
      method: 'POST',
      headers: { 'x-real-ip': '10.9.0.1' },
    })
    expect(res.status).toBe(403)
  })

  it('403s a disallowed Origin', async () => {
    const res = await app.request('/api/auth/logout', {
      method: 'POST',
      headers: { origin: 'https://evil.example', 'x-real-ip': '10.9.0.2' },
    })
    expect(res.status).toBe(403)
  })

  it('passes an allowlisted Origin', async () => {
    const res = await app.request('/api/auth/logout', {
      method: 'POST',
      headers: { origin: 'http://localhost:5173', 'x-real-ip': '10.9.0.3' },
    })
    expect(res.status).toBe(200)
  })

  it('leaves GETs alone', async () => {
    const res = await app.request('/api/auth/me', { headers: { 'x-real-ip': '10.9.0.4' } })
    expect(res.status).toBe(200)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter "./packages/*" build && pnpm exec vitest run tests/csrf.test.ts`
Expected: the two 403 tests FAIL (logout currently returns 200 without an Origin).

- [ ] **Step 3: Implement and wire**

Create `apps/api/src/middleware/csrf.ts`:

```ts
import { createMiddleware } from 'hono/factory'
import { allowedOrigins } from '../auth/origin.js'

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/**
 * CSRF defense-in-depth over the SameSite=Lax session cookie: mutating
 * requests must carry an Origin header matching the ALLOWED_ORIGINS
 * allowlist. Missing Origin rejects — every modern browser sends it on
 * cross- AND same-origin POSTs.
 */
export const csrfMiddleware = createMiddleware(async (c, next) => {
  if (MUTATING.has(c.req.method)) {
    const origin = c.req.header('origin')
    if (!origin || !allowedOrigins().includes(origin)) {
      return c.json({ error: 'Invalid origin' }, 403)
    }
  }
  await next()
})
```

In `apps/api/src/app.ts`: add `import { csrfMiddleware } from './middleware/csrf.js'` and mount it between the global rate limiter and the session middleware:

```ts
app.use('/api/*', rateLimit({ windowMs: 60_000, max: 300 }))
app.use('/api/*', csrfMiddleware)
app.use('/api/*', sessionMiddleware)
```

- [ ] **Step 4: Add Origin to the existing logout tests**

In `tests/auth-routes.test.ts`, both `POST /api/auth/logout` tests add the header:

```ts
      headers: { cookie: `session=${token}`, 'x-real-ip': '10.5.0.5', origin: 'http://localhost:5173' },
```

and

```ts
      headers: { 'x-real-ip': '10.5.0.6', origin: 'http://localhost:5173' },
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter "./packages/*" build && pnpm exec vitest run tests/csrf.test.ts tests/auth-routes.test.ts`
Expected: PASS. Then `pnpm test && pnpm lint` — all green.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/middleware/csrf.ts apps/api/src/app.ts tests/csrf.test.ts tests/auth-routes.test.ts
git commit -m "api: origin-allowlist CSRF middleware on mutating /api routes

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: `enqueue-job` CLI + cron container becomes an enqueuer

Crontab pipeline lines and the entrypoint's self-heal switch from direct `run-job.ts` runs to enqueueing; the API poller executes them. Only `backup-db` stays a direct run (pg_dump + backups volume live in the refresh image).

**Files:**
- Create: `scripts/enqueue-job.ts`
- Modify: `infra/refresh/crontab`, `infra/refresh/entrypoint.sh`

**Interfaces:**
- Consumes: `enqueue`, `JOB_TYPES` (Task 3), `registry` entries incl. `refresh-profiles` (Task 5).
- Produces: CLI `tsx scripts/enqueue-job.ts <type> [<type> ...]` used by cron and entrypoint.

- [ ] **Step 1: Implement the CLI**

Create `scripts/enqueue-job.ts`:

```ts
/**
 * Enqueue pipeline jobs for the API's in-process poller. Used by the
 * refresh container's cron lines and entrypoint self-heal; dedup (pending
 * rows only) makes re-enqueueing over a backlog a silent no-op.
 * Usage: tsx scripts/enqueue-job.ts <job-type> [<job-type> ...]
 */
import 'dotenv/config'
import { pool } from '@friendtracker/db'
import { enqueue, JOB_TYPES } from '@friendtracker/pipeline'

async function main() {
  const names = process.argv.slice(2)
  if (names.length === 0 || names.some((n) => !JOB_TYPES.includes(n))) {
    console.error(`Usage: tsx scripts/enqueue-job.ts <${JOB_TYPES.join('|')} ...>`)
    process.exit(2)
  }
  const inserted = await enqueue(names.map((type) => ({ type })))
  console.log(
    `[enqueue-job] enqueued ${inserted}/${names.length} (${names.length - inserted} already pending)`
  )
  await pool.end()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
```

- [ ] **Step 2: Rewrite crontab and entrypoint**

Replace `infra/refresh/crontab` with:

```
# Cheap match sync + aggregates + parse requests: every 6 hours. Enqueued —
# the API poller executes; queue order preserves the pipeline sequence.
20 */6 * * * cd /app && ./node_modules/.bin/tsx scripts/enqueue-job.ts fetch-data populate-builds request-parses > /proc/1/fd/1 2>&1
# Slow build fetchers + profile re-sync: daily, off-peak. ~300-500 OpenDota calls.
40 3 * * * cd /app && ./node_modules/.bin/tsx scripts/enqueue-job.ts fetch-hero-builds fetch-player-builds refresh-profiles > /proc/1/fd/1 2>&1
# Nightly DB backup to $BACKUP_DIR (custom-format dump, 7-day rotation).
# Stays a DIRECT run: pg_dump + the backups volume exist only in this image.
10 4 * * * cd /app && ./node_modules/.bin/tsx scripts/run-job.ts backup-db > /proc/1/fd/1 2>&1
```

Replace `infra/refresh/entrypoint.sh` with:

```sh
#!/bin/sh
# Enqueue one cheap sync on container start (idempotent — pending dedup) so
# a fresh deploy is never stale until the first cron tick, then hand off to
# crond as PID 1 (exec => clean SIGTERM handling). The API poller executes.
cd /app
./node_modules/.bin/tsx scripts/enqueue-job.ts fetch-data populate-builds || echo "initial enqueue failed; cron will retry"
exec crond -f -l 2
```

- [ ] **Step 3: Verify the CLI end-to-end against the dev DB**

```bash
cd /home/dakiman/dev/dota2tracker
DATABASE_URL=postgresql://friendtracker:devpassword@localhost:5474/friendtracker pnpm tsx scripts/enqueue-job.ts fetch-data populate-builds
DATABASE_URL=postgresql://friendtracker:devpassword@localhost:5474/friendtracker pnpm tsx scripts/enqueue-job.ts fetch-data
```

Expected: first run prints `enqueued 2/2 (0 already pending)`; second prints `enqueued 0/1 (1 already pending)`. Bad name exits 2 with usage. Clean up (the dev API may not be running, so rows would linger):

```bash
sg docker -c "docker compose -p dota2tracker exec db psql -U friendtracker -c \"DELETE FROM jobs WHERE status = 'pending'\""
```

Then `pnpm lint` (scripts tsconfig covers the new CLI).

- [ ] **Step 4: Commit**

```bash
git add scripts/enqueue-job.ts infra/refresh/crontab infra/refresh/entrypoint.sh
git commit -m "infra: refresh container enqueues pipeline jobs; poller executes them

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 10: `POST /api/players`

The self-service endpoint. Self-add derives the account from the session's steamId (ownership proven by Steam login); any other account requires admin. Validation against OpenDota uses the empirically verified discriminators: `{"error":"Not Found"}` → account doesn't exist (404); profile present but `matches` → `[]` → exists without public match data (422, blocked, name/avatar returned for the UI); OpenDota down/5xx → 503 fail-closed. Existing player → 409, no side effects. Strict 10/min limiter.

**Files:**
- Create: `apps/api/src/players/validate.ts`, `apps/api/src/routes/players.ts`
- Modify: `apps/api/src/app.ts`
- Test: `tests/players-route.test.ts`

**Interfaces:**
- Consumes: `requireAuth` (Task 7), `csrfMiddleware` wiring (Task 8), `enqueue` + `'fetch-player'` (Tasks 3/5), `steam64ToAccountId`/`STEAM64_BASE` (3a `auth/openid.js`), `rateLimit` (3a).
- Produces (consumed by Task 12): `POST /api/players` with body `{ accountId?: string }` → 201 `{ player }` / 400 `{ error: 'invalid_account_id' }` / 403 `{ error: 'forbidden' }` / 404 `{ error: 'account_not_found' }` / 409 `{ error: 'already_tracked' }` / 422 `{ error: 'no_public_data', name, avatar }` / 503 `{ error: 'opendota_unavailable' }`; `checkAccount(accountId: string): Promise<AccountCheck>` where `type AccountCheck = 'not_found' | 'unavailable' | { name: string; avatar: string | null; hasMatches: boolean }`.

- [ ] **Step 1: Write the failing test**

Create `tests/players-route.test.ts`:

```ts
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { createServer, type Server } from 'node:http'
import { eq } from 'drizzle-orm'
import { db, pool, jobs, players, users } from '@friendtracker/db'
import { app } from '../apps/api/src/app.js'
import { createSession } from '../apps/api/src/auth/session.js'

const ORIGIN = 'http://localhost:5173'
const ADMIN_STEAM64 = '76561197960266337'
// accountId 501 / 502 / 506 ⇔ steam64 base + n
const SELF_STEAM64 = '76561197960266229' // account 501
const PRIVATE_STEAM64 = '76561197960266230' // account 502
const STEAM64_INPUT = '76561197960266234' // account 506

let mock: Server

beforeAll(async () => {
  process.env.ADMIN_STEAM_IDS = ADMIN_STEAM64
  mock = createServer((req, res) => {
    const url = req.url ?? ''
    res.setHeader('content-type', 'application/json')
    if (url.includes('/players/504')) {
      res.statusCode = 500
      res.end('{}')
      return
    }
    const matches = /\/players\/(\d+)\/matches/.exec(url)
    if (matches) {
      res.end(matches[1] === '502' ? '[]' : JSON.stringify([{ match_id: 1 }]))
      return
    }
    const profile = /\/players\/(\d+)/.exec(url)
    if (profile && profile[1] === '503') {
      res.end(JSON.stringify({ error: 'Not Found' }))
      return
    }
    res.end(
      JSON.stringify({
        profile: { personaname: `Mock ${profile?.[1]}`, avatarfull: 'https://a.example/p.jpg' },
      })
    )
  })
  await new Promise<void>((resolve) => mock.listen(0, '127.0.0.1', resolve))
  const addr = mock.address()
  if (typeof addr === 'object' && addr) {
    process.env.OPENDOTA_URL = `http://127.0.0.1:${addr.port}`
  }
})

afterAll(async () => {
  delete process.env.ADMIN_STEAM_IDS
  delete process.env.OPENDOTA_URL
  await db.delete(players).where(eq(players.id, '501'))
  await db.delete(players).where(eq(players.id, '506'))
  await new Promise((resolve) => mock.close(resolve))
  await pool.end()
})

beforeEach(async () => {
  await db.delete(jobs)
})

async function sessionFor(steamId: string): Promise<string> {
  const [user] = await db
    .insert(users)
    .values({ steamId, name: 'Adder' })
    .onConflictDoUpdate({ target: [users.provider, users.steamId], set: { name: 'Adder' } })
    .returning()
  const { token } = await createSession(user.id)
  return token
}

function post(token: string | null, ip: string, body?: unknown) {
  return app.request('/api/players', {
    method: 'POST',
    headers: {
      origin: ORIGIN,
      'x-real-ip': ip,
      ...(token ? { cookie: `session=${token}` } : {}),
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
}

describe('POST /api/players', () => {
  it('401s anonymous requests', async () => {
    expect((await post(null, '10.10.0.1')).status).toBe(401)
  })

  it('self-add: 201, players row, users.playerId link, fetch-player job', async () => {
    const token = await sessionFor(SELF_STEAM64)
    const res = await post(token, '10.10.0.2')
    expect(res.status).toBe(201)
    const { player } = await res.json()
    expect(player).toMatchObject({ id: '501', name: 'Mock 501', avatar: 'https://a.example/p.jpg' })
    const [row] = await db.select().from(players).where(eq(players.id, '501'))
    expect(row).toBeDefined()
    const [user] = await db.select().from(users).where(eq(users.steamId, SELF_STEAM64))
    expect(user.playerId).toBe('501')
    const jobRows = await db.select().from(jobs)
    expect(jobRows).toHaveLength(1)
    expect(jobRows[0]).toMatchObject({ type: 'fetch-player', status: 'pending', payload: { playerId: '501' } })
  })

  it('re-add: 409 already_tracked, no job enqueued', async () => {
    const token = await sessionFor(SELF_STEAM64)
    const res = await post(token, '10.10.0.3')
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('already_tracked')
    expect(await db.select().from(jobs)).toHaveLength(0)
  })

  it('private account: 422 no_public_data with the profile name, nothing persisted', async () => {
    const token = await sessionFor(PRIVATE_STEAM64)
    const res = await post(token, '10.10.0.4')
    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body).toEqual({ error: 'no_public_data', name: 'Mock 502', avatar: 'https://a.example/p.jpg' })
    expect(await db.select().from(players).where(eq(players.id, '502'))).toEqual([])
    expect(await db.select().from(jobs)).toHaveLength(0)
  })

  it('non-admin adding someone else: 403 before any OpenDota call', async () => {
    const token = await sessionFor(SELF_STEAM64)
    const res = await post(token, '10.10.0.5', { accountId: '503' })
    expect(res.status).toBe(403)
  })

  it('admin add of a nonexistent account: 404', async () => {
    const token = await sessionFor(ADMIN_STEAM64)
    const res = await post(token, '10.10.0.6', { accountId: '503' })
    expect(res.status).toBe(404)
    expect((await res.json()).error).toBe('account_not_found')
  })

  it('admin add with non-numeric input: 400', async () => {
    const token = await sessionFor(ADMIN_STEAM64)
    const res = await post(token, '10.10.0.7', { accountId: 'abc' })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('invalid_account_id')
  })

  it('admin add accepts steam64 input and normalizes it', async () => {
    const token = await sessionFor(ADMIN_STEAM64)
    const res = await post(token, '10.10.0.8', { accountId: STEAM64_INPUT })
    expect(res.status).toBe(201)
    const [row] = await db.select().from(players).where(eq(players.id, '506'))
    expect(row.name).toBe('Mock 506')
    // Admin added someone else — admin's own users.playerId stays null
    const [admin] = await db.select().from(users).where(eq(users.steamId, ADMIN_STEAM64))
    expect(admin.playerId).toBeNull()
  })

  it('OpenDota down: 503 fail-closed', async () => {
    const token = await sessionFor(ADMIN_STEAM64)
    const res = await post(token, '10.10.0.9', { accountId: '504' })
    expect(res.status).toBe(503)
    expect((await res.json()).error).toBe('opendota_unavailable')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter "./packages/*" build && pnpm exec vitest run tests/players-route.test.ts`
Expected: FAIL — 404s (route doesn't exist).

- [ ] **Step 3: Implement validation + route + wiring**

Create `apps/api/src/players/validate.ts`:

```ts
/**
 * OpenDota account validation for POST /api/players. Discriminators
 * verified empirically 2026-07-05:
 *   - /players/{id} → {"error":"Not Found"} ⇒ account doesn't exist
 *   - profile present but /matches → [] ⇒ exists, no public match data
 *     (a brand-new zero-game account looks identical — UI copy covers both;
 *     `fh_unavailable` is NOT a discriminator, it's true for public accounts)
 * Network errors / 5xx ⇒ 'unavailable' — validation fails closed.
 */
export type AccountCheck =
  | 'not_found'
  | 'unavailable'
  | { name: string; avatar: string | null; hasMatches: boolean }

export async function checkAccount(accountId: string): Promise<AccountCheck> {
  const base = process.env.OPENDOTA_URL ?? 'https://api.opendota.com/api'
  try {
    const res = await fetch(`${base}/players/${accountId}`, {
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok && res.status !== 404) return 'unavailable'
    const data = (await res.json()) as {
      error?: string
      profile?: { personaname?: string; avatarfull?: string }
    }
    if (data.error || !data.profile) return 'not_found'

    const matchesRes = await fetch(`${base}/players/${accountId}/matches?project=match_id&limit=1`, {
      signal: AbortSignal.timeout(10_000),
    })
    if (!matchesRes.ok) return 'unavailable'
    const matches = (await matchesRes.json()) as unknown[]
    return {
      name: data.profile.personaname ?? `Player ${accountId}`,
      avatar: data.profile.avatarfull ?? null,
      hasMatches: matches.length > 0,
    }
  } catch {
    return 'unavailable'
  }
}
```

Create `apps/api/src/routes/players.ts`:

```ts
import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { db, players, users } from '@friendtracker/db'
import { enqueue } from '@friendtracker/pipeline'
import type { AuthEnv } from '../middleware/session.js'
import { requireAuth } from '../middleware/authz.js'
import { steam64ToAccountId, STEAM64_BASE } from '../auth/openid.js'
import { checkAccount } from '../players/validate.js'

const playersRoute = new Hono<AuthEnv>()

playersRoute.post('/', requireAuth, async (c) => {
  try {
    const user = c.get('user')!
    const body = (await c.req.json().catch(() => ({}))) as { accountId?: string }
    const raw = typeof body.accountId === 'string' ? body.accountId.trim() : ''
    const selfAccountId = steam64ToAccountId(user.steamId)

    let accountId = selfAccountId
    if (raw) {
      if (!/^\d{1,20}$/.test(raw)) return c.json({ error: 'invalid_account_id' }, 400)
      // Accept bare account ids and steam64s; normalize the latter
      accountId = BigInt(raw) >= STEAM64_BASE ? steam64ToAccountId(raw) : raw
    }
    // Self-service: your own account needs no privilege (ownership proven
    // by Steam login). Anyone else's requires admin.
    if (accountId !== selfAccountId && !user.isAdmin) {
      return c.json({ error: 'forbidden' }, 403)
    }

    const [existing] = await db.select().from(players).where(eq(players.id, accountId))
    if (existing) return c.json({ error: 'already_tracked' }, 409)

    const check = await checkAccount(accountId)
    if (check === 'unavailable') return c.json({ error: 'opendota_unavailable' }, 503)
    if (check === 'not_found') return c.json({ error: 'account_not_found' }, 404)
    if (!check.hasMatches) {
      return c.json({ error: 'no_public_data', name: check.name, avatar: check.avatar }, 422)
    }

    const [player] = await db
      .insert(players)
      .values({ id: accountId, name: check.name, avatar: check.avatar })
      .returning()
    if (accountId === selfAccountId) {
      // Mirror the login upsert so /api/auth/me reflects the link immediately
      await db.update(users).set({ playerId: accountId }).where(eq(users.id, user.id))
    }
    await enqueue([{ type: 'fetch-player', payload: { playerId: accountId } }])
    return c.json({ player }, 201)
  } catch (err) {
    console.error('Route error:', err)
    return c.json({ error: 'Internal server error' }, 500)
  }
})

export default playersRoute
```

In `apps/api/src/app.ts`: import the route (`import playersRoute from './routes/players.js'`), add the strict limiter next to the auth one, and mount the route with the others:

```ts
app.use('/api/auth/*', rateLimit({ windowMs: 60_000, max: 10 }))
app.use('/api/players', rateLimit({ windowMs: 60_000, max: 10 }))
```

```ts
app.route('/api/players', playersRoute)
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter "./packages/*" build && pnpm exec vitest run tests/players-route.test.ts`
Expected: PASS (9 tests). Then `pnpm test && pnpm lint` — all green.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/players/validate.ts apps/api/src/routes/players.ts apps/api/src/app.ts tests/players-route.test.ts
git commit -m "api: POST /api/players — self-serve + admin add with OpenDota validation

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 11: `POST /api/admin/refresh`

Admin-only trigger that enqueues the standard 6-hour trio; pending-dedup makes it idempotent. 202 when anything was inserted, 200 `{ queued: false }` when everything was already pending.

**Files:**
- Create: `apps/api/src/routes/admin.ts`
- Modify: `apps/api/src/app.ts`
- Test: `tests/admin-refresh.test.ts`

**Interfaces:**
- Consumes: `requireAdmin` (Task 7), `enqueue` (Task 3).
- Produces (consumed by Task 12): `POST /api/admin/refresh` → 202 `{ queued: true }` | 200 `{ queued: false }` | 401 | 403.

- [ ] **Step 1: Write the failing test**

Create `tests/admin-refresh.test.ts`:

```ts
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { db, pool, jobs, users } from '@friendtracker/db'
import { app } from '../apps/api/src/app.js'
import { createSession } from '../apps/api/src/auth/session.js'

const ORIGIN = 'http://localhost:5173'
const ADMIN_STEAM64 = '76561197960266338'
const USER_STEAM64 = '76561197960266339'

beforeAll(() => {
  process.env.ADMIN_STEAM_IDS = ADMIN_STEAM64
})

afterAll(async () => {
  delete process.env.ADMIN_STEAM_IDS
  await pool.end()
})

beforeEach(async () => {
  await db.delete(jobs)
})

async function sessionFor(steamId: string): Promise<string> {
  const [user] = await db
    .insert(users)
    .values({ steamId, name: 'Refresher' })
    .onConflictDoUpdate({ target: [users.provider, users.steamId], set: { name: 'Refresher' } })
    .returning()
  const { token } = await createSession(user.id)
  return token
}

function post(token: string | null, ip: string) {
  return app.request('/api/admin/refresh', {
    method: 'POST',
    headers: {
      origin: ORIGIN,
      'x-real-ip': ip,
      ...(token ? { cookie: `session=${token}` } : {}),
    },
  })
}

describe('POST /api/admin/refresh', () => {
  it('401s anonymous requests', async () => {
    expect((await post(null, '10.11.0.1')).status).toBe(401)
  })

  it('403s signed-in non-admins', async () => {
    const token = await sessionFor(USER_STEAM64)
    expect((await post(token, '10.11.0.2')).status).toBe(403)
  })

  it('enqueues the refresh trio in pipeline order: 202 { queued: true }', async () => {
    const token = await sessionFor(ADMIN_STEAM64)
    const res = await post(token, '10.11.0.3')
    expect(res.status).toBe(202)
    expect(await res.json()).toEqual({ queued: true })
    const rows = await db.select().from(jobs).orderBy(jobs.id)
    expect(rows.map((r) => r.type)).toEqual(['fetch-data', 'populate-builds', 'request-parses'])
    expect(rows.every((r) => r.status === 'pending')).toBe(true)
  })

  it('is idempotent while the trio is pending: 200 { queued: false }', async () => {
    const token = await sessionFor(ADMIN_STEAM64)
    await post(token, '10.11.0.4')
    const res = await post(token, '10.11.0.5')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ queued: false })
    expect(await db.select().from(jobs)).toHaveLength(3)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter "./packages/*" build && pnpm exec vitest run tests/admin-refresh.test.ts`
Expected: FAIL — 404s (route doesn't exist).

- [ ] **Step 3: Implement and wire**

Create `apps/api/src/routes/admin.ts`:

```ts
import { Hono } from 'hono'
import { enqueue } from '@friendtracker/pipeline'
import type { AuthEnv } from '../middleware/session.js'
import { requireAdmin } from '../middleware/authz.js'

const admin = new Hono<AuthEnv>()

admin.post('/refresh', requireAdmin, async (c) => {
  try {
    // The standard 6h trio; queue order = pipeline order. Pending dedup
    // makes hammering the button a no-op.
    const inserted = await enqueue([
      { type: 'fetch-data' },
      { type: 'populate-builds' },
      { type: 'request-parses' },
    ])
    return c.json({ queued: inserted > 0 }, inserted > 0 ? 202 : 200)
  } catch (err) {
    console.error('Route error:', err)
    return c.json({ error: 'Internal server error' }, 500)
  }
})

export default admin
```

In `apps/api/src/app.ts`: `import admin from './routes/admin.js'`, add the strict limiter line next to the others, and mount:

```ts
app.use('/api/admin/*', rateLimit({ windowMs: 60_000, max: 10 }))
```

```ts
app.route('/api/admin', admin)
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter "./packages/*" build && pnpm exec vitest run tests/admin-refresh.test.ts`
Expected: PASS (4 tests). Then `pnpm test && pnpm lint` — all green.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/admin.ts apps/api/src/app.ts tests/admin-refresh.test.ts
git commit -m "api: POST /api/admin/refresh — admin-triggered pipeline enqueue

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 12: Web UI — apiPost, store refresh, AccountActions

`useApi` gains a `apiPost` helper (JSON body; `ApiError` gains a `data` field carrying the error payload so the UI can read `no_public_data`'s `name`). Both stores gain `refresh()`. One new component renders the "Track my account" button, the admin add-by-id input + "Refresh now" button, and the Expose-Public-Match-Data explainer. Server enforces all authz — `isAdmin` only gates rendering. No component-test infra exists (and no new devDependencies), so coverage is at the composable/store level; the component is verified by the Task 13 manual spike.

**Files:**
- Create: `apps/web/src/components/layout/AccountActions.vue`
- Modify: `apps/web/src/composables/useApi.ts`, `apps/web/src/stores/auth.ts`, `apps/web/src/stores/config.ts`, `apps/web/src/components/layout/NavBar.vue`
- Test: extend `tests/use-api.test.ts`, `tests/auth-store.test.ts`

**Interfaces:**
- Consumes: `POST /api/players` (Task 10), `POST /api/admin/refresh` (Task 11), `AuthUser.isAdmin` (Task 7).
- Produces: `apiPost<T>(path: string, body?: unknown): Promise<T>` and `ApiError.data?: unknown` from `composables/useApi`; `refresh(): Promise<void>` on both the auth and config stores.

- [ ] **Step 1: Write the failing tests**

Append to `tests/use-api.test.ts` (add `apiPost` to the existing import):

```ts
describe('apiPost', () => {
  it('sends a JSON body and returns the parsed response', async () => {
    const spy = vi.fn(async () => new Response(JSON.stringify({ player: { id: '1' } }), { status: 201 }))
    vi.stubGlobal('fetch', spy)
    await expect(apiPost('/api/players', { accountId: '42' })).resolves.toEqual({ player: { id: '1' } })
    const [, init] = spy.mock.calls[0] as unknown as [string, RequestInit]
    expect(init.method).toBe('POST')
    expect(init.body).toBe(JSON.stringify({ accountId: '42' }))
    expect(init.headers).toMatchObject({ 'content-type': 'application/json' })
  })

  it('sends no body or content-type when body is omitted', async () => {
    const spy = vi.fn(async () => new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', spy)
    await apiPost('/api/players')
    const [, init] = spy.mock.calls[0] as unknown as [string, RequestInit]
    expect(init.body).toBeUndefined()
  })

  it('surfaces the error payload on ApiError.data', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: 'no_public_data', name: 'chiPe' }), { status: 422 }))
    )
    const err = await apiPost('/api/players').catch((e) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).status).toBe(422)
    expect((err as ApiError).data).toEqual({ error: 'no_public_data', name: 'chiPe' })
  })
})
```

Append to `tests/auth-store.test.ts`:

```ts
  it('refresh() drops the memo and refetches', async () => {
    const spy = vi.fn(async () => new Response(JSON.stringify({ user: null }), { status: 200 }))
    vi.stubGlobal('fetch', spy)
    const auth = useAuthStore()
    await auth.load()
    await auth.refresh()
    expect(spy).toHaveBeenCalledTimes(2)
  })
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter "./packages/*" build && pnpm exec vitest run tests/use-api.test.ts tests/auth-store.test.ts`
Expected: FAIL — `apiPost` is not exported; `auth.refresh` is not a function.

- [ ] **Step 3: Implement composable + stores**

In `apps/web/src/composables/useApi.ts`: extend `ApiError` with a third constructor param and add `apiPost`:

```ts
/** Thrown for every useApi failure. status is the HTTP status, 0 for timeout/network.
 *  data carries the parsed error payload when the server sent JSON. */
export class ApiError extends Error {
  constructor(message: string, public readonly status: number, public readonly data?: unknown) {
    super(message)
    this.name = 'ApiError'
  }
}
```

```ts
/** POST JSON (or an empty body) to the API. Error payloads land on ApiError.data. */
export async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  const url = new URL(path, base || window.location.origin)
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 15000)
  try {
    const res = await fetch(url.toString(), {
      method: 'POST',
      ...(body !== undefined && {
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
      signal: controller.signal,
    })
    const data: unknown = await res.json().catch(() => undefined)
    if (!res.ok) {
      throw new ApiError(`API ${res.status}: ${path}`, res.status, data)
    }
    return data as T
  } catch (e) {
    if (e instanceof ApiError) throw e
    if (e instanceof DOMException && e.name === 'AbortError') {
      throw new ApiError(`Request timeout: ${path}`, 0)
    }
    throw new ApiError(`Network error: ${path}`, 0)
  } finally {
    clearTimeout(timeoutId)
  }
}
```

In `apps/web/src/stores/auth.ts`: add after `logout()` and include in the returned object:

```ts
  async function refresh() {
    loadPromise = null
    return load()
  }
```

```ts
  return { user, load, logout, refresh }
```

In `apps/web/src/stores/config.ts`: identical `refresh()` addition:

```ts
  async function refresh() {
    loadPromise = null
    return load()
  }
```

```ts
  return { siteName, players, lastRefreshed, load, refresh }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter "./packages/*" build && pnpm exec vitest run tests/use-api.test.ts tests/auth-store.test.ts`
Expected: PASS.

- [ ] **Step 5: The AccountActions component**

Create `apps/web/src/components/layout/AccountActions.vue`:

```vue
<script setup lang="ts">
import { ref } from 'vue'
import { apiPost, ApiError } from '@/composables/useApi'
import { useAuthStore } from '@/stores/auth'
import { useConfigStore } from '@/stores/config'
import type { Player } from '@friendtracker/shared'

const auth = useAuthStore()
const config = useConfigStore()

const busy = ref(false)
const message = ref('')
const privateName = ref('')
const accountIdInput = ref('')

function applyError(e: unknown) {
  privateName.value = ''
  if (!(e instanceof ApiError)) {
    message.value = 'Something went wrong — try again.'
    return
  }
  const data = e.data as { error?: string; name?: string } | undefined
  if (data?.error === 'no_public_data') {
    privateName.value = data.name || 'this account'
    message.value = ''
  } else if (data?.error === 'already_tracked') {
    message.value = 'Already tracked.'
  } else if (data?.error === 'account_not_found') {
    message.value = 'No Dota account found for that ID.'
  } else if (data?.error === 'invalid_account_id') {
    message.value = "That doesn't look like a Steam account ID."
  } else if (data?.error === 'opendota_unavailable') {
    message.value = 'OpenDota is unavailable right now — try again later.'
  } else {
    message.value = 'Something went wrong — try again.'
  }
}

async function addPlayer(accountId?: string) {
  busy.value = true
  message.value = ''
  privateName.value = ''
  try {
    await apiPost<{ player: Player }>('/api/players', accountId ? { accountId } : undefined)
    message.value = 'Added — stats appear after the first sync.'
    accountIdInput.value = ''
    auth.refresh()
    config.refresh()
  } catch (e) {
    applyError(e)
  } finally {
    busy.value = false
  }
}

async function refreshNow() {
  busy.value = true
  message.value = ''
  privateName.value = ''
  try {
    const res = await apiPost<{ queued: boolean }>('/api/admin/refresh')
    message.value = res.queued ? 'Refresh queued.' : 'A refresh is already queued.'
  } catch {
    message.value = 'Refresh failed — try again.'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="relative flex items-center gap-2 text-sm">
    <button
      v-if="auth.user && !auth.user.playerId"
      class="px-2 py-1 rounded border opacity-90 hover:opacity-100 transition cursor-pointer"
      style="color: var(--color-dota-gold); border-color: var(--color-dota-border);"
      :disabled="busy"
      @click="addPlayer()"
    >
      Track my account
    </button>
    <template v-if="auth.user?.isAdmin">
      <input
        v-model="accountIdInput"
        placeholder="Account ID"
        class="w-28 px-2 py-1 rounded border bg-transparent"
        style="color: var(--color-dota-text); border-color: var(--color-dota-border);"
      />
      <button
        class="px-2 py-1 rounded border opacity-90 hover:opacity-100 transition cursor-pointer"
        style="color: var(--color-dota-text); border-color: var(--color-dota-border);"
        :disabled="busy || !accountIdInput"
        @click="addPlayer(accountIdInput)"
      >
        Add
      </button>
      <button
        class="px-2 py-1 rounded border opacity-90 hover:opacity-100 transition cursor-pointer"
        style="color: var(--color-dota-text); border-color: var(--color-dota-border);"
        :disabled="busy"
        @click="refreshNow()"
      >
        Refresh now
      </button>
    </template>
    <span v-if="message" style="color: var(--color-dota-text-dim);">{{ message }}</span>
    <div
      v-if="privateName"
      class="absolute top-full right-0 mt-2 w-72 p-3 rounded border z-20"
      style="background-color: var(--color-dota-bg-card); border-color: var(--color-dota-border); color: var(--color-dota-text);"
    >
      Found <strong>{{ privateName }}</strong> — but their match data isn't public.
      In Dota 2: Settings → Options → Social →
      <strong>Expose Public Match Data</strong>, then try again.
      <button
        class="block mt-2 underline cursor-pointer"
        style="color: var(--color-dota-text-dim);"
        @click="privateName = ''"
      >
        Dismiss
      </button>
    </div>
  </div>
</template>
```

Wire it into `apps/web/src/components/layout/NavBar.vue`: add the import in the script block:

```ts
import AccountActions from './AccountActions.vue'
```

and inside the signed-in `<div v-else class="flex items-center gap-2">`, insert `<AccountActions />` immediately before the Log out button.

- [ ] **Step 6: Type-check the web app and run the suite**

Run: `pnpm --filter web lint && pnpm test`
Expected: green.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/composables/useApi.ts apps/web/src/stores/auth.ts apps/web/src/stores/config.ts apps/web/src/components/layout/AccountActions.vue apps/web/src/components/layout/NavBar.vue tests/use-api.test.ts tests/auth-store.test.ts
git commit -m "web: track-my-account + admin add/refresh controls in the nav bar

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 13: Docs, image builds, final verification

Documentation catches up with the new layout and endpoints; both Docker images (edited blind in Tasks 1/2) are build-verified; the full gate runs one last time. A manual browser spike is listed for dakiman — agents stop at the automated checks.

**Files:**
- Modify: `CLAUDE.md`, `DEPLOY.md`, `ROADMAP.md`, `.env.example` (only if Task 7's entry is missing)

- [ ] **Step 1: Update CLAUDE.md**

Apply these content changes (wording may be tightened to fit surrounding text):

- **Project Overview** package list: add `packages/db` — `Drizzle schema, pg client, migrations` and `packages/pipeline` — `OpenDota fetch jobs, job registry, queue runner`.
- **Database commands**: `pnpm --filter api db:generate|db:migrate|db:studio` → `pnpm --filter @friendtracker/db db:generate|db:migrate|db:studio`; note migrations live in `packages/db/migrations`.
- **Data section**: note that in production the refresh container now *enqueues* pipeline jobs (`scripts/enqueue-job.ts`) and the API's in-process poller executes them (5 s tick, serial, logs to `refresh_runs`); `backup-db` remains a direct cron run; manual `pnpm fetch-data` etc. still run jobs directly.
- **Architecture → API routes**: add `POST /api/players` (signed-in self-add / admin add, OpenDota-validated, enqueues `fetch-player`) and `POST /api/admin/refresh` (admin, enqueues the refresh trio).
- **Auth paragraph**: replace "Auth protects nothing yet — it is infrastructure for later phases." with: mutations are live as of 3b; admins come from `ADMIN_STEAM_IDS` (comma-separated steam64s, `AuthUser.isAdmin` computed per request); CSRF = Origin-allowlist middleware on mutating methods over the SameSite=Lax cookie; strict 10/min limiter also covers `/api/players` and `/api/admin/*`.
- **Environment**: add `ADMIN_STEAM_IDS` and `OPENDOTA_RATE_MS` (test-only override) to the variables list.

- [ ] **Step 2: Update DEPLOY.md (operator notes — do NOT touch /srv/dakis)**

Add a "Phase 3b rollout" section:

```markdown
## Phase 3b rollout (operator)

1. Set `ADMIN_STEAM_IDS=<dakiman's steam64>` on the **api** service environment
   in /srv/dakis/apps/dota2tracker/compose.yml.
2. Rebuild both images (new packages + crontab):
   `cd /srv/dakis && sg docker -c 'docker compose up -d --build dota2tracker-api dota2tracker-refresh'`
3. Verify: sign in on :8743 → admin controls appear; "Refresh now" → footer
   data-age resets within a minute (poller executes the queued trio);
   `SELECT * FROM jobs ORDER BY id DESC LIMIT 5` shows done rows.
4. Commit /srv/dakis.
```

- [ ] **Step 3: Tick ROADMAP.md**

In the Phase 3 section, mark 3b done in the same style as 3a:

- Change the `**3b — Pipeline-as-service + self-service players**` bullet to `— ✅ **DONE <today's date>** —` followed by a one-paragraph summary: `packages/db` + `packages/pipeline` extracted; `jobs` queue (generated migration 0008) + in-process poller as single executor; refresh container demoted to enqueuer (backup-db stays direct); `POST /api/players` (self-serve + admin, OpenDota validation with the no-public-data UX) and `POST /api/admin/refresh`; `ADMIN_STEAM_IDS` admins; CSRF origin middleware; `refresh-profiles` job; 30-day parse window.
- Update the **Status** line at the top: Phase 3b implemented; next up 3c.
- Update the "Chipe (78589430) has no public OpenDota data" known-gap bullet: onboarding is now self-service — once he enables the setting, the next 6 h cron (or admin refresh) picks up his history; re-adding is blocked with a 409 but unnecessary.

- [ ] **Step 4: Build both Docker images (deferred from Tasks 1/2)**

```bash
cd /home/dakiman/dev/dota2tracker
sg docker -c 'docker compose -p dota2tracker build api refresh'
```

Expected: both images build cleanly. **Do not `up` the api service** — port 3000 is owned by jira-rag on this host. If a build fails, fix the Dockerfile and re-run before committing.

- [ ] **Step 5: Full gate**

```bash
pnpm lint && pnpm test
git status -s
```

Expected: lint + full suite green; only the intended doc files modified.

- [ ] **Step 6: Commit**

```bash
git add CLAUDE.md DEPLOY.md ROADMAP.md .env.example
git commit -m "docs: phase 3b build log — pipeline packages, job queue, self-service players

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

- [ ] **Step 7: Manual spike (dakiman, optional, not agent-run)**

Post-rollout sanity on real infrastructure: start the dev stack (`db` + dev API on a free port + `pnpm dev:web`), sign in with Steam, click "Track my account" with a fresh account, watch the poller log run `fetch-player`, and confirm the 422 copy renders for a private account (a second Steam account with data unexposed, or temporary curiosity via the admin input and a known-private friend's ID).

---

## Execution order & dependencies

```
Task 1 (packages/db) ─→ Task 2 (packages/pipeline) ─→ Task 3 (jobs + enqueue) ─→ Task 4 (runner)
                                                            │                        │
                                                            └─→ Task 5 (new jobs) ──┼─→ Task 6 (poller)
                                                                       │             └─→ Task 9 (cron enqueuer)
Task 7 (authz) ─→ Task 8 (CSRF) ─→ Task 10 (POST /api/players, needs 3+5) ─→ Task 11 (admin refresh) ─→ Task 12 (web) ─→ Task 13 (docs + builds)
```

Tasks 7–8 only require Task 1 (db package) and can be interleaved earlier if convenient, but the listed order keeps the queue machinery finished before the routes that use it.
