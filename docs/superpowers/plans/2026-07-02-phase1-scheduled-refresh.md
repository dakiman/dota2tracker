# Phase 1: Scheduled Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the manually-run OpenDota data pipeline with a scheduled refresh container, with run logging (`refresh_runs`), a "data updated X ago" indicator in the UI, and a parse-request job that improves parsed-match coverage.

**Architecture:** The four pipeline scripts (`fetch-data`, `populate-builds`, `fetch-hero-builds`, `fetch-player-builds`) each gain an exported `run(): Promise<string>` and lose their self-executing footer. A new `scripts/run-job.ts` CLI wraps any job with start/finish logging into a new `refresh_runs` table. A new `dota2tracker-refresh` container (node:22-alpine + BusyBox crond) runs the jobs on a schedule: cheap match-sync every 6h, slow build-fetchers daily. `GET /api/config` exposes the last successful `fetch-data` finish time; the web footer renders it.

**Tech Stack:** TypeScript (ESM, run via `tsx`), Drizzle ORM + node-postgres, Hono, Vue 3, Docker (BusyBox crond — no supercronic download needed), pnpm 9 monorepo.

## Global Constraints

- Repo root: `/home/dakiman/dev/dota2tracker`. All commands run from repo root unless stated.
- This machine's shell is not in the `docker` group: **every** docker command must be wrapped as `sg docker -c '...'`.
- Local Postgres for verification: `sg docker -c 'docker compose up -d db'` (published on `localhost:5474`). Ensure `.env` exists (`cp .env.example .env` if missing) — scripts load `DATABASE_URL` via `dotenv`.
- Pin `pnpm@9` anywhere `corepack prepare` appears in a Dockerfile (pnpm v10 fails on `ERR_PNPM_IGNORED_BUILDS`).
- **No test runner exists yet** (it arrives in the Phase 2 plan). Every task ends with a concrete manual verification command instead of a unit test; run it and check the expected output before committing.
- Type-check gate for every task: `pnpm lint` must pass (it builds `@friendtracker/shared`, type-checks all packages, and runs `tsc -p scripts`).
- Scripts hit the live OpenDota API (free tier: 2 000 calls/day, ~60/min; scripts self-pace at 1.1 s/call and retry on 429). Verification runs below cost ≤ ~15 calls each — safe to run repeatedly.
- Commit after every task with the exact message given.

---

### Task 1: `refresh_runs` table + exported pg pool

**Files:**
- Modify: `apps/api/src/db/index.ts`
- Modify: `apps/api/src/db/schema.ts`
- Create (generated): `apps/api/src/db/migrations/0004_refresh_runs.sql`

**Interfaces:**
- Consumes: existing Drizzle schema helpers.
- Produces: `refreshRuns` table object (columns `id`, `job`, `startedAt`, `finishedAt`, `ok`, `detail`) and `pool` (a `pg.Pool`), both importable from `apps/api/src/db/index.js`. Task 3's `run-job.ts` and Task 5's config route rely on these exact names.

- [x] **Step 1: Export the pool from `apps/api/src/db/index.ts`**

Replace lines 10–11:

```ts
const pool = new pg.Pool({ connectionString })
export const db = drizzle(pool, { schema })
```

with:

```ts
export const pool = new pg.Pool({ connectionString })
export const db = drizzle(pool, { schema })
```

(If `pool` is already exported — the Phase 2 plan also adds this — skip this step.)

- [x] **Step 2: Add the `refreshRuns` table to `apps/api/src/db/schema.ts`**

Append at the end of the file (after `playerMatches`):

```ts
/** One row per pipeline job run — written by scripts/run-job.ts */
export const refreshRuns = pgTable('refresh_runs', {
  id: serial('id').primaryKey(),
  job: text('job').notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  ok: boolean('ok'),
  detail: jsonb('detail').$type<{ summary?: string; error?: string }>(),
})
```

All helpers used (`pgTable`, `serial`, `text`, `timestamp`, `boolean`, `jsonb`) are already imported at the top of the file.

- [x] **Step 3: Generate the migration**

Run: `pnpm --filter api db:generate --name refresh_runs`
Expected: a new file `apps/api/src/db/migrations/0004_refresh_runs.sql` containing `CREATE TABLE "refresh_runs" (...)` (drizzle may quote/format slightly differently; the table and 6 columns must be present). Open the file and confirm it only creates `refresh_runs` — it must NOT alter any existing table (if it does, the schema edit went wrong; stop and re-check Step 2).

- [x] **Step 4: Apply the migration locally**

Run: `sg docker -c 'docker compose up -d db'` then `pnpm --filter api db:migrate`
Expected: exits 0.

- [x] **Step 5: Verify the table exists**

Run: `sg docker -c 'docker compose exec db psql -U friendtracker -c "\\d refresh_runs"'`
Expected: table listing with columns `id`, `job`, `started_at` (timestamp with time zone), `finished_at`, `ok`, `detail`.

- [x] **Step 6: Type-check**

Run: `pnpm lint`
Expected: exits 0.

- [x] **Step 7: Commit**

```bash
git add apps/api/src/db/
git commit -m "db: add refresh_runs job log table, export pg pool"
```

---

### Task 2: POST support in the shared OpenDota fetch helper

**Files:**
- Modify: `scripts/lib/opendota.ts`

**Interfaces:**
- Produces: `fetchJson<T>(url: string, init?: RequestInit): Promise<T>` — Task 4's parse-request script passes `{ method: 'POST' }`. Existing GET callers are unaffected (parameter is optional).

- [x] **Step 1: Thread `init` through to `fetch`**

Replace the `fetchJson` function in `scripts/lib/opendota.ts` with:

```ts
export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(url, init)
    if (res.status === 429) {
      const retryAfter = Number(res.headers.get('retry-after')) || 60
      console.log(`    Rate limited, sleeping ${retryAfter}s before retry...`)
      await sleep(retryAfter * 1000)
      continue
    }
    if (!res.ok) throw new Error(`OpenDota ${res.status}: ${url}`)
    return res.json() as Promise<T>
  }
  throw new Error(`OpenDota: gave up after 5 retries on ${url}`)
}
```

- [x] **Step 2: Type-check**

Run: `pnpm lint`
Expected: exits 0.

- [x] **Step 3: Commit**

```bash
git add scripts/lib/opendota.ts
git commit -m "scripts: fetchJson accepts RequestInit for POST parse requests"
```

---

### Task 3: `run()` exports + `run-job.ts` wrapper with refresh_runs logging

**Files:**
- Modify: `scripts/fetch-data.ts`
- Modify: `scripts/populate-builds.ts`
- Modify: `scripts/fetch-hero-builds.ts`
- Modify: `scripts/fetch-player-builds.ts`
- Create: `scripts/run-job.ts`
- Modify: `package.json` (root)

**Interfaces:**
- Consumes: `refreshRuns`, `pool` from Task 1.
- Produces: each script exports `run(): Promise<string>` (the returned string is a one-line human summary stored in `refresh_runs.detail.summary`). `scripts/run-job.ts <job-name>` is the only CLI entrypoint from now on; `pnpm fetch-data` etc. keep working because package.json routes them through it. **No script self-executes on import anymore** — this is what makes them importable by the API later (Phase 3) and by tests.

- [x] **Step 1: Convert `scripts/fetch-data.ts` to an exported `run()`**

Three edits:

(a) Change the function signature and the no-players early exit (currently `async function main() {` and a `process.exit(0)` block) to:

```ts
export async function run(): Promise<string> {
  const playerRows = await db.select().from(players)
  if (playerRows.length === 0) {
    return 'no players in DB — run seed first'
  }
```

(b) Track totals and return a summary. Add `let totalRows = 0` immediately before the `for (const player of playerRows) {` loop; inside the loop after the chunked upsert loop, add `totalRows += rows.length` right before the existing `console.log(\`Upserted ...\`)` line. Replace the final line of the function body (`console.log('Fetch done.')`) with:

```ts
  return `synced ${heroList.length} heroes; upserted ${totalRows} match rows for ${playerRows.length} players`
```

(c) Delete the footer entirely:

```ts
main().catch((e) => {
  console.error(e)
  process.exit(1)
})
```

- [x] **Step 2: Convert `scripts/populate-builds.ts`**

Change `async function main() {` to `export async function run(): Promise<string> {`. Replace the final `console.log(...)` statement of the function with:

```ts
  return `${rows.length} hero+role rows upserted, ${stale.length} stale rows pruned`
```

Delete the `main().catch(...)` footer (same three-line pattern as Step 1c).

- [x] **Step 3: Convert `scripts/fetch-hero-builds.ts`**

Change `async function main() {` to `export async function run(): Promise<string> {`. Replace the final `console.log(\`\nfetch-hero-builds done: ...\`)` with:

```ts
  return `${updated} hero builds updated, ${skipped} skipped (curated)`
```

Delete the `main().catch(...)` footer.

- [x] **Step 4: Convert `scripts/fetch-player-builds.ts`**

Change `async function main() {` (line ~488) to `export async function run(): Promise<string> {`. Change the no-players early exit from `console.log('No players in DB. Run seed first.'); process.exit(0)` to `return 'no players in DB — run seed first'`. Replace the final `console.log(\`\nfetch-player-builds done: ...\`)` with:

```ts
  return `${totalUpdated} player builds updated, ${totalSkipped} skipped`
```

Delete the `main().catch(...)` footer.

- [x] **Step 5: Create `scripts/run-job.ts`**

```ts
/**
 * Single CLI entrypoint for all pipeline jobs. Wraps each job with a
 * refresh_runs row (started/finished/ok/detail) so scheduled runs are
 * observable. Usage: tsx scripts/run-job.ts <job-name>
 */
import 'dotenv/config'
import { eq } from 'drizzle-orm'
import { db, pool, refreshRuns } from '../apps/api/src/db/index.js'

type JobModule = { run: () => Promise<string> }

const JOBS: Record<string, () => Promise<JobModule>> = {
  'fetch-data': () => import('./fetch-data.js'),
  'populate-builds': () => import('./populate-builds.js'),
  'fetch-hero-builds': () => import('./fetch-hero-builds.js'),
  'fetch-player-builds': () => import('./fetch-player-builds.js'),
}

async function main() {
  const name = process.argv[2]
  const loader = name ? JOBS[name] : undefined
  if (!name || !loader) {
    console.error(`Usage: tsx scripts/run-job.ts <${Object.keys(JOBS).join('|')}>`)
    process.exit(2)
  }

  const [row] = await db
    .insert(refreshRuns)
    .values({ job: name })
    .returning({ id: refreshRuns.id })

  try {
    const mod = await loader()
    const summary = await mod.run()
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

- [x] **Step 6: Route the root package.json scripts through run-job**

In root `package.json`, replace the five pipeline script entries (leave `seed` untouched — it is a one-off, not a scheduled job):

```json
    "fetch-data": "pnpm tsx scripts/run-job.ts fetch-data",
    "populate-builds": "pnpm tsx scripts/run-job.ts populate-builds",
    "fetch-hero-builds": "pnpm tsx scripts/run-job.ts fetch-hero-builds",
    "fetch-player-builds": "pnpm tsx scripts/run-job.ts fetch-player-builds",
    "refresh": "pnpm fetch-data && pnpm populate-builds && pnpm fetch-hero-builds && pnpm fetch-player-builds",
```

- [x] **Step 7: Type-check**

Run: `pnpm lint`
Expected: exits 0. (Common failure: a leftover `main().catch` footer referencing a renamed function.)

- [x] **Step 8: Verify end-to-end against the local DB**

Run: `pnpm fetch-data` (db must be up and seeded; if empty, run `pnpm seed` first)
Expected output ends with: `[run-job] fetch-data ok: synced <N> heroes; upserted <M> match rows for <P> players`, and the process **exits promptly** (pool.end() — no 10 s hang).

Run: `pnpm populate-builds`
Expected: `[run-job] populate-builds ok: ...`

- [x] **Step 9: Verify the refresh_runs rows**

Run: `sg docker -c 'docker compose exec db psql -U friendtracker -c "SELECT id, job, ok, started_at, finished_at, detail FROM refresh_runs ORDER BY id DESC LIMIT 5"'`
Expected: one row per job just run, `ok = t`, non-null `finished_at`, `detail` containing the summary string.

- [x] **Step 10: Verify the failure path**

Run: `DATABASE_URL='postgresql://friendtracker:devpassword@localhost:5474/friendtracker' pnpm tsx scripts/run-job.ts no-such-job; echo "exit=$?"`
Expected: usage message and `exit=2`.

- [x] **Step 11: Commit**

```bash
git add scripts/ package.json
git commit -m "scripts: export run() from pipeline jobs, add run-job wrapper with refresh_runs logging"
```

---

### Task 4: Parse-request job

**Files:**
- Create: `scripts/request-parses.ts`
- Modify: `scripts/run-job.ts` (add JOBS entry)
- Modify: `package.json` (root — add script)

**Interfaces:**
- Consumes: `fetchJson(url, init)` from Task 2; `playerMatches` schema; `run-job.ts` registry from Task 3.
- Produces: `run(): Promise<string>` in `scripts/request-parses.ts`; job name `request-parses` runnable via run-job. Task 6's crontab calls it on the 6-hourly chain.

- [x] **Step 1: Create `scripts/request-parses.ts`**

```ts
/**
 * Asks OpenDota to parse the group's recent unparsed matches so later
 * fetch-data runs pick up lane/role data (lane_role is only present on
 * parsed matches). Only the last 14 days are eligible — OpenDota can't
 * parse matches whose replays have expired (~2 weeks), so older rows
 * would be wasted requests. Capped per run to stay polite on the free tier.
 */
import 'dotenv/config'
import { sql } from 'drizzle-orm'
import { db, playerMatches } from '../apps/api/src/db/index.js'
import { fetchJson, sleep } from './lib/opendota.js'

const OPENDOTA = 'https://api.opendota.com/api'
const RATE_MS = 1100
const MAX_REQUESTS = 10

export async function run(): Promise<string> {
  const rows = await db
    .selectDistinct({ matchId: playerMatches.matchId })
    .from(playerMatches)
    .where(
      sql`${playerMatches.laneRole} IS NULL AND ${playerMatches.startTime} > now() - interval '14 days'`
    )
    .orderBy(sql`${playerMatches.matchId} DESC`)
    .limit(MAX_REQUESTS)

  let requested = 0
  for (const { matchId } of rows) {
    try {
      await fetchJson(`${OPENDOTA}/request/${matchId}`, { method: 'POST' })
      requested++
      console.log(`  Requested parse for match ${matchId}`)
    } catch (e) {
      console.error(`  Parse request failed for ${matchId}: ${e instanceof Error ? e.message : e}`)
    }
    await sleep(RATE_MS)
  }

  return `requested parse for ${requested}/${rows.length} unparsed recent matches`
}
```

- [x] **Step 2: Register the job**

In `scripts/run-job.ts`, add to the `JOBS` map:

```ts
  'request-parses': () => import('./request-parses.js'),
```

In root `package.json`, add next to the other pipeline scripts:

```json
    "request-parses": "pnpm tsx scripts/run-job.ts request-parses",
```

- [x] **Step 3: Type-check**

Run: `pnpm lint`
Expected: exits 0.

- [x] **Step 4: Verify live**

Run: `pnpm request-parses`
Expected: `[run-job] request-parses ok: requested parse for K/N unparsed recent matches` (K may be 0 if there are no recent unparsed matches — that is a pass; the interesting assertion is a clean `ok` run and a new `refresh_runs` row, check with the psql command from Task 3 Step 9).

- [x] **Step 5: Commit**

```bash
git add scripts/request-parses.ts scripts/run-job.ts package.json
git commit -m "scripts: add request-parses job to improve parsed-match coverage"
```

---

### Task 5: `lastRefreshed` in /api/config + web footer

**Files:**
- Modify: `packages/shared/src/types.ts` (the `AppConfig` interface, ~line 14)
- Modify: `apps/api/src/routes/config.ts`
- Modify: `apps/web/src/stores/config.ts`
- Create: `apps/web/src/utils/relativeTime.ts`
- Modify: `apps/web/src/App.vue`

**Interfaces:**
- Consumes: `refreshRuns` from Task 1; job name `'fetch-data'` written by Task 3.
- Produces: `AppConfig.lastRefreshed: string | null` (ISO timestamp of the last successful fetch-data run); `relativeTime(iso: string): string` helper; footer in `App.vue`.

- [x] **Step 1: Extend the shared type**

In `packages/shared/src/types.ts`, add to the `AppConfig` interface (alongside `siteName` and `players`):

```ts
  /** ISO timestamp of the last successful fetch-data run, null if never */
  lastRefreshed: string | null
```

- [x] **Step 2: Return it from the config route**

Replace `apps/api/src/routes/config.ts` with:

```ts
import { Hono } from 'hono'
import { and, desc, eq } from 'drizzle-orm'
import { db, players, refreshRuns } from '../db/index.js'
import type { AppConfig } from '@friendtracker/shared'

const config = new Hono()

config.get('/', async (c) => {
  try {
    const rows = await db.select().from(players)
    const [lastRun] = await db
      .select({ finishedAt: refreshRuns.finishedAt })
      .from(refreshRuns)
      .where(and(eq(refreshRuns.job, 'fetch-data'), eq(refreshRuns.ok, true)))
      .orderBy(desc(refreshRuns.finishedAt))
      .limit(1)
    const siteName = process.env.SITE_NAME ?? 'FriendTracker'
    const payload: AppConfig = {
      siteName,
      players: rows.map((p) => ({
        id: p.id,
        name: p.name,
        avatar: p.avatar ?? undefined,
      })),
      lastRefreshed: lastRun?.finishedAt?.toISOString() ?? null,
    }
    return c.json(payload)
  } catch (err) {
    console.error('Route error:', err)
    return c.json({ error: 'Internal server error' }, 500)
  }
})

export default config
```

- [x] **Step 3: Create `apps/web/src/utils/relativeTime.ts`**

```ts
const UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ['day', 86_400_000],
  ['hour', 3_600_000],
  ['minute', 60_000],
]

/** "2 hours ago" style formatting for an ISO timestamp in the past. */
export function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })
  for (const [unit, ms] of UNITS) {
    if (Math.abs(diff) >= ms) return rtf.format(Math.round(-diff / ms), unit)
  }
  return 'just now'
}
```

- [x] **Step 4: Surface it in the config store**

In `apps/web/src/stores/config.ts`: add `const lastRefreshed = ref<string | null>(null)` next to the `players` ref; inside `load()` after `players.value = cfg.players` add `lastRefreshed.value = cfg.lastRefreshed`; add `lastRefreshed` to the returned object.

- [x] **Step 5: Render the footer in `apps/web/src/App.vue`**

Add the import to the script block:

```ts
import { relativeTime } from '@/utils/relativeTime'
```

and add a footer inside the root `div`, after `</main>`:

```vue
    <footer
      v-if="config.lastRefreshed"
      class="container mx-auto px-4 py-4 text-center text-xs text-dota-text-dim"
    >
      Data updated {{ relativeTime(config.lastRefreshed) }}
    </footer>
```

- [x] **Step 6: Type-check**

Run: `pnpm lint`
Expected: exits 0.

- [x] **Step 7: Verify the API payload**

With the local db up (it has refresh_runs rows from Task 3), run: `pnpm dev:api &` then `curl -s http://localhost:3000/api/config | head -c 400`, then kill the dev server.
Expected: JSON containing `"lastRefreshed":"20..."` (an ISO timestamp, not null).

- [x] **Step 8: Verify the footer visually (optional but recommended)**

Run `pnpm dev:api` and `pnpm dev:web`, open `http://localhost:5173` — footer shows "Data updated N minutes ago". Stop both.

- [x] **Step 9: Commit**

```bash
git add packages/shared/src/types.ts apps/api/src/routes/config.ts apps/web/src/
git commit -m "feat: expose lastRefreshed on /api/config, render data-age footer"
```

---

### Task 6: Refresh container (Dockerfile, crontab, entrypoint, local compose)

**Files:**
- Create: `infra/refresh/Dockerfile`
- Create: `infra/refresh/crontab`
- Create: `infra/refresh/entrypoint.sh`
- Modify: `docker-compose.yml`

**Interfaces:**
- Consumes: `scripts/run-job.ts` job names from Tasks 3–4; `DATABASE_URL` env var (scripts read it via dotenv/env).
- Produces: a `refresh` compose service (prod will name it `dota2tracker-refresh`, Task 7). Image runs BusyBox `crond` as PID 1; job output is redirected to `/proc/1/fd/1` so it lands in `docker logs`.

- [x] **Step 1: Create `infra/refresh/Dockerfile`**

```dockerfile
# Scheduled data-refresh runner: full pnpm workspace + tsx so the pipeline
# scripts run from source. Deliberately not size-optimized — this image is
# not on the serving path. BusyBox crond (built into alpine) is PID 1.
FROM node:22-alpine
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9 --activate
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN pnpm install --frozen-lockfile \
  && rm -rf /root/.cache /root/.local/share/pnpm /root/.npm
RUN pnpm --filter @friendtracker/shared build
COPY apps/api/src/db apps/api/src/db
COPY scripts scripts
COPY infra/refresh/crontab /etc/crontabs/root
COPY infra/refresh/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
CMD ["/entrypoint.sh"]
```

- [x] **Step 2: Create `infra/refresh/crontab`** (BusyBox format; must end with a newline; times are UTC)

```
# Cheap match sync + aggregates + parse requests: every 6 hours.
# ~10 OpenDota calls + up to 10 parse requests per run.
20 */6 * * * cd /app && ./node_modules/.bin/tsx scripts/run-job.ts fetch-data > /proc/1/fd/1 2>&1 && ./node_modules/.bin/tsx scripts/run-job.ts populate-builds > /proc/1/fd/1 2>&1 && ./node_modules/.bin/tsx scripts/run-job.ts request-parses > /proc/1/fd/1 2>&1
# Slow build fetchers: daily, off-peak. ~300-500 OpenDota calls.
40 3 * * * cd /app && ./node_modules/.bin/tsx scripts/run-job.ts fetch-hero-builds > /proc/1/fd/1 2>&1 && ./node_modules/.bin/tsx scripts/run-job.ts fetch-player-builds > /proc/1/fd/1 2>&1
```

- [x] **Step 3: Create `infra/refresh/entrypoint.sh`**

```sh
#!/bin/sh
# Run one cheap sync on container start (idempotent, ~10 API calls) so a
# fresh deploy is never stale until the first cron tick, then hand off to
# crond as PID 1 (exec => clean SIGTERM handling).
cd /app
./node_modules/.bin/tsx scripts/run-job.ts fetch-data || echo "initial fetch-data failed; cron will retry"
./node_modules/.bin/tsx scripts/run-job.ts populate-builds || echo "initial populate-builds failed; cron will retry"
exec crond -f -l 2
```

- [x] **Step 4: Add the service to `docker-compose.yml`**

Add after the `api` service (same indentation level):

```yaml
  refresh:
    build:
      context: .
      dockerfile: infra/refresh/Dockerfile
    environment:
      DATABASE_URL: postgresql://friendtracker:${DB_PASSWORD:-devpassword}@db:5432/friendtracker
    depends_on:
      db:
        condition: service_healthy
    restart: unless-stopped
```

- [x] **Step 5: Build and start it**

Run: `sg docker -c 'docker compose up -d --build refresh'`
Expected: image builds without error, container starts.

- [x] **Step 6: Verify the initial run in the logs**

Run: `sg docker -c 'docker compose logs refresh'` (wait ~60 s for the fetch to finish; each player fetch sleeps 1.1 s)
Expected: log lines ending in `[run-job] fetch-data ok: ...` and `[run-job] populate-builds ok: ...`, then silence (crond in foreground).

- [x] **Step 7: Verify rows landed via the container's DB path**

Run: `sg docker -c 'docker compose exec db psql -U friendtracker -c "SELECT job, ok, finished_at FROM refresh_runs ORDER BY id DESC LIMIT 3"'`
Expected: fresh `fetch-data` and `populate-builds` rows with `ok = t` and `finished_at` within the last few minutes.

- [x] **Step 8: Commit**

```bash
git add infra/ docker-compose.yml
git commit -m "infra: scheduled refresh container (crond: 6h match sync, daily build fetch)"
```

---

### Task 7: Production rollout + docs

**Requires access to `/srv/dakis` on dakis-server-v2** (this repo lives on the same host). If the executing agent lacks that access, complete Steps 1–2 (docs, in-repo) and hand Steps 3–6 to the operator verbatim.

**Files:**
- Modify: `DEPLOY.md`
- Modify: `CLAUDE.md` (project)
- Modify (outside repo): `/srv/dakis/apps/dota2tracker/compose.yml`

- [x] **Step 1: Update `DEPLOY.md`**

In the "Data pipeline" section, add at the top of the section:

```markdown
**Refresh is scheduled** — the `dota2tracker-refresh` container syncs matches every
6 h and rebuilds hero/player builds daily (see `infra/refresh/crontab`), logging every
run to the `refresh_runs` table. The manual commands below still work for one-off
runs and initial seeding.
```

- [x] **Step 2: Update project `CLAUDE.md`**

In the "Data" commands section, add:

```markdown
In production the pipeline is scheduled: the `dota2tracker-refresh` container runs
`fetch-data`+`populate-builds`+`request-parses` every 6 h and the build fetchers daily
(`infra/refresh/crontab`), logging to the `refresh_runs` table (surfaced as
`lastRefreshed` on `/api/config`).
```

Commit both:

```bash
git add DEPLOY.md CLAUDE.md
git commit -m "docs: document scheduled refresh container"
```

- [ ] **Step 3 (operator): Add the service to the prod compose**

Edit `/srv/dakis/apps/dota2tracker/compose.yml`. Add a `dota2tracker-refresh` service mirroring the existing `dota2tracker-api` service's `env_file:` and `depends_on:` **exactly as they appear in that file** (the secrets env already carries the correct in-network `DATABASE_URL`), with:

```yaml
  dota2tracker-refresh:
    build:
      context: /home/dakiman/dev/dota2tracker
      dockerfile: infra/refresh/Dockerfile
    restart: unless-stopped
    # copy env_file: and depends_on: from the dota2tracker-api service in this file
```

- [ ] **Step 4 (operator): Deploy**

```bash
cd /srv/dakis
sg docker -c 'docker compose up -d --build dota2tracker-refresh'
sg docker -c 'docker compose logs -f dota2tracker-refresh'   # expect the two initial "[run-job] ... ok" lines
```

- [ ] **Step 5 (operator): Verify prod data-age surfaces**

```bash
curl -s http://localhost:8743/api/config | grep -o '"lastRefreshed":"[^"]*"'
```

Expected: a timestamp from the last few minutes. The web footer at `http://192.168.100.81:8743` shows "Data updated ... ago".

- [ ] **Step 6 (operator): Commit the deployment repo**

```bash
cd /srv/dakis && git add -A && git -c user.email=dakiman@dakis-server-v2 -c user.name=dakiman commit -m 'dota2tracker: add scheduled refresh container'
```
