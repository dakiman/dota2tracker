# Phase 3b — Pipeline-as-service + self-service players — Design

**Date:** 2026-07-05
**Status:** Approved by dakiman (interactive brainstorm; every decision below was
settled by explicit choice, none is an open assumption)
**Scope:** Pipeline-as-library refactor (`packages/db` + `packages/pipeline`), minimal
DB-backed job runner with an in-process poller as the single executor for pipeline
jobs, cron container demoted to enqueuer, `POST /api/players` with OpenDota
validation, admin refresh trigger — the first auth-protected mutations, so this phase
also introduces the authorization model and CSRF protection deferred by 3a.

## Goals

1. **Pipeline as a library** — the API can invoke fetches in-process. (Today the API
   Docker image excludes `scripts/`, so it *cannot* call them — that constraint forces
   the package split.)
2. **Minimal job runner** — a `jobs` table + in-process poller in the API. Explicitly
   **no Redis, ever** — single-process API, serial execution.
3. **Self-service onboarding** — `POST /api/players`: a signed-in user adds their own
   account; validation against OpenDota distinguishes "doesn't exist" from "exists but
   no public match data" (Chipe/78589430's case) and the UI teaches the fix.
4. **Admin "refresh now"** — enqueue the standard refresh trio on demand.
5. Kept in scope by explicit decision: a **`refresh-profiles`** job (daily player
   name/avatar re-sync) and a **widened `request-parses` window** (~last 30 days,
   raised cap — the honest form of "parse backfill" given Valve replay expiry).

## Non-goals (explicit decisions)

- **Player removal** — no `DELETE /api/players/:id`; mistaken adds are fixed via SQL
  (`player_matches` cascades). Deciding what deletion means for linked `users` rows is
  3c-adjacent.
- **Jobs admin UI** — no list/retry/cancel screens. Admin surface is the refresh
  button + the existing `lastRefreshed` footer; debugging happens via SQL on
  `jobs`/`refresh_runs`.
- **Per-player re-sync endpoint** — unnecessary: `fetch-data` syncs *all* players, so
  a private-then-public account self-heals on the next 6 h cron or admin refresh.
- **True historical parse sweep** — months-old replays are expired; requests would be
  wasted calls. The 30-day `request-parses` window covers everything realistically
  parseable.
- **Profile-URL / vanity-name input** — admin add accepts numeric account ID or
  steam64 only (vanity resolution needs a Steam API key).
- **Leagues** — Phase 3c.
- **No new runtime dependencies.** Queue, poller, CSRF, and authz are all hand-rolled
  on what's already installed.

## Decisions (with rationale)

| Question | Decision |
|---|---|
| Who may mutate? | **Split:** any signed-in user may add *their own* account (ownership proven by Steam login); adding arbitrary players and refresh-now require admin. Bounded abuse surface once the Cloudflare tunnel makes the site public — a random Steam user can only add themselves. |
| Admin bootstrap | **`ADMIN_STEAM_IDS` env var** (comma-separated steam64s). `isAdmin` computed at request time in `sessionUser()`, exposed on `AuthUser`. No migration, survives DB wipes, revocable by env edit + restart. Same shape as `ALLOWED_ORIGINS`. |
| CSRF | **Origin-check middleware** on mutating methods under `/api/*`, reusing `allowedOrigins()`; missing Origin rejects. Defense-in-depth over the existing `SameSite=Lax` cookie. (`hono/csrf` rejected: it deliberately skips JSON requests, adding ~nothing here.) |
| Queue vs `refresh_runs` | **Separate `jobs` queue table** feeding the existing `refresh_runs` log. Queue state is mutable and prunable; the run log stays append-only; `lastRefreshed` on `/api/config` keeps working untouched. |
| Poller vs cron container | **Cron becomes an enqueuer.** Crontab lines insert job rows via a tiny CLI; the API poller is the single executor for all pipeline jobs — one execution path, zero cross-container races. `backup-db` is the exception and stays a direct run in the refresh container (pg_dump binary + backups volume live only there). Entrypoint self-heal-on-start becomes enqueue-on-start. |
| Seed / re-add | **Seed stays** as the dev/test bootstrap. Re-adding an existing player → **409, no side effects.** (Combined with the all-players fetch, Chipe's "I flipped the setting" retry needs no endpoint — data self-heals within 6 h.) |
| Private account on add | **Blocked** with an instructive message (422). Account must be public before it can be added; doesn't-exist is a distinct 404. |
| Rate limits | **Reuse the strict 10/min/IP tier** (same limiter as `/api/auth/*`) on the new mutating endpoints. Each add costs ~2 OpenDota calls; 10/min caps burn at ~20 calls/min/IP against the 2 000/day quota. |
| Package split | **`packages/db` + `packages/pipeline`.** Schema/client/migrations must move down a layer: `api → pipeline → api` would be a circular workspace dependency, and injecting the db handle still requires the table objects, reinventing the package with worse typing. |

## Architecture

### Workspace layout (after)

```
packages/shared      types, constants (unchanged; AuthUser gains isAdmin)
packages/db          schema.ts, pg pool + drizzle instance, migrations/, drizzle config
packages/pipeline    jobs: fetch-data, populate-builds, fetch-hero-builds,
                     fetch-player-builds, request-parses, fetch-player (new),
                     refresh-profiles (new) + lib/opendota, lib/aggregators
                     + the job registry (type → run fn)
apps/api             routes, middleware, poller  → depends on db, pipeline, shared
apps/web             unchanged structure
scripts/             thin CLIs only: run-job.ts (manual runs + backup-db),
                     enqueue-job.ts (new), seed.ts; backup-db.ts + lib/backup-rotation
                     stay here (pg_dump exists only in the refresh image)
```

- `packages/db` is `apps/api/src/db/` moved verbatim (schema, client, migrations,
  drizzle-kit config). `db:generate`/`db:migrate`/`db:studio` become
  `pnpm --filter db ...`; the API keeps calling `migrate()` at boot, pointed at the
  package's migrations dir. CLAUDE.md command docs update accordingly.
- `packages/pipeline` keeps the `export async function run(): Promise<string>`
  convention. `fetch-player` is the per-player loop extracted from `fetch-data`
  (payload `{ playerId }`); `fetch-data` calls the same helper for all players.
  `refresh-profiles` updates `players.name`/`avatar` from OpenDota `/players/{id}`
  (daily, ~1 call/player). `request-parses` widens to matches from the last ~30 days
  with a raised per-run cap.
- The **job registry** lives in the pipeline package and is shared by the poller and
  `run-job.ts` (which adds `backup-db` on top for the refresh container).
- Docker: no structural change. The API image's `--filter api...` build already pulls
  workspace deps, so db + pipeline ride along; the refresh image builds the workspace
  as today — only its crontab and entrypoint lines change.

### Data flow (after)

1. **Cron (refresh container)** enqueues instead of executing: every 6 h
   `enqueue-job fetch-data populate-builds request-parses`; daily
   `enqueue-job fetch-hero-builds fetch-player-builds refresh-profiles`; entrypoint
   enqueues the 6 h trio on start (self-heal). `backup-db` at 04:10 stays
   `run-job.ts backup-db` (direct).
2. **API poller** claims the oldest pending job, executes it in-process, brackets it
   with a `refresh_runs` row exactly as `run-job.ts` does — footer/`lastRefreshed`
   semantics unchanged.
3. **`POST /api/players`** validates → inserts → enqueues `fetch-player`.
   **`POST /api/admin/refresh`** enqueues the 6 h trio.
4. Serial, id-ordered execution means enqueue order **is** pipeline order:
   fetch-data → populate-builds → request-parses.
5. Manual dev runs (`pnpm fetch-data`) remain direct calls via `run-job.ts`.

## Jobs table & poller

### Schema (generated migration — next number in sequence)

```
jobs
  id           serial PK                    -- claim order = id order
  type         text NOT NULL                -- registry key
  payload      jsonb NULL                   -- e.g. {"playerId": "78589430"}
  status       text NOT NULL DEFAULT 'pending'   -- pending|running|done|failed
  error        text NULL
  created_at   timestamptz NOT NULL DEFAULT now()
  started_at   timestamptz NULL
  finished_at  timestamptz NULL

  UNIQUE (type, coalesce(payload->>'playerId', '')) WHERE status = 'pending'
```

The partial unique index is the dedup mechanism; enqueue is
`INSERT ... ON CONFLICT DO NOTHING`. Cron re-enqueueing over a backlog is a silent
no-op; refresh-now spam cannot stack jobs. Only *pending* rows dedup — a running
fetch-data plus a fresh pending one is allowed and harmless (idempotent upserts).
Note: if drizzle-kit cannot express the `coalesce(...)` expression index, the
generated migration is hand-adjusted for that index only (still committed via the
normal generate flow — inspect the SQL as usual).

### Poller (apps/api, started from `index.ts` bootstrap)

- `setInterval(tick, ~5 s)` with **`.unref()`** (graceful-shutdown constraint —
  no lingering timers).
- A tick **drains serially**: claim → execute → repeat until no pending rows; an
  in-flight flag makes overlapping ticks no-op. The drain loop is exported as
  `runPendingJobs()` so tests call it directly — no timers in tests.
- **Claim:** `UPDATE jobs SET status='running', started_at=now() WHERE id =
  (SELECT id FROM jobs WHERE status='pending' ORDER BY id LIMIT 1
  FOR UPDATE SKIP LOCKED) RETURNING *`. Single process makes this trivially safe;
  SKIP LOCKED is free insurance.
- **Execution:** look up `type` in the registry; unknown type → `failed` with error.
  Wrap the run with the `refresh_runs` bracket (insert started row → run → update
  `ok`/`detail`). Success → `done`; throw → `failed` + `error` recorded in both
  tables.
- **No retries.** The 6 h cron re-enqueues the same job types — that *is* the retry.
- **Crash recovery:** on boot, before the poller starts:
  `UPDATE jobs SET status='pending', started_at=NULL WHERE status='running'` —
  with a single executor, any `running` row at boot is an orphan from a killed
  process, and all jobs are idempotent upserts, so re-running is safe.
- **Graceful shutdown:** SIGTERM → `clearInterval`, race the in-flight job against a
  ~5 s grace, then `pool.end()`. Long jobs (`fetch-hero-builds` runs minutes) are
  deliberately *not* awaited — Docker SIGKILLs at 10 s anyway; the orphaned `running`
  row is re-pended by boot recovery. Fast container stops (Phase 2 requirement)
  preserved.
- **Housekeeping:** once at boot, delete `done`/`failed` rows with
  `finished_at < now() - interval '30 days'`. `refresh_runs` is the permanent
  history; queue rows are disposable.

### enqueue-job CLI (`scripts/enqueue-job.ts`)

`tsx scripts/enqueue-job.ts <type> [<type> ...]` — validates each name against the
registry, inserts rows in argument order (honoring dedup), prints what was enqueued
vs skipped. Used by the refresh container's crontab and entrypoint.

## API surface

### Authz plumbing

- `AuthUser` gains `isAdmin: boolean`. Computed in `sessionUser()`:
  `ADMIN_STEAM_IDS` (comma-separated steam64s, parsed like `ALLOWED_ORIGINS`)
  contains the user's `steamId`. No schema change.
- `middleware/`: `requireAuth` (anonymous → 401) and `requireAdmin` (anonymous → 401,
  non-admin → 403).

### CSRF middleware (`middleware/csrf.ts`)

Applied to `/api/*` for POST/PUT/PATCH/DELETE: reject **403** unless the `Origin`
header matches `allowedOrigins()`; **missing Origin also rejects** (all modern
browsers send it on POST). Layered over the existing `SameSite=Lax` cookie.
Consequence: existing `POST /api/auth/logout` tests must start sending an `Origin`
header.

### `POST /api/players` — requireAuth + strict 10/min limiter

Body: `{ accountId?: string }`.

- **Self-add:** body omitted, or `accountId` equal to the session's own account —
  account derived from `user.steamId` (ownership proven by Steam login).
- **Admin add:** any other `accountId` → `requireAdmin`.
- **Normalization:** bare account ID or steam64 (≥ `STEAM64_BASE` → subtract);
  non-numeric → **400**.
- **Validation** (2 OpenDota calls, empirically verified 2026-07-05):
  - `GET /players/{id}` returns `{"error":"Not Found"}` → account doesn't exist →
    **404** `{ error: 'account_not_found' }`.
  - `profile` present but `GET /players/{id}/matches` → `[]` → exists with no public
    match data → **422** `{ error: 'no_public_data', name, avatar }` (blocked; the
    name/avatar from the profile lets the UI say *whose* account it recognized).
    Caveat accepted: a brand-new account with zero significant matches looks
    identical — the UI copy covers both.
    (Note: `fh_unavailable` is **not** a discriminator — it is `true` for fully
    public accounts too.)
  - Otherwise valid → insert `players` row (`name` = `personaname`, `avatar` =
    `avatarfull`); **self-add also sets `users.playerId`** (mirrors the login
    upsert, so `/api/auth/me` reflects the link immediately); enqueue `fetch-player`
    with `{ playerId }` → **201** `{ player }`.
- Player already exists → **409** `{ error: 'already_tracked' }`, no side effects.
- OpenDota unreachable / 5xx (as opposed to a definitive Not Found) → **503**
  `{ error: 'opendota_unavailable' }` — validation is the gate, so it fails closed
  but distinguishably.

### `POST /api/admin/refresh` — requireAdmin + strict limiter

Enqueues fetch-data → populate-builds → request-parses (dedup makes it idempotent).
**202** `{ queued: true }` if anything was inserted; **200** `{ queued: false }` when
all three were already pending.

### Error convention

House style everywhere: whole handler in try/catch →
`console.error('Route error:', err)` + `{ error: 'Internal server error' }, 500`.

## Frontend

Deliberately small; no new pages.

- Auth store picks up `isAdmin` from `/api/auth/me`; `useApi` gains a `post()`
  helper (JSON body; browser sends `Origin` automatically on same-origin POST).
- **"Track my account"** button — shown when signed in and `user.playerId === null`,
  next to the header sign-in control. Outcomes:
  - 201 → "Added — your stats appear after the first sync."
  - 422 → instructive dialog: "Found **{name}** — but their match data isn't public.
    In Dota: Settings → Options → Social → **Expose Public Match Data**, then try
    again." (Exactly Chipe's onboarding.)
  - 409 → "Already tracked."
- **Admin controls** — rendered only when `isAdmin` (server enforces regardless):
  account-ID input + Add (same endpoint with `accountId`; adds the 404 "no such
  account" and 400 "invalid ID" states) and a **Refresh now** button
  (202 → "Refresh queued", 200 → "Already queued").
- New players appear in the player filter via the next `/api/config` fetch — no
  store changes.

## Testing

Root `tests/` conventions carry over: `friendtracker_test` DB on 5474, unique
`x-real-ip` per test (strict limiter), unique `steam_id`s per file,
`afterAll(() => pool.end())`, OpenDota/Steam mocked via the `OPENDOTA_URL` /
`OPENID_ENDPOINT` env seams.

- `jobs-queue.test.ts` — enqueue + dedup (double-enqueue no-ops; distinct
  `playerId` payloads coexist), claim order = id order, boot recovery re-pends
  `running` rows, 30-day prune.
- `poller.test.ts` — drives `runPendingJobs()` directly with a stub registry entry:
  success → `done` + ok `refresh_runs` row; throwing job → `failed` + error in both
  tables; drain processes multiple jobs in order; unknown type → `failed`. No timers.
- `players-route.test.ts` — mock OpenDota server: self-add 201 + `users.playerId`
  linked + `fetch-player` job row exists; private → 422 with name; not-found → 404;
  non-numeric → 400; duplicate → 409; anonymous → 401; non-admin adding another
  account → 403; admin add → 201; OpenDota down → 503.
- `csrf.test.ts` — POST without Origin → 403; disallowed Origin → 403; allowlisted
  Origin passes; GET unaffected. Existing logout tests updated to send Origin.
- `admin-refresh.test.ts` — 401 anonymous, 403 non-admin, 202 enqueues trio,
  repeat → 200 `{ queued: false }`.
- The package refactor is validated by the existing suite passing with rewritten
  imports + `pnpm lint` across the new packages.

## Rollout (operator notes — never touch `/srv/dakis` from agents)

- `.env.example` gains `ADMIN_STEAM_IDS=` (dakiman's steam64).
- DEPLOY.md 3b note: set `ADMIN_STEAM_IDS` on the API service; rebuild **api** and
  **refresh** images (new crontab/entrypoint); dev `pnpm fetch-data` still works as a
  direct run.
- Local verification mirrors the 3a pattern: compose db on 5474, dev API with
  `PORT` override, spike the add-player flow against real OpenDota once.

## Constraints carried over

- No new runtime dependencies. pnpm 9 monorepo, Node ≥ 20.
- All docker via `sg docker -c '...'`; tests against `friendtracker_test` on 5474.
- Hono route error convention (try/catch → 500).
- No module-level timers without `.unref()`; `pool.end()` stays the only pool
  teardown.
- API source never imports from `scripts/` (image excludes it) — that's what
  `packages/pipeline` exists to fix.
- Never touch `/srv/dakis` or the prod stack.
