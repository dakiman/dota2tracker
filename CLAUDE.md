# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

FriendTracker is a Dota 2 stats site for tracking a friend group's performance. It's a pnpm monorepo:

- `apps/api` — Hono + Drizzle ORM API server (Node.js, port 3000)
- `apps/web` — Vue 3 + Vite + Tailwind CSS frontend (port 5173 in dev)
- `packages/shared` — shared TypeScript types, constants, and image URL helpers
- `packages/db` — Drizzle schema, pg client, migrations
- `packages/pipeline` — OpenDota fetch jobs, job registry, queue runner

## Commands

### Development
```bash
pnpm install                    # install all deps
docker compose up -d db         # start only postgres
pnpm --filter api db:migrate    # run DB migrations
pnpm seed                       # seed players + curated Abaddon build
pnpm dev:api                    # start API (tsx watch)
pnpm dev:web                    # start Vite dev server
```

### Data
```bash
pnpm fetch-data                 # fetch live stats from OpenDota API (requires players in DB)
```

In production the pipeline is scheduled but **enqueued, not run directly**: the
`dota2tracker-refresh` container *enqueues* jobs (`scripts/enqueue-job.ts`) — the 6 h
trio (`fetch-data`+`populate-builds`+`request-parses`) and the daily build fetchers +
`refresh-profiles` — into the `jobs` table, and the API's in-process poller (5 s tick,
serial drain) executes them, logging to `refresh_runs` (surfaced as `lastRefreshed` on
`/api/config`). `backup-db` stays a direct cron run (pg_dump lives only in the refresh
image). Manual `pnpm fetch-data` etc. still run jobs directly via `scripts/run-job.ts`.

### Build & Lint
```bash
pnpm build                      # build all packages
pnpm lint                       # type-check all packages (no test runner)
pnpm --filter api lint          # type-check API only
pnpm --filter web lint          # type-check web only
```

### Database
```bash
pnpm --filter @friendtracker/db db:generate   # generate new migration from schema changes
pnpm --filter @friendtracker/db db:migrate    # apply migrations
pnpm --filter @friendtracker/db db:studio     # open Drizzle Studio
```

Schema + migrations live in `packages/db` (`schema.ts`, `migrations/`).
Migrations are **generated again** — `db:generate` works (`meta/0006_snapshot.json`
captures the schema as of migration 0006, so drizzle-kit diffs against the real state).
Add tables to `schema.ts`, run `db:generate`, and commit the generated `0007+_*.sql` +
`meta/` snapshot. The old "hand-write migrations, snapshots are out of sync" warning is
obsolete.

### Docker
```bash
docker compose up --build       # full stack (api + web + postgres)
```

## Environment

Copy `.env.example` to `.env`. Key variables:
- `DATABASE_URL` — postgres connection string
- `PORT` — API port (default 3000)
- `VITE_API_URL` — used by Vite proxy; in dev defaults to `http://localhost:3000`
- `SITE_NAME` — optional, controls the site title returned by `/api/config`
- `ALLOWED_ORIGINS` — comma-separated full origins (`scheme://host[:port]`) allowed to
  initiate Steam login; the scheme comes from the entry (tunnel-safe). Default
  `http://localhost:5173,http://localhost:3000`. An unknown `Host` → 403 on auth routes.
- `OPENDOTA_URL` — OpenDota base URL for the login profile fetch and pipeline jobs (default
  `https://api.opendota.com/api`; tests point it at a mock)
- `ADMIN_STEAM_IDS` — comma-separated steam64 ids granted admin (add arbitrary players,
  trigger refreshes); default empty (nobody is admin)
- `OPENDOTA_RATE_MS` — inter-call delay for OpenDota jobs (default `1100`; tests set `0`)
- `BACKUP_DIR` / `BACKUP_KEEP_DAYS` — nightly `pg_dump` job output dir (default `/backups`)
  and rotation window (default `7`); used inside the refresh container

## Architecture

### Data flow
1. **Seed** (`scripts/seed.ts`) inserts players and a curated Abaddon build into postgres.
2. **Fetch** (`packages/pipeline/src/jobs/fetch-data.ts`) syncs the `heroes` lookup and each
   player's full significant-match history from OpenDota into `player_matches` (role derived per match).
3. **API** serves aggregated stats; frontend never calls OpenDota directly.

### Database schema (Drizzle, `packages/db/src/schema.ts`)
- `players` — tracked Steam players (id = Steam account ID string)
- `player_matches` — one row per player per significant match (won, K/D/A, duration, lane data,
  derived role); PK `(player_id, match_id)`; source of truth for all stats
- `heroes` — OpenDota hero lookup (`id`, `name`, `slug`), refreshed by fetch-data
- `hero_builds` — curated build data (items, skills, talents); unique on `(hero_slug, role, player_id)`; `player_id` can be NULL for global/default builds
- `users` — authenticated site users (Steam OpenID); unique on `(provider, steam_id)`; optional FK to `players` (steam64→account-id link)
- `sessions` — session rows keyed by the **sha256 hex of the opaque cookie token** (never the raw token); FK→users ON DELETE CASCADE; sliding 30-day expiry
- `jobs` — job queue drained serially by the API poller (partial-unique pending-dedup index on `(type, payload->>playerId)`); queue state only, history lives in `refresh_runs`

### API routes (`apps/api/src/routes/`)
- `GET /api/config` — returns player list and site name
- `GET /api/meta?players=id1,id2&role=carry` — aggregated hero stats for meta page
- `GET /api/heroes/:heroSlug?players=id1,id2` — hero detail with build data; merges player-specific stats if `players` provided
- `GET /api/auth/me` — current user (`{ user: AuthUser | null }`, always 200)
- `POST /api/auth/logout` — clears the session + cookie
- `GET /api/auth/steam/login` — 302 to Steam OpenID (realm/return_to per request origin)
- `GET /api/auth/steam/return` — verifies the OpenID assertion, upserts the user, sets the session cookie
- `POST /api/players` — signed-in self-add (own account) / admin add (any account), OpenDota-validated; enqueues `fetch-player`
- `POST /api/admin/refresh` — admin only; enqueues the 6 h refresh trio (idempotent via pending dedup)
- `GET /api/health` — health check

Auth is hand-rolled (no deps) in `apps/api/src/auth/` (openid, session, origin, profile,
admin) + `middleware/` (session, rate-limit, csrf, authz). Rate limits: `/api/auth/*`,
`/api/players`, `/api/admin/*` 10/min/IP; `/api/*` 300/min/IP (keyed by `X-Real-IP` from
nginx). Mutations are live as of Phase 3b: admins come from `ADMIN_STEAM_IDS`
(comma-separated steam64s; `AuthUser.isAdmin` computed per request); `requireAuth`/
`requireAdmin` guard the routes; CSRF is an Origin-allowlist middleware on mutating
methods (POST/PUT/PATCH/DELETE) layered over the SameSite=Lax session cookie.

### Frontend (`apps/web/src/`)
- **Router**: `HomePage` → `MetaPage` → `HeroDetailPage` (via `/hero/:slug`)
- **State**: `stores/playerFilter.ts` (Pinia) holds selected player IDs; persisted across navigation
- **API calls**: all via `composables/useApi.ts`, which prepends `VITE_API_URL` or falls back to `window.location.origin` (for production where API and web are co-served)
- **Images**: hero/ability/item images are fetched from Cloudflare Steam CDN via helpers in `packages/shared/src/constants.ts`

### Vite dev proxy
In dev, Vite proxies `/api/*` to `localhost:3000`, so the web app doesn't need CORS config.

### Shared package
`@friendtracker/shared` exports:
- All TypeScript interfaces (`HeroStat`, `HeroBuild`, `BuildData`, etc.)
- Image URL helpers (`heroImageUrl`, `itemImageUrl`, `abilityImageUrl`)
- `heroNameToSlug` — converts `npc_dota_hero_*` names to slugs
- `HERO_ROLE_MAP` / `getHeroRole` — static hero ID → primary role mapping

### Adding a new hero build
Insert a row into `hero_builds` with `playerId = null` (global build) or a specific player ID. The `buildData` column is JSONB typed as `BuildData` and `statsData` as `StatsData` — see `packages/shared/src/types.ts` for the full shape.


### Hosting
Production runs on dakis-server-v2 from `/srv/dakis/apps/dota2tracker/compose.yml`, which builds
images directly from this repo (`~/dev/dota2tracker`). To pick up code changes:
`cd /srv/dakis && sg docker -c 'docker compose up -d --build dota2tracker-api dota2tracker-web'`.
Web is on LAN port 8743, Postgres on 5474. See DEPLOY.md for the data pipeline.