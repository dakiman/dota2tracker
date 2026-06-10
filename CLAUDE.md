# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

FriendTracker is a Dota 2 stats site for tracking a friend group's performance. It's a pnpm monorepo with three packages:

- `apps/api` — Hono + Drizzle ORM API server (Node.js, port 3000)
- `apps/web` — Vue 3 + Vite + Tailwind CSS frontend (port 5173 in dev)
- `packages/shared` — shared TypeScript types, constants, and image URL helpers

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

### Build & Lint
```bash
pnpm build                      # build all packages
pnpm lint                       # type-check all packages (no test runner)
pnpm --filter api lint          # type-check API only
pnpm --filter web lint          # type-check web only
```

### Database
```bash
pnpm --filter api db:generate   # generate new migration from schema changes
pnpm --filter api db:migrate    # apply migrations
pnpm --filter api db:studio     # open Drizzle Studio
```

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

## Architecture

### Data flow
1. **Seed** (`scripts/seed.ts`) inserts players and a curated Abaddon build into postgres.
2. **Fetch** (`scripts/fetch-data.ts`) syncs the `heroes` lookup and each player's full
   significant-match history from OpenDota into `player_matches` (role derived per match).
3. **API** serves aggregated stats; frontend never calls OpenDota directly.

### Database schema (Drizzle, `apps/api/src/db/schema.ts`)
- `players` — tracked Steam players (id = Steam account ID string)
- `player_matches` — one row per player per significant match (won, K/D/A, duration, lane data,
  derived role); PK `(player_id, match_id)`; source of truth for all stats
- `heroes` — OpenDota hero lookup (`id`, `name`, `slug`), refreshed by fetch-data
- `hero_builds` — curated build data (items, skills, talents); unique on `(hero_slug, role, player_id)`; `player_id` can be NULL for global/default builds

### API routes (`apps/api/src/routes/`)
- `GET /api/config` — returns player list and site name
- `GET /api/meta?players=id1,id2&role=carry` — aggregated hero stats for meta page
- `GET /api/heroes/:heroSlug?players=id1,id2` — hero detail with build data; merges player-specific stats if `players` provided
- `GET /api/health` — health check

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