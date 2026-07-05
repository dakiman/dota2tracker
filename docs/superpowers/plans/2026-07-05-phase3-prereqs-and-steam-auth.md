# Phase 3 Prerequisites + Phase 3a — Steam Auth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Repair Drizzle snapshot bookkeeping so `db:generate` works again, add nightly `pg_dump` backups to the refresh container, and ship Phase 3a — Steam OpenID login (`users`/`sessions`, httpOnly cookie, hand-rolled OpenID 2.0 verify), rate limiting, and a minimal sign-in UI. Auth deliberately protects nothing yet — it is infrastructure for Phase 3b/3c.

**Architecture:** One synthetic Drizzle snapshot (`0006_snapshot.json`) makes generation work; the `users`/`sessions` migration is then *generated*, proving the fix. Backups run as a `run-job.ts` job so they log to `refresh_runs` like every other pipeline job. Auth is three small modules under `apps/api/src/auth/` (openid, session, origin) + two middleware (`session`, `rate-limit`) wired into the previously middleware-free `app.ts`. Multi-origin (LAN/Tailscale/future public domain) is handled by matching the Host header against an `ALLOWED_ORIGINS` env allowlist whose entries carry the scheme.

**Tech Stack:** Hono 4.12 (`hono/cookie`, `hono/factory`) + Drizzle ORM 0.36 / drizzle-kit 0.28, `node:crypto`, Vue 3 `<script setup>` + Pinia, vitest 4 (root `tests/`, throwaway `friendtracker_test` DB), pnpm 9 monorepo. **No new dependencies.**

## Global Constraints

- Node >= 20, pnpm 9. **No new dependencies** — OpenID verify, sessions, and rate limiting are hand-rolled.
- Tests need the local compose Postgres: `sg docker -c 'docker compose -p dota2tracker up -d db'` (publishes **5474**; must not run while the prod db container is up). All `docker` commands go through `sg docker -c '...'`.
- Full test run: `pnpm test` (builds shared, then `vitest run`). Narrow run after shared-types changes: `pnpm --filter @friendtracker/shared build && pnpm exec vitest run tests/<file>.test.ts`. Type-check: `pnpm lint`.
- Route pattern: whole handler in `try/catch` → `console.error('Route error:', err)` + `{ error: 'Internal server error' }, 500`.
- Don't break graceful shutdown in `apps/api/src/index.ts`: no new module-level timers without `.unref()`; `pool.end()` stays the only pool teardown.
- The API Docker image contains only `apps/api` + `packages/shared` — API source must never import from `scripts/`.
- **Never touch `/srv/dakis` or the prod stack** (it is intentionally stopped) — prod steps are operator notes only.
- Rate limiting is active from Task 7 on: **every DB-route test request should send a unique-per-test `x-real-ip` header** in files that hit `/api/auth/*` (strict 10/min window), and rate-limit tests always inject their own clock.
- Every new test file that imports the app or db must close the pool: `afterAll(async () => { await pool.end() })` (vitest hangs otherwise).
- Test files share one `friendtracker_test` DB (seeded players `111`/`222`); use **distinct `steam_id` values per test file** to avoid unique-index collisions.
- Vue: 2-space indent, no semicolons, single quotes, theme colors are CSS vars `--color-dota-*`.
- Commit style: `db:`/`infra:`/`api:`/`web:`/`docs:` prefix, imperative, plus the `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` trailer.

**Useful constants:** steam64 = accountId + 76561197960265728. Seeded player `111` ⇔ steam64 `76561197960265839`; player `222` ⇔ `76561197960265950`; unseeded account `999` ⇔ `76561197960266727`.

---

### Task 1: Drizzle snapshot repair

Migrations 0001–0006 were hand-written; `apps/api/src/db/migrations/meta/` has only `0000_snapshot.json` + `_journal.json` (entries 0000–0006), so `drizzle-kit generate` diffs against the stale 0000 snapshot. Verified against drizzle-kit 0.28.1 internals: the diff base is simply the **alphabetically last** snapshot in `meta/`; there is no gapless-chain validation; the only rule is that no two snapshots share a `prevId`. So installing one synthetic snapshot named `0006_snapshot.json` (schema state as of migration 0006 — true by construction, `schema.ts` matches the migrated DB) fixes generation. Reconstructing 0001–0005 snapshots is unnecessary busywork.

**Files:**
- Create: `apps/api/src/db/migrations/meta/0006_snapshot.json`
- Do NOT touch: `apps/api/src/db/migrations/meta/_journal.json` (snapshots are meta-only; `migrate()` never reads them)

- [ ] **Step 1: Generate a fresh snapshot of the current schema into a throwaway dir**

```bash
cd /home/dakiman/dev/dota2tracker/apps/api
pnpm exec drizzle-kit generate --dialect postgresql --schema ./src/db/schema.ts --out ./.drizzle-tmp
```

Expected: creates `.drizzle-tmp/0000_<random_name>.sql` and `.drizzle-tmp/meta/0000_snapshot.json` (+ `_journal.json`). The SQL file is discarded; only the snapshot matters.

- [ ] **Step 2: Install it as the 0006 snapshot, chaining prevId to the existing 0000**

```bash
cp .drizzle-tmp/meta/0000_snapshot.json src/db/migrations/meta/0006_snapshot.json
```

Then edit `src/db/migrations/meta/0006_snapshot.json`: change the top-level `"prevId"` field from `"00000000-0000-0000-0000-000000000000"` to `"d4665579-fb44-48d7-931a-91a101ef753c"` (the `id` of the existing `0000_snapshot.json`). Keep the file's own random `"id"` as generated. Finally:

```bash
rm -rf .drizzle-tmp
```

- [ ] **Step 3: Acid test — generation reports a clean slate**

```bash
cd /home/dakiman/dev/dota2tracker
pnpm --filter api db:generate
```

Expected: `No schema changes, nothing to migrate 😴` and `git status -s` shows only the new `0006_snapshot.json`. **If it instead generates a migration, STOP** — the snapshot install went wrong (wrong location or the schema drifted); report instead of improvising.

*(Optional, interactive-only, skip in agent runs: with the test DB freshly migrated by `pnpm test`, `DATABASE_URL=postgresql://friendtracker:devpassword@localhost:5474/friendtracker_test pnpm --filter api exec drizzle-kit push` should report no changes — a drift check between the hand-written SQL and `schema.ts`. Never let `push` apply anything. Task 3's SQL inspection is the real guard.)*

- [ ] **Step 4: Confirm tests still pass (migrations untouched)**

Run: `pnpm test`
Expected: all existing tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/db/migrations/meta/0006_snapshot.json
git commit -m "db: repair drizzle snapshot bookkeeping (install 0006 snapshot of current schema)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Nightly pg_dump backups from the refresh container

Backups run as a `run-job.ts` job (not a bare cron shell line) so every run writes a `refresh_runs` row — a silently failing backup cron is exactly the failure mode `refresh_runs` exists to kill. `pg_dump --format=custom` gives compressed, `pg_restore`-able dumps. The postgres server is `postgres:16-alpine`, so the refresh image needs `postgresql16-client` (rule: pg_dump major ≥ server major).

**Files:**
- Create: `scripts/lib/backup-rotation.ts`
- Create: `scripts/backup-db.ts`
- Modify: `scripts/run-job.ts` (JOBS map)
- Modify: `infra/refresh/Dockerfile`
- Modify: `infra/refresh/crontab`
- Modify: `docker-compose.yml` (refresh service + volumes)
- Modify: `.env.example`
- Test: `tests/backup-rotation.test.ts`

**Interfaces:**
- Produces: `filesToDelete(names: string[], now: Date, keepDays: number): string[]` in `scripts/lib/backup-rotation.ts`; job name `backup-db` runnable via `tsx scripts/run-job.ts backup-db`; env `BACKUP_DIR` (default `/backups`), `BACKUP_KEEP_DAYS` (default `7`).

- [ ] **Step 1: Write the failing test**

Create `tests/backup-rotation.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { filesToDelete } from '../scripts/lib/backup-rotation.js'

// Nightly job runs at 04:10 UTC; filenames carry the run date.
const NOW = new Date('2026-07-05T04:10:00Z')

describe('filesToDelete', () => {
  it('deletes dumps older than keepDays and keeps recent ones', () => {
    const names = [
      'friendtracker-2026-07-05.dump',
      'friendtracker-2026-06-29.dump',
      'friendtracker-2026-06-28.dump',
      'friendtracker-2026-06-20.dump',
    ]
    expect(filesToDelete(names, NOW, 7)).toEqual([
      'friendtracker-2026-06-28.dump',
      'friendtracker-2026-06-20.dump',
    ])
  })

  it('never touches filenames that do not match the dump pattern', () => {
    const names = ['pgdata.tar', 'friendtracker-notadate.dump', 'other-2020-01-01.dump']
    expect(filesToDelete(names, NOW, 7)).toEqual([])
  })

  it('returns empty when everything is fresh', () => {
    expect(filesToDelete(['friendtracker-2026-07-04.dump'], NOW, 7)).toEqual([])
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm exec vitest run tests/backup-rotation.test.ts`
Expected: FAIL — cannot find module `../scripts/lib/backup-rotation.js`.

- [ ] **Step 3: Implement the rotation helper**

Create `scripts/lib/backup-rotation.ts`:

```ts
/** Matches friendtracker-YYYY-MM-DD.dump */
export const DUMP_RE = /^friendtracker-(\d{4}-\d{2}-\d{2})\.dump$/

const DAY_MS = 24 * 3600 * 1000

/**
 * Names of dump files older than keepDays relative to `now`. Filenames that
 * don't match DUMP_RE are never returned — foreign files are never deleted.
 */
export function filesToDelete(names: string[], now: Date, keepDays: number): string[] {
  const cutoff = now.getTime() - keepDays * DAY_MS
  return names.filter((n) => {
    const m = DUMP_RE.exec(n)
    if (!m) return false
    return new Date(`${m[1]}T00:00:00Z`).getTime() < cutoff
  })
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run tests/backup-rotation.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Implement the backup job**

Create `scripts/backup-db.ts`:

```ts
/**
 * Nightly pg_dump of DATABASE_URL to BACKUP_DIR (custom format, so
 * pg_restore can do selective restores), pruning dumps older than
 * BACKUP_KEEP_DAYS. Runs via: tsx scripts/run-job.ts backup-db
 * Requires pg_dump >= the server major (postgresql16-client in the image).
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, readdir, stat, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { filesToDelete } from './lib/backup-rotation.js'

const execFileP = promisify(execFile)

export async function run(): Promise<string> {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set')
  const dir = process.env.BACKUP_DIR ?? '/backups'
  const keepDays = Number(process.env.BACKUP_KEEP_DAYS) || 7
  const stamp = new Date().toISOString().slice(0, 10)
  const file = join(dir, `friendtracker-${stamp}.dump`)

  await mkdir(dir, { recursive: true })
  await execFileP('pg_dump', ['--format=custom', '--file', file, '--dbname', url])
  const { size } = await stat(file)
  // Sanity floor: a real dump of this DB is far larger; a truncated/empty
  // dump must fail the run so refresh_runs shows it.
  if (size < 10_000) throw new Error(`dump suspiciously small: ${size} bytes`)

  const stale = filesToDelete(await readdir(dir), new Date(), keepDays)
  await Promise.all(stale.map((f) => unlink(join(dir, f))))
  return `wrote ${file} (${size} bytes), pruned ${stale.length} old dump(s)`
}
```

Modify `scripts/run-job.ts` — add one entry to the JOBS map after `'request-parses'`:

```ts
  'backup-db': () => import('./backup-db.js'),
```

- [ ] **Step 6: Wire image, cron, compose, env**

`infra/refresh/Dockerfile` — after the `RUN corepack enable && corepack prepare pnpm@9 --activate` line, add:

```dockerfile
# pg_dump for the nightly backup-db job (server is postgres:16-alpine;
# pg_dump major must be >= server major)
RUN apk add --no-cache postgresql16-client
```

`infra/refresh/crontab` — append:

```
# Nightly DB backup to $BACKUP_DIR (custom-format dump, 7-day rotation).
10 4 * * * cd /app && ./node_modules/.bin/tsx scripts/run-job.ts backup-db > /proc/1/fd/1 2>&1
```

`docker-compose.yml` — on the `refresh` service add the env + volume, and declare the volume:

```yaml
  refresh:
    build:
      context: .
      dockerfile: infra/refresh/Dockerfile
    environment:
      DATABASE_URL: postgresql://friendtracker:${DB_PASSWORD:-devpassword}@db:5432/friendtracker
      BACKUP_DIR: /backups
    volumes:
      - backups:/backups
    depends_on:
      db:
        condition: service_healthy
    restart: unless-stopped
```

and at the bottom:

```yaml
volumes:
  pgdata:
  backups:
```

`.env.example` — append:

```
# Backup job (runs inside the refresh container)
BACKUP_DIR=/backups
BACKUP_KEEP_DAYS=7
```

- [ ] **Step 7: Verify end-to-end in the local stack**

```bash
pnpm lint && pnpm test
sg docker -c 'docker compose -p dota2tracker up -d --build refresh'
sg docker -c 'docker compose -p dota2tracker exec refresh ./node_modules/.bin/tsx scripts/run-job.ts backup-db'
sg docker -c 'docker compose -p dota2tracker exec refresh sh -c "ls -la /backups && pg_restore --list /backups/friendtracker-$(date -u +%F).dump | head -5"'
```

Expected: `[run-job] backup-db ok: wrote /backups/friendtracker-<date>.dump (<size> bytes), pruned 0 old dump(s)`; `pg_restore --list` prints a TOC (archive is valid). Confirm the `refresh_runs` row:

```bash
sg docker -c "docker compose -p dota2tracker exec db psql -U friendtracker -c \"SELECT job, ok, detail FROM refresh_runs WHERE job = 'backup-db' ORDER BY id DESC LIMIT 1\""
```

Expected: one row with `ok = t`. (Note: the refresh container's entrypoint also runs a fetch-data on start — harmless.) Afterwards you may stop the extra services: `sg docker -c 'docker compose -p dota2tracker stop refresh'` (keep `db` up for tests).

- [ ] **Step 8: Commit**

```bash
git add scripts/lib/backup-rotation.ts scripts/backup-db.ts scripts/run-job.ts infra/refresh/Dockerfile infra/refresh/crontab docker-compose.yml .env.example tests/backup-rotation.test.ts
git commit -m "infra: nightly pg_dump backup job with 7-day rotation

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: users/sessions schema via a **generated** migration

This is the real acid test for Task 1: the migration must be produced by `drizzle-kit generate`, not hand-written. Session ids are the **sha256 hex of the opaque token** — this phase starts writing DB dumps to a backup dir, and dumps must not contain live bearer tokens.

**Files:**
- Modify: `apps/api/src/db/schema.ts`
- Generated: `apps/api/src/db/migrations/0007_<random>.sql`, `meta/0007_snapshot.json`, `meta/_journal.json` (appended by drizzle-kit — do not hand-edit)
- Test: `tests/auth-schema.test.ts`

**Interfaces:**
- Produces (consumed by Tasks 5–6): tables `users` (`id serial PK`, `provider text NOT NULL DEFAULT 'steam'`, `steam_id text NOT NULL`, `player_id text NULL` FK→players ON DELETE SET NULL, `name text NOT NULL DEFAULT ''`, `avatar text NULL`, `created_at timestamptz NOT NULL DEFAULT now()`, unique `(provider, steam_id)`) and `sessions` (`id text PK`, `user_id integer NOT NULL` FK→users ON DELETE CASCADE, `created_at timestamptz NOT NULL DEFAULT now()`, `expires_at timestamptz NOT NULL`, index on `expires_at`). Drizzle objects `users`, `sessions` re-exported from `apps/api/src/db/index.js`.

- [ ] **Step 1: Write the failing test**

Create `tests/auth-schema.test.ts`:

```ts
import { describe, it, expect, afterAll } from 'vitest'
import { eq } from 'drizzle-orm'
import { db, pool, users, sessions } from '../apps/api/src/db/index.js'

afterAll(async () => {
  await pool.end()
})

describe('users/sessions schema', () => {
  it('inserts a user with defaults and links a session', async () => {
    const [user] = await db
      .insert(users)
      .values({ steamId: '76561197960265839', playerId: '111', name: 'Alice' })
      .returning()
    expect(user.provider).toBe('steam')
    expect(user.createdAt).toBeInstanceOf(Date)
    expect(user.playerId).toBe('111')

    await db.insert(sessions).values({
      id: 'a'.repeat(64),
      userId: user.id,
      expiresAt: new Date(Date.now() + 60_000),
    })
    const [session] = await db.select().from(sessions).where(eq(sessions.userId, user.id))
    expect(session.id).toBe('a'.repeat(64))
    expect(session.expiresAt).toBeInstanceOf(Date)
  })

  it('cascades sessions when the user is deleted', async () => {
    const [user] = await db
      .insert(users)
      .values({ steamId: '76561197960265950' })
      .returning()
    await db.insert(sessions).values({
      id: 'b'.repeat(64),
      userId: user.id,
      expiresAt: new Date(Date.now() + 60_000),
    })
    await db.delete(users).where(eq(users.id, user.id))
    const rows = await db.select().from(sessions).where(eq(sessions.id, 'b'.repeat(64)))
    expect(rows).toEqual([])
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm exec vitest run tests/auth-schema.test.ts`
Expected: FAIL — `users`/`sessions` are not exported from the db module.

- [ ] **Step 3: Add the tables to schema.ts**

Append to `apps/api/src/db/schema.ts` (matching the existing style — `uniqueIndex`, `index`, `timestamp(..., { withTimezone: true })` are already imported):

```ts
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
```

- [ ] **Step 4: Generate the migration and inspect it**

```bash
pnpm --filter api db:generate
```

Expected: a new `apps/api/src/db/migrations/0007_<random_name>.sql` plus `meta/0007_snapshot.json` and an appended `_journal.json` entry (idx 7). **Open the SQL and verify it contains ONLY**: two `CREATE TABLE` statements (`users`, `sessions`), the two FK constraints, `users_provider_steam_idx`, and `sessions_expires_idx`. **Any `ALTER` touching existing tables means the hand-written 0001–0006 SQL drifted from schema.ts — STOP and report; do not apply.**

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm exec vitest run tests/auth-schema.test.ts`
Expected: PASS (global-setup recreates `friendtracker_test` and `migrate()` applies 0007). Then `pnpm test` — everything green.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/db/schema.ts apps/api/src/db/migrations tests/auth-schema.test.ts
git commit -m "db: users + sessions tables (first generated migration since snapshot repair)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: OpenID 2.0 helpers (pure + mockable)

Hand-rolled Steam OpenID 2.0 in stateless mode (~100 lines, no deps). Replay protection is delegated to Steam: `check_authentication` accepts each `response_nonce` exactly once. The classic OpenID pitfall — accepting a valid signature that doesn't actually cover `claimed_id`/`return_to` — is closed by checking the `openid.signed` field list. The test seam is `OPENID_ENDPOINT`, read at **call time**, pointing verification at a local mock HTTP server.

**Files:**
- Create: `apps/api/src/auth/openid.ts`
- Test: `tests/openid.test.ts`

**Interfaces:**
- Produces (consumed by Task 6): `steam64ToAccountId(steam64: string): string`; `openidEndpoint(): string`; `buildLoginUrl(origin: string): string`; `verifyAssertion(url: URL, origin: string): Promise<string | null>` (returns steam64 or null). Constant `STEAM64_BASE = 76561197960265728n`.

- [ ] **Step 1: Write the failing test**

Create `tests/openid.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createServer, type Server } from 'node:http'
import {
  steam64ToAccountId,
  buildLoginUrl,
  verifyAssertion,
} from '../apps/api/src/auth/openid.js'

const ORIGIN = 'http://localhost:5173'
let server: Server
let isValid = true

/** A structurally valid Steam assertion query for the given steam64. */
function assertionUrl(steam64: string, overrides: Record<string, string> = {}): URL {
  const p = new URLSearchParams({
    'openid.ns': 'http://specs.openid.net/auth/2.0',
    'openid.mode': 'id_res',
    'openid.op_endpoint': 'https://steamcommunity.com/openid/login',
    'openid.claimed_id': `https://steamcommunity.com/openid/id/${steam64}`,
    'openid.identity': `https://steamcommunity.com/openid/id/${steam64}`,
    'openid.return_to': `${ORIGIN}/api/auth/steam/return`,
    'openid.response_nonce': '2026-07-05T00:00:00Zabc',
    'openid.assoc_handle': 'h1',
    'openid.signed': 'signed,op_endpoint,claimed_id,identity,return_to,response_nonce,assoc_handle',
    'openid.sig': 'ZmFrZXNpZw==',
    ...overrides,
  })
  return new URL(`${ORIGIN}/api/auth/steam/return?${p}`)
}

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      res.setHeader('content-type', 'text/plain')
      res.end(`ns:http://specs.openid.net/auth/2.0\nis_valid:${isValid}\n`)
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const addr = server.address()
  if (typeof addr === 'object' && addr) {
    process.env.OPENID_ENDPOINT = `http://127.0.0.1:${addr.port}/openid/login`
  }
})

afterAll(async () => {
  delete process.env.OPENID_ENDPOINT
  await new Promise((resolve) => server.close(resolve))
})

describe('steam64ToAccountId', () => {
  it('converts steam64 to the 32-bit account id', () => {
    expect(steam64ToAccountId('76561197960265839')).toBe('111')
  })
})

describe('buildLoginUrl', () => {
  it('points at the endpoint with realm/return_to derived from the origin', () => {
    const url = new URL(buildLoginUrl(ORIGIN))
    expect(url.searchParams.get('openid.mode')).toBe('checkid_setup')
    expect(url.searchParams.get('openid.realm')).toBe(ORIGIN)
    expect(url.searchParams.get('openid.return_to')).toBe(`${ORIGIN}/api/auth/steam/return`)
  })
})

describe('verifyAssertion', () => {
  it('returns the steam64 when Steam confirms the assertion', async () => {
    isValid = true
    await expect(verifyAssertion(assertionUrl('76561197960265839'), ORIGIN)).resolves.toBe(
      '76561197960265839'
    )
  })

  it('returns null when Steam rejects the assertion', async () => {
    isValid = false
    await expect(verifyAssertion(assertionUrl('76561197960265839'), ORIGIN)).resolves.toBeNull()
    isValid = true
  })

  it('rejects a wrong mode', async () => {
    const url = assertionUrl('76561197960265839', { 'openid.mode': 'cancel' })
    await expect(verifyAssertion(url, ORIGIN)).resolves.toBeNull()
  })

  it('rejects a non-Steam claimed_id', async () => {
    const url = assertionUrl('76561197960265839', {
      'openid.claimed_id': 'https://evil.example/openid/id/76561197960265839',
    })
    await expect(verifyAssertion(url, ORIGIN)).resolves.toBeNull()
  })

  it('rejects a tampered return_to', async () => {
    const url = assertionUrl('76561197960265839', {
      'openid.return_to': 'http://evil.example/api/auth/steam/return',
    })
    await expect(verifyAssertion(url, ORIGIN)).resolves.toBeNull()
  })

  it('rejects a signature that does not cover claimed_id', async () => {
    const url = assertionUrl('76561197960265839', {
      'openid.signed': 'signed,op_endpoint,identity,return_to,response_nonce,assoc_handle',
    })
    await expect(verifyAssertion(url, ORIGIN)).resolves.toBeNull()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm exec vitest run tests/openid.test.ts`
Expected: FAIL — cannot find module `../apps/api/src/auth/openid.js`.

- [ ] **Step 3: Implement**

Create `apps/api/src/auth/openid.ts`:

```ts
/**
 * Hand-rolled Steam OpenID 2.0 (stateless mode). Steam is the only OP.
 * Verification POSTs the assertion back to Steam (check_authentication),
 * which also enforces one-time response nonces — no local replay store.
 */
export const STEAM64_BASE = 76561197960265728n
const STEAM_OPENID = 'https://steamcommunity.com/openid/login'
const OPENID_NS = 'http://specs.openid.net/auth/2.0'

/** steam64 → 32-bit account id (= players.id). BigInt: steam64 exceeds MAX_SAFE_INTEGER. */
export function steam64ToAccountId(steam64: string): string {
  return (BigInt(steam64) - STEAM64_BASE).toString()
}

/** Where to redirect/verify. OPENID_ENDPOINT overrides for tests; read at call time. */
export function openidEndpoint(): string {
  return process.env.OPENID_ENDPOINT ?? STEAM_OPENID
}

export function buildLoginUrl(origin: string): string {
  const p = new URLSearchParams({
    'openid.ns': OPENID_NS,
    'openid.mode': 'checkid_setup',
    'openid.claimed_id': `${OPENID_NS}/identifier_select`,
    'openid.identity': `${OPENID_NS}/identifier_select`,
    'openid.return_to': `${origin}/api/auth/steam/return`,
    // The realm must be a prefix of return_to — true by construction.
    'openid.realm': origin,
  })
  return `${openidEndpoint()}?${p}`
}

/**
 * Verify the assertion Steam redirected back with. Returns the steam64 id
 * or null on any failure.
 */
export async function verifyAssertion(url: URL, origin: string): Promise<string | null> {
  const q = url.searchParams
  if (q.get('openid.mode') !== 'id_res') return null
  // Steam always echoes its real endpoint here — pinned to the literal so a
  // spoofed assertion can't point verification elsewhere.
  if (q.get('openid.op_endpoint') !== STEAM_OPENID) return null
  if (!q.get('openid.return_to')?.startsWith(`${origin}/api/auth/steam/return`)) return null
  const m = /^https:\/\/steamcommunity\.com\/openid\/id\/(\d{17})$/.exec(
    q.get('openid.claimed_id') ?? ''
  )
  if (!m) return null
  // The signature Steam validates must actually cover the fields we rely on.
  const signed = (q.get('openid.signed') ?? '').split(',')
  const required = ['claimed_id', 'return_to', 'response_nonce', 'op_endpoint']
  if (!required.every((f) => signed.includes(f))) return null

  const body = new URLSearchParams()
  for (const [k, v] of q) if (k.startsWith('openid.')) body.set(k, v)
  body.set('openid.mode', 'check_authentication')
  const res = await fetch(openidEndpoint(), {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) return null
  const text = await res.text()
  return /^is_valid\s*:\s*true\s*$/m.test(text) ? m[1] : null
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run tests/openid.test.ts`
Expected: PASS (9 tests). Also `pnpm lint`.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/auth/openid.ts tests/openid.test.ts
git commit -m "api: hand-rolled Steam OpenID 2.0 verify + steam64 conversion helpers

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Sessions — store, middleware, /api/auth/me, /api/auth/logout

Opaque 32-byte tokens in an httpOnly cookie; the DB stores only the sha256. Sliding 30-day expiry (friend-group site: re-login friction is the real cost), bumped at most once per day per session to bound writes.

**Files:**
- Create: `apps/api/src/auth/session.ts`
- Create: `apps/api/src/middleware/session.ts`
- Create: `apps/api/src/routes/auth.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `packages/shared/src/types.ts`
- Test: `tests/auth-routes.test.ts`

**Interfaces:**
- Consumes: `users`, `sessions` from Task 3.
- Produces (consumed by Tasks 6/8): shared type `AuthUser { id: number; steamId: string; playerId: string | null; name: string; avatar: string | null }`; `SESSION_COOKIE = 'session'`; `createSession(userId: number): Promise<{ token: string; expiresAt: Date }>`; `sessionUser(token: string): Promise<AuthUser | null>`; `deleteSession(token: string): Promise<void>`; `AuthEnv = { Variables: { user: AuthUser | null } }` + `sessionMiddleware` from `middleware/session.js`; routes `GET /api/auth/me` → `{ user: AuthUser | null }` (always 200) and `POST /api/auth/logout` → `{ ok: true }`.

- [ ] **Step 1: Add the shared type**

Append to `packages/shared/src/types.ts`:

```ts
/** Authenticated user as returned by GET /api/auth/me */
export interface AuthUser {
  id: number
  steamId: string
  playerId: string | null
  name: string
  avatar: string | null
}
```

Run: `pnpm --filter @friendtracker/shared build`
Expected: builds clean.

- [ ] **Step 2: Write the failing test**

Create `tests/auth-routes.test.ts` (unique `x-real-ip` per test — the strict `/api/auth/*` rate limit from Task 7 is 10/min/IP; unique `steam_id`s vs other files):

```ts
import { describe, it, expect, afterAll } from 'vitest'
import { app } from '../apps/api/src/app.js'
import { db, pool, users } from '../apps/api/src/db/index.js'
import { createSession, hashToken, sessionUser } from '../apps/api/src/auth/session.js'
import { sessions } from '../apps/api/src/db/index.js'
import { eq } from 'drizzle-orm'

afterAll(async () => {
  await pool.end()
})

async function makeUser(steamId: string) {
  const [user] = await db
    .insert(users)
    .values({ steamId, playerId: null, name: 'Session Tester', avatar: null })
    .returning()
  return user
}

describe('session middleware + /api/auth/me', () => {
  it('returns user null without a cookie', async () => {
    const res = await app.request('/api/auth/me', { headers: { 'x-real-ip': '10.5.0.1' } })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ user: null })
  })

  it('returns the user for a valid session cookie', async () => {
    const user = await makeUser('76561197960270001')
    const { token } = await createSession(user.id)
    const res = await app.request('/api/auth/me', {
      headers: { cookie: `session=${token}`, 'x-real-ip': '10.5.0.2' },
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.user).toEqual({
      id: user.id,
      steamId: '76561197960270001',
      playerId: null,
      name: 'Session Tester',
      avatar: null,
    })
  })

  it('returns user null for a garbage token', async () => {
    const res = await app.request('/api/auth/me', {
      headers: { cookie: 'session=not-a-real-token', 'x-real-ip': '10.5.0.3' },
    })
    expect((await res.json()).user).toBeNull()
  })

  it('returns user null for an expired session', async () => {
    const user = await makeUser('76561197960270002')
    const { token } = await createSession(user.id)
    await db
      .update(sessions)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(sessions.id, hashToken(token)))
    const res = await app.request('/api/auth/me', {
      headers: { cookie: `session=${token}`, 'x-real-ip': '10.5.0.4' },
    })
    expect((await res.json()).user).toBeNull()
  })

  it('stores only the token hash at rest', async () => {
    const user = await makeUser('76561197960270003')
    const { token } = await createSession(user.id)
    const rows = await db.select().from(sessions).where(eq(sessions.userId, user.id))
    expect(rows).toHaveLength(1)
    expect(rows[0].id).not.toBe(token)
    expect(rows[0].id).toBe(hashToken(token))
  })
})

describe('POST /api/auth/logout', () => {
  it('deletes the session and expires the cookie', async () => {
    const user = await makeUser('76561197960270004')
    const { token } = await createSession(user.id)
    const res = await app.request('/api/auth/logout', {
      method: 'POST',
      headers: { cookie: `session=${token}`, 'x-real-ip': '10.5.0.5' },
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(res.headers.get('set-cookie')).toContain('session=;')
    expect(await sessionUser(token)).toBeNull()
  })

  it('is a no-op without a cookie', async () => {
    const res = await app.request('/api/auth/logout', {
      method: 'POST',
      headers: { 'x-real-ip': '10.5.0.6' },
    })
    expect(res.status).toBe(200)
  })
})
```

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm exec vitest run tests/auth-routes.test.ts`
Expected: FAIL — cannot find module `../apps/api/src/auth/session.js`.

- [ ] **Step 4: Implement session store, middleware, routes, wiring**

Create `apps/api/src/auth/session.ts`:

```ts
import { createHash, randomBytes } from 'node:crypto'
import { and, eq, gt } from 'drizzle-orm'
import { db, sessions, users } from '../db/index.js'
import type { AuthUser } from '@friendtracker/shared'

export const SESSION_COOKIE = 'session'
export const SESSION_TTL_MS = 30 * 24 * 3600 * 1000
// Sliding expiry, but bump at most once per day per session to bound writes.
const BUMP_THRESHOLD_MS = SESSION_TTL_MS - 24 * 3600 * 1000

/** Sessions are stored keyed by sha256(token) — never the raw bearer token. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export async function createSession(
  userId: number
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString('base64url')
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS)
  await db.insert(sessions).values({ id: hashToken(token), userId, expiresAt })
  return { token, expiresAt }
}

export async function sessionUser(token: string): Promise<AuthUser | null> {
  const id = hashToken(token)
  const [row] = await db
    .select({
      userId: users.id,
      steamId: users.steamId,
      playerId: users.playerId,
      name: users.name,
      avatar: users.avatar,
      expiresAt: sessions.expiresAt,
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(and(eq(sessions.id, id), gt(sessions.expiresAt, new Date())))
  if (!row) return null
  if (row.expiresAt.getTime() - Date.now() < BUMP_THRESHOLD_MS) {
    await db
      .update(sessions)
      .set({ expiresAt: new Date(Date.now() + SESSION_TTL_MS) })
      .where(eq(sessions.id, id))
  }
  return {
    id: row.userId,
    steamId: row.steamId,
    playerId: row.playerId,
    name: row.name,
    avatar: row.avatar,
  }
}

export async function deleteSession(token: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, hashToken(token)))
}
```

Create `apps/api/src/middleware/session.ts`:

```ts
import { createMiddleware } from 'hono/factory'
import { getCookie } from 'hono/cookie'
import type { AuthUser } from '@friendtracker/shared'
import { SESSION_COOKIE, sessionUser } from '../auth/session.js'

export type AuthEnv = { Variables: { user: AuthUser | null } }

/** Resolves the session cookie to a user (or null). No DB hit when anonymous. */
export const sessionMiddleware = createMiddleware<AuthEnv>(async (c, next) => {
  const token = getCookie(c, SESSION_COOKIE)
  c.set('user', token ? await sessionUser(token) : null)
  await next()
})
```

Create `apps/api/src/routes/auth.ts`:

```ts
import { Hono } from 'hono'
import { deleteCookie, getCookie } from 'hono/cookie'
import type { AuthEnv } from '../middleware/session.js'
import { SESSION_COOKIE, deleteSession } from '../auth/session.js'

const auth = new Hono<AuthEnv>()

auth.get('/me', (c) => c.json({ user: c.get('user') }))

auth.post('/logout', async (c) => {
  try {
    const token = getCookie(c, SESSION_COOKIE)
    if (token) await deleteSession(token)
    deleteCookie(c, SESSION_COOKIE, { path: '/' })
    return c.json({ ok: true })
  } catch (err) {
    console.error('Route error:', err)
    return c.json({ error: 'Internal server error' }, 500)
  }
})

export default auth
```

Modify `apps/api/src/app.ts` to (first middleware in this app — keep it a visible layer):

```ts
import { Hono } from 'hono'
import config from './routes/config.js'
import meta from './routes/meta.js'
import heroes from './routes/heroes.js'
import matches from './routes/matches.js'
import together from './routes/together.js'
import auth from './routes/auth.js'
import { sessionMiddleware, type AuthEnv } from './middleware/session.js'

export const app = new Hono<AuthEnv>()

app.use('/api/*', sessionMiddleware)

app.route('/api/auth', auth)
app.route('/api/config', config)
app.route('/api/meta', meta)
app.route('/api/heroes', heroes)
app.route('/api/matches', matches)
app.route('/api/together', together)

app.get('/api/health', (c) => c.json({ ok: true }))
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @friendtracker/shared build && pnpm exec vitest run tests/auth-routes.test.ts`
Expected: PASS (7 tests). Then `pnpm test` and `pnpm lint` — all green (existing route tests unaffected: anonymous requests skip the DB entirely).

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/types.ts apps/api/src/auth/session.ts apps/api/src/middleware/session.ts apps/api/src/routes/auth.ts apps/api/src/app.ts tests/auth-routes.test.ts
git commit -m "api: session store, session middleware, /api/auth/me + logout

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Steam login/return routes + multi-origin resolution

The multi-origin problem: the site is reached via LAN IP, maybe Tailscale, later a public domain — and OpenID `realm`/`return_to` must match the browser's origin. Solution: match the request's Host header against an `ALLOWED_ORIGINS` env allowlist of **full origins**; the scheme comes from the allowlist entry, not `X-Forwarded-Proto` (survives TLS-terminating tunnels where nginx sees plain http). Unknown Host → 403 (a hostile Host header must not smuggle its own realm). Nothing is registered with Steam — realm is per-request, so all origins work simultaneously.

**Files:**
- Create: `apps/api/src/auth/origin.ts`
- Create: `apps/api/src/auth/profile.ts`
- Modify: `apps/api/src/routes/auth.ts`
- Modify: `apps/web/vite.config.ts`
- Modify: `.env.example`
- Test: extend `tests/auth-routes.test.ts`

**Interfaces:**
- Consumes: Task 4 helpers, Task 5 `createSession`/`SESSION_COOKIE`, Task 3 `users`.
- Produces: `resolveOrigin(c: Context): string | null` and `allowedOrigins(): string[]` in `auth/origin.js`; `fetchSteamProfile(accountId: string): Promise<{ name: string; avatar: string | null }>` in `auth/profile.js`; routes `GET /api/auth/steam/login` (302 to Steam) and `GET /api/auth/steam/return` (302 to `/` with session cookie). Env: `ALLOWED_ORIGINS` (default `http://localhost:5173,http://localhost:3000`), `OPENDOTA_URL` (default `https://api.opendota.com/api`).

- [ ] **Step 1: Write the failing tests**

Extend `tests/auth-routes.test.ts`. Add to the imports:

```ts
import { beforeAll } from 'vitest'
import { createServer, type Server } from 'node:http'
import { eq } from 'drizzle-orm'   // already imported in Task 5
```

Add the mock server setup (top level, alongside the existing `afterAll`) — one server plays both Steam (`POST` → key-value body) and OpenDota (`GET /players/:id` → profile JSON):

```ts
let mock: Server
let openidValid = true

beforeAll(async () => {
  mock = createServer((req, res) => {
    if (req.method === 'POST') {
      let body = ''
      req.on('data', (c) => (body += c))
      req.on('end', () => {
        res.setHeader('content-type', 'text/plain')
        res.end(`ns:http://specs.openid.net/auth/2.0\nis_valid:${openidValid}\n`)
      })
      return
    }
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ profile: { personaname: 'MockPersona', avatarfull: 'https://a.example/x.jpg' } }))
  })
  await new Promise<void>((resolve) => mock.listen(0, '127.0.0.1', resolve))
  const addr = mock.address()
  if (typeof addr === 'object' && addr) {
    process.env.OPENID_ENDPOINT = `http://127.0.0.1:${addr.port}/openid/login`
    process.env.OPENDOTA_URL = `http://127.0.0.1:${addr.port}`
  }
})
```

and extend the existing `afterAll` to also clean up:

```ts
afterAll(async () => {
  delete process.env.OPENID_ENDPOINT
  delete process.env.OPENDOTA_URL
  await new Promise((resolve) => mock.close(resolve))
  await pool.end()
})
```

Add the assertion-query helper and the new describes:

```ts
const ORIGIN = 'http://localhost:5173'

function assertionQuery(steam64: string): string {
  return new URLSearchParams({
    'openid.ns': 'http://specs.openid.net/auth/2.0',
    'openid.mode': 'id_res',
    'openid.op_endpoint': 'https://steamcommunity.com/openid/login',
    'openid.claimed_id': `https://steamcommunity.com/openid/id/${steam64}`,
    'openid.identity': `https://steamcommunity.com/openid/id/${steam64}`,
    'openid.return_to': `${ORIGIN}/api/auth/steam/return`,
    'openid.response_nonce': '2026-07-05T00:00:00Zdef',
    'openid.assoc_handle': 'h1',
    'openid.signed': 'signed,op_endpoint,claimed_id,identity,return_to,response_nonce,assoc_handle',
    'openid.sig': 'ZmFrZXNpZw==',
  }).toString()
}

describe('GET /api/auth/steam/login', () => {
  it('302s to the OpenID endpoint with realm/return_to for the allowlisted Host', async () => {
    const res = await app.request('/api/auth/steam/login', {
      headers: { host: 'localhost:5173', 'x-real-ip': '10.6.0.1' },
    })
    expect(res.status).toBe(302)
    const loc = new URL(res.headers.get('location')!)
    expect(loc.searchParams.get('openid.realm')).toBe(ORIGIN)
    expect(loc.searchParams.get('openid.return_to')).toBe(`${ORIGIN}/api/auth/steam/return`)
  })

  it('403s for a Host not in the allowlist', async () => {
    const res = await app.request('/api/auth/steam/login', {
      headers: { host: 'evil.example', 'x-real-ip': '10.6.0.2' },
    })
    expect(res.status).toBe(403)
  })
})

describe('GET /api/auth/steam/return', () => {
  it('creates a user linked to the matching players row and sets the session cookie', async () => {
    openidValid = true
    // steam64 76561197960265839 ⇔ seeded player 111
    const res = await app.request(`/api/auth/steam/return?${assertionQuery('76561197960265839')}`, {
      headers: { host: 'localhost:5173', 'x-real-ip': '10.6.0.3' },
    })
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('/')
    const setCookie = res.headers.get('set-cookie')!
    expect(setCookie).toContain('session=')
    expect(setCookie).toContain('HttpOnly')
    expect(setCookie.toLowerCase()).not.toContain('secure') // http origin

    const [user] = await db.select().from(users).where(eq(users.steamId, '76561197960265839'))
    expect(user.playerId).toBe('111')
    expect(user.name).toBe('MockPersona')

    const token = /session=([^;]+)/.exec(setCookie)![1]
    const me = await app.request('/api/auth/me', {
      headers: { cookie: `session=${token}`, 'x-real-ip': '10.6.0.3' },
    })
    expect((await me.json()).user.playerId).toBe('111')
  })

  it('upserts on repeat login (no duplicate user, fresh session)', async () => {
    openidValid = true
    await app.request(`/api/auth/steam/return?${assertionQuery('76561197960265839')}`, {
      headers: { host: 'localhost:5173', 'x-real-ip': '10.6.0.4' },
    })
    const rows = await db.select().from(users).where(eq(users.steamId, '76561197960265839'))
    expect(rows).toHaveLength(1)
  })

  it('links no player for an untracked steam64', async () => {
    openidValid = true
    // account 999 is not in players
    const res = await app.request(`/api/auth/steam/return?${assertionQuery('76561197960266727')}`, {
      headers: { host: 'localhost:5173', 'x-real-ip': '10.6.0.5' },
    })
    expect(res.status).toBe(302)
    const [user] = await db.select().from(users).where(eq(users.steamId, '76561197960266727'))
    expect(user.playerId).toBeNull()
  })

  it('403s when Steam rejects the assertion and creates no user', async () => {
    openidValid = false
    const res = await app.request(`/api/auth/steam/return?${assertionQuery('76561197960266838')}`, {
      headers: { host: 'localhost:5173', 'x-real-ip': '10.6.0.6' },
    })
    expect(res.status).toBe(403)
    const rows = await db.select().from(users).where(eq(users.steamId, '76561197960266838'))
    expect(rows).toEqual([])
    openidValid = true
  })

  it('403s for a Host not in the allowlist', async () => {
    const res = await app.request(`/api/auth/steam/return?${assertionQuery('76561197960265839')}`, {
      headers: { host: 'evil.example', 'x-real-ip': '10.6.0.7' },
    })
    expect(res.status).toBe(403)
  })
})
```

- [ ] **Step 2: Run to verify the new tests fail**

Run: `pnpm exec vitest run tests/auth-routes.test.ts`
Expected: Task 5 tests still PASS; new describes FAIL (404 — routes don't exist).

- [ ] **Step 3: Implement origin + profile + routes**

Create `apps/api/src/auth/origin.ts`:

```ts
import type { Context } from 'hono'

const DEFAULT_ORIGINS = 'http://localhost:5173,http://localhost:3000'

/** Full origins (scheme://host[:port]) allowed to initiate Steam login. */
export function allowedOrigins(): string[] {
  return (process.env.ALLOWED_ORIGINS ?? DEFAULT_ORIGINS)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

/**
 * Resolve the request's origin by matching the Host header against the
 * allowlist. The scheme comes from the allowlist entry — NOT from
 * X-Forwarded-Proto — so a TLS-terminating tunnel upstream of plain-http
 * nginx still yields the correct https realm. Unknown Host → null (403).
 */
export function resolveOrigin(c: Context): string | null {
  const host = c.req.header('host')
  if (!host) return null
  return allowedOrigins().find((o) => new URL(o).host === host) ?? null
}
```

Create `apps/api/src/auth/profile.ts` (inline, NOT imported from `scripts/` — the API image excludes it):

```ts
/** OpenDota profile lookup. Never throws — login must not depend on OpenDota. */
export async function fetchSteamProfile(
  accountId: string
): Promise<{ name: string; avatar: string | null }> {
  const base = process.env.OPENDOTA_URL ?? 'https://api.opendota.com/api'
  try {
    const res = await fetch(`${base}/players/${accountId}`, {
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) throw new Error(`OpenDota ${res.status}`)
    const data = (await res.json()) as {
      profile?: { personaname?: string; avatarfull?: string }
    }
    return {
      name: data.profile?.personaname ?? `Player ${accountId}`,
      avatar: data.profile?.avatarfull ?? null,
    }
  } catch {
    return { name: `Player ${accountId}`, avatar: null }
  }
}
```

Extend `apps/api/src/routes/auth.ts` — new imports:

```ts
import { setCookie } from 'hono/cookie'
import { eq } from 'drizzle-orm'
import { db, players, users } from '../db/index.js'
import { buildLoginUrl, steam64ToAccountId, verifyAssertion } from '../auth/openid.js'
import { createSession } from '../auth/session.js'
import { resolveOrigin } from '../auth/origin.js'
import { fetchSteamProfile } from '../auth/profile.js'
```

and the two routes (before `export default auth`):

```ts
auth.get('/steam/login', (c) => {
  const origin = resolveOrigin(c)
  if (!origin) return c.json({ error: 'Unknown origin' }, 403)
  return c.redirect(buildLoginUrl(origin), 302)
})

auth.get('/steam/return', async (c) => {
  try {
    const origin = resolveOrigin(c)
    if (!origin) return c.json({ error: 'Unknown origin' }, 403)
    const steam64 = await verifyAssertion(new URL(c.req.url), origin)
    if (!steam64) return c.json({ error: 'OpenID verification failed' }, 403)

    const accountId = steam64ToAccountId(steam64)
    const [player] = await db.select().from(players).where(eq(players.id, accountId))
    const profile = await fetchSteamProfile(accountId)
    // Upsert refreshes name/avatar/player link every login, so seeding a
    // player after their first login self-heals on the next one.
    const [user] = await db
      .insert(users)
      .values({
        steamId: steam64,
        playerId: player?.id ?? null,
        name: profile.name,
        avatar: profile.avatar,
      })
      .onConflictDoUpdate({
        target: [users.provider, users.steamId],
        set: { name: profile.name, avatar: profile.avatar, playerId: player?.id ?? null },
      })
      .returning()

    const { token, expiresAt } = await createSession(user.id)
    setCookie(c, SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'Lax',
      path: '/',
      secure: origin.startsWith('https://'),
      expires: expiresAt,
    })
    return c.redirect('/', 302)
  } catch (err) {
    console.error('Route error:', err)
    return c.json({ error: 'Internal server error' }, 500)
  }
})
```

Modify `apps/web/vite.config.ts` — the dev proxy must preserve the browser's Host so origin resolution works in dev (target is localhost, no vhosting — safe):

```ts
    proxy: {
      '/api': {
        target: process.env.VITE_API_URL ?? 'http://localhost:3000',
        changeOrigin: false,
      },
    },
```

`.env.example` — append:

```
# Auth: full origins (scheme://host[:port]) allowed to initiate Steam login,
# comma-separated. Scheme is taken from the entry (tunnel-safe).
ALLOWED_ORIGINS=http://localhost:5173,http://localhost:3000
# OpenDota base URL (tests point this at a mock)
OPENDOTA_URL=https://api.opendota.com/api
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec vitest run tests/auth-routes.test.ts`
Expected: PASS (all describes). Then `pnpm test` + `pnpm lint` — green.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/auth/origin.ts apps/api/src/auth/profile.ts apps/api/src/routes/auth.ts apps/web/vite.config.ts .env.example tests/auth-routes.test.ts
git commit -m "api: steam login/return routes with origin allowlist + OpenDota profile fetch

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Rate limiting (hand-rolled, in-memory)

Roadmap decision: rate limiting lands with auth. Hand-rolled fixed-window instead of `hono-rate-limiter`: the API is single-process and will never grow Redis, so the dep's store abstraction buys nothing — the whole requirement is ~35 lines of Map bookkeeping. Key = `X-Real-IP` (nginx sets it; see operator note about not exposing the API port directly), falling back to the socket address, then `'unknown'` (covers `app.request()` in tests). Lazy sweep instead of a timer — nothing to tear down on shutdown.

**Files:**
- Create: `apps/api/src/middleware/rate-limit.ts`
- Modify: `apps/api/src/app.ts`
- Test: `tests/rate-limit.test.ts`

**Interfaces:**
- Produces: `rateLimit(opts: { windowMs: number; max: number; now?: () => number }): MiddlewareHandler`. Wiring: `/api/auth/*` 10/min, `/api/*` 300/min (both count for auth paths; strict one wins).

- [ ] **Step 1: Write the failing test**

Create `tests/rate-limit.test.ts` (unit-level on a fresh Hono app with an injected clock, plus one integration check on the real app):

```ts
import { describe, it, expect, afterAll } from 'vitest'
import { Hono } from 'hono'
import { rateLimit } from '../apps/api/src/middleware/rate-limit.js'
import { app } from '../apps/api/src/app.js'
import { pool } from '../apps/api/src/db/index.js'

afterAll(async () => {
  await pool.end()
})

function makeApp(windowMs: number, max: number, clock: { t: number }) {
  const a = new Hono()
  a.use('*', rateLimit({ windowMs, max, now: () => clock.t }))
  a.get('/x', (c) => c.json({ ok: true }))
  return a
}

describe('rateLimit', () => {
  it('allows up to max requests then 429s with Retry-After', async () => {
    const clock = { t: 0 }
    const a = makeApp(60_000, 3, clock)
    for (let i = 0; i < 3; i++) {
      const res = await a.request('/x', { headers: { 'x-real-ip': '10.7.0.1' } })
      expect(res.status).toBe(200)
    }
    const res = await a.request('/x', { headers: { 'x-real-ip': '10.7.0.1' } })
    expect(res.status).toBe(429)
    expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0)
  })

  it('resets after the window rolls over', async () => {
    const clock = { t: 0 }
    const a = makeApp(60_000, 1, clock)
    await a.request('/x', { headers: { 'x-real-ip': '10.7.0.2' } })
    expect((await a.request('/x', { headers: { 'x-real-ip': '10.7.0.2' } })).status).toBe(429)
    clock.t = 60_001
    expect((await a.request('/x', { headers: { 'x-real-ip': '10.7.0.2' } })).status).toBe(200)
  })

  it('tracks distinct IPs independently', async () => {
    const clock = { t: 0 }
    const a = makeApp(60_000, 1, clock)
    expect((await a.request('/x', { headers: { 'x-real-ip': '10.7.0.3' } })).status).toBe(200)
    expect((await a.request('/x', { headers: { 'x-real-ip': '10.7.0.4' } })).status).toBe(200)
    expect((await a.request('/x', { headers: { 'x-real-ip': '10.7.0.3' } })).status).toBe(429)
  })
})

describe('app wiring', () => {
  it('strictly limits /api/auth/* (11th request in a minute is rejected)', async () => {
    let last = 200
    for (let i = 0; i < 11; i++) {
      const res = await app.request('/api/auth/me', { headers: { 'x-real-ip': '10.7.1.1' } })
      last = res.status
    }
    expect(last).toBe(429)
  })

  it('leaves normal reads under the global ceiling untouched', async () => {
    const res = await app.request('/api/health', { headers: { 'x-real-ip': '10.7.1.2' } })
    expect(res.status).toBe(200)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm exec vitest run tests/rate-limit.test.ts`
Expected: FAIL — cannot find module `../apps/api/src/middleware/rate-limit.js`.

- [ ] **Step 3: Implement**

Create `apps/api/src/middleware/rate-limit.ts`:

```ts
import { createMiddleware } from 'hono/factory'
import { getConnInfo } from '@hono/node-server/conninfo'

/**
 * Fixed-window in-memory rate limiter. Deliberately dependency-free: the
 * API is single-process (no Redis, ever), so a Map is the whole store.
 * Keyed by X-Real-IP (set by nginx) → socket address → 'unknown'.
 * Lazy sweep instead of a timer, so there is nothing to stop on shutdown.
 */
export function rateLimit(opts: { windowMs: number; max: number; now?: () => number }) {
  const hits = new Map<string, { count: number; resetAt: number }>()
  return createMiddleware(async (c, next) => {
    const now = (opts.now ?? Date.now)()
    let key = c.req.header('x-real-ip')
    if (!key) {
      try {
        key = getConnInfo(c).remote.address ?? 'unknown'
      } catch {
        key = 'unknown' // app.request() in tests has no socket
      }
    }
    if (hits.size > 10_000) {
      for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k)
    }
    const entry = hits.get(key)
    if (!entry || entry.resetAt <= now) {
      hits.set(key, { count: 1, resetAt: now + opts.windowMs })
    } else if (++entry.count > opts.max) {
      c.header('Retry-After', String(Math.ceil((entry.resetAt - now) / 1000)))
      return c.json({ error: 'Too many requests' }, 429)
    }
    await next()
  })
}
```

Modify `apps/api/src/app.ts` — add the import and wire both limiters **before** `sessionMiddleware`:

```ts
import { rateLimit } from './middleware/rate-limit.js'
```

```ts
app.use('/api/auth/*', rateLimit({ windowMs: 60_000, max: 10 }))
app.use('/api/*', rateLimit({ windowMs: 60_000, max: 300 }))
app.use('/api/*', sessionMiddleware)
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec vitest run tests/rate-limit.test.ts`
Expected: PASS. Then the full `pnpm test` — the auth-routes file must stay green (it sends a unique `x-real-ip` per test, so no test crosses the 10/min auth window). `pnpm lint` green.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/middleware/rate-limit.ts apps/api/src/app.ts tests/rate-limit.test.ts
git commit -m "api: in-memory fixed-window rate limiting (strict on /api/auth, global ceiling)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: Frontend — auth store + header sign-in/out

Minimal by design: a login link, "signed in as", logout. No gated features — nothing mutates yet; this proves the cookie flow end-to-end and gives 3b/3c a `user` to build on. The login link is a **plain `<a>`**, not a router link or fetch — OpenID is a top-level browser redirect.

**Files:**
- Create: `apps/web/src/stores/auth.ts`
- Modify: `apps/web/src/components/layout/NavBar.vue`
- Modify: `apps/web/src/App.vue`
- Test: `tests/auth-store.test.ts`

**Interfaces:**
- Consumes: `GET /api/auth/me` → `{ user: AuthUser | null }`, `POST /api/auth/logout` (Task 5/6); `AuthUser` from `@friendtracker/shared`; memoized-load pattern from `apps/web/src/stores/config.ts`.

- [ ] **Step 1: Write the failing test**

Create `tests/auth-store.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useAuthStore } from '../apps/web/src/stores/auth'

beforeEach(() => {
  setActivePinia(createPinia())
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const ME = { id: 1, steamId: '76561197960265839', playerId: '111', name: 'Alice', avatar: null }

describe('auth store', () => {
  it('load() populates user from /api/auth/me', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ user: ME }), { status: 200 }))
    )
    const auth = useAuthStore()
    await auth.load()
    expect(auth.user).toEqual(ME)
  })

  it('load() is memoized (one fetch for two calls)', async () => {
    const spy = vi.fn(async () => new Response(JSON.stringify({ user: null }), { status: 200 }))
    vi.stubGlobal('fetch', spy)
    const auth = useAuthStore()
    await Promise.all([auth.load(), auth.load()])
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('load() failure leaves user null', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 500 })))
    const auth = useAuthStore()
    await auth.load()
    expect(auth.user).toBeNull()
  })

  it('logout() POSTs and clears the user', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }))
    )
    const auth = useAuthStore()
    auth.user = ME
    await auth.logout()
    expect(auth.user).toBeNull()
    expect(vi.mocked(fetch).mock.calls[0][1]).toMatchObject({ method: 'POST' })
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm exec vitest run tests/auth-store.test.ts`
Expected: FAIL — cannot find module `../apps/web/src/stores/auth`.

- [ ] **Step 3: Implement store + UI**

Create `apps/web/src/stores/auth.ts`:

```ts
import { defineStore } from 'pinia'
import { ref } from 'vue'
import { useApi } from '@/composables/useApi'
import type { AuthUser } from '@friendtracker/shared'

export const useAuthStore = defineStore('auth', () => {
  const user = ref<AuthUser | null>(null)
  let loadPromise: Promise<void> | null = null

  async function load() {
    if (loadPromise) return loadPromise
    loadPromise = (async () => {
      try {
        const res = await useApi<{ user: AuthUser | null }>('/api/auth/me')
        user.value = res.user
      } catch {
        user.value = null
        loadPromise = null
      }
    })()
    return loadPromise
  }

  async function logout() {
    try {
      await fetch('/api/auth/logout', { method: 'POST' })
    } finally {
      user.value = null
      loadPromise = null
    }
  }

  return { user, load, logout }
})
```

Modify `apps/web/src/components/layout/NavBar.vue` — script gains the store:

```ts
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
```

and inside `<nav>` after `<PlayerFilterDropdown />`:

```vue
      <a
        v-if="!auth.user"
        href="/api/auth/steam/login"
        class="opacity-80 hover:opacity-100 transition text-sm"
        style="color: var(--color-dota-text);"
      >
        Sign in with Steam
      </a>
      <div v-else class="flex items-center gap-2">
        <img
          v-if="auth.user.avatar"
          :src="auth.user.avatar"
          alt=""
          class="w-6 h-6 rounded-full"
        />
        <span class="text-sm" style="color: var(--color-dota-text);">{{ auth.user.name }}</span>
        <button
          class="opacity-80 hover:opacity-100 transition text-sm cursor-pointer"
          style="color: var(--color-dota-text-dim);"
          @click="auth.logout()"
        >
          Log out
        </button>
      </div>
```

Modify `apps/web/src/App.vue` — load auth alongside config:

```ts
import { useAuthStore } from '@/stores/auth'

const config = useConfigStore()
const auth = useAuthStore()
onMounted(() => {
  config.load()
  auth.load()
})
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec vitest run tests/auth-store.test.ts`
Expected: PASS. Then `pnpm lint` (vue-tsc) and full `pnpm test` — green.

- [ ] **Step 5: Live spike — real Steam login (the roadmap's "early spike")**

```bash
pnpm dev:api    # terminal 1 (DATABASE_URL from .env, port 3000)
pnpm dev:web    # terminal 2
```

On `http://localhost:5173`: click "Sign in with Steam" → real Steam login page → redirected back signed-in (header shows persona name); reload keeps the session; "Log out" clears it. This exercises the full OpenID round-trip against the real OP — the one thing mocks can't prove. If Steam rejects the redirect, compare `openid.return_to` in the address bar against `ALLOWED_ORIGINS`.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/stores/auth.ts apps/web/src/components/layout/NavBar.vue apps/web/src/App.vue tests/auth-store.test.ts
git commit -m "web: auth store + Steam sign-in/out in the header

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: Docs + roadmap bookkeeping

**Files:**
- Modify: `CLAUDE.md`
- Modify: `ROADMAP.md`
- Modify: `DEPLOY.md`

- [ ] **Step 1: Update CLAUDE.md**

In the Database section, note that migrations are **generated again** (`pnpm --filter api db:generate` works; the snapshot repair installed `meta/0006_snapshot.json` — hand-written-migration warnings are obsolete). In Environment, add `ALLOWED_ORIGINS` (auth origin allowlist), `OPENDOTA_URL`, `BACKUP_DIR`/`BACKUP_KEEP_DAYS`. In API routes, add `GET/POST /api/auth/*` (me, logout, steam/login, steam/return).

- [ ] **Step 2: Update ROADMAP.md**

Mark the two Phase 3 prerequisites (backups, Drizzle snapshots) and **Phase 3a — ✅ DONE** with the merge date; update the status header ("Next up: Phase 3b"); move the "Drizzle snapshots out of sync" standing task to done (generation restored; hand-write convention retired).

- [ ] **Step 3: Update DEPLOY.md — operator section**

Add (operator does these by hand when next starting the stack; **agents never touch /srv/dakis**):
- refresh service: add `BACKUP_DIR=/backups` env + bind mount `/srv/dakis/data/dota2tracker-backups:/backups`; rebuild refresh.
- api service: add `ALLOWED_ORIGINS=http://192.168.100.81:8743` (append Tailscale/public origins as they exist) to the env; rebuild api/web (migration 0007 auto-applies on start).
- **Do not publish the API port publicly** — the rate limiter trusts `X-Real-IP` from nginx; direct exposure makes it spoofable.
- Tunnel cutover is NOT required for 3a (realm is per-request); when it lands, append `https://<domain>` to `ALLOWED_ORIGINS` and restart the api — the Secure cookie flag follows the allowlist entry automatically.
- Once, after the first nightly backup: restore drill `pg_restore --clean --if-exists -d <scratch-db-url> <dump>`.

- [ ] **Step 4: Verify + commit**

Run: `pnpm lint && pnpm test` one last time (full suite green), then:

```bash
git add CLAUDE.md ROADMAP.md DEPLOY.md
git commit -m "docs: phase 3 prerequisites + 3a build log, operator rollout notes

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Final verification (after all tasks)

1. `pnpm lint` and `pnpm test` — everything green.
2. `pnpm --filter api db:generate` → `No schema changes, nothing to migrate 😴`.
3. `git log --oneline -10` — one commit per task with the right prefixes.
4. Graceful-shutdown regression: `sg docker -c 'docker compose -p dota2tracker up -d --build api'`, then `time sg docker -c 'docker compose -p dota2tracker stop api'` — stops in ~1 s (no lingering timers).
5. Report: task list with pass/fail, the live-spike outcome (Task 8 Step 5), and any deviations from this plan.

## Deferred / out of scope (do not implement)

- Anything auth-*protected* (mutating endpoints, admin) — Phase 3b.
- Leagues (`?league=slug`) — Phase 3c.
- Session cleanup job for expired rows (tiny table; revisit in 3b's job runner).
- CSRF tokens — nothing mutates on behalf of a user yet; logout is the only POST and is harmless. Revisit with the first real mutation in 3b.
