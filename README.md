# FriendTracker – DOTA 2 Stats

FriendTracker is a small DOTA 2 stats site for tracking your stack's performance, powered by a Vue 3 frontend, a Hono API, and a PostgreSQL database populated from the OpenDota API.

## Monorepo layout

- `apps/api` – Hono + Drizzle API server
- `apps/web` – Vue 3 + Vite frontend
- `packages/shared` – shared TypeScript types and constants
- `scripts` – data fetch and seed scripts

## Getting started (local)

1. Install pnpm if needed: `npm install -g pnpm`
2. Install dependencies: `pnpm install`
3. Copy `.env.example` to `.env` and adjust as needed.
4. Start PostgreSQL: `docker compose up -d db`
5. Run migrations: `pnpm --filter api db:migrate`
6. Seed the database: `pnpm seed`
7. Start API and web:
   - `pnpm dev:api` (or `pnpm --filter api dev`)
   - `pnpm dev:web` (or `pnpm --filter web dev`)
8. Open http://localhost:5173 (Vite). Use the player filter and Meta / hero links.

## Docker

To run the full stack via Docker Compose (API + Web + PostgreSQL), use:

```bash
docker compose up --build
```

Then open `http://localhost:8743` in your browser.

## Deployment

See **[DEPLOY.md](./DEPLOY.md)** – production layout on dakis-server-v2, redeploy steps, and the data pipeline.

## Known limitations

- **K/D/A sample mismatch**: `fetch-data` stores lifetime `matches`/`wins` from OpenDota but sums
  kills/deaths/assists from only the last 200 matches, so raw K/D/A totals on the hero page are
  not lifetime numbers (the KDA ratio is still representative of recent play).
- **Roles are static**: each hero gets one primary role from `HERO_ROLE_MAP`, not the role
  actually played in a given match.
- **API Docker image is oversized**: the production stage copies the whole builder workspace
  (sources + devDependencies) instead of pruned production deps.
- **No test runner**: `pnpm lint` type-checks all packages, but there are no unit/integration tests.
