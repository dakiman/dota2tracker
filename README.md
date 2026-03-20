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

Then open `http://localhost` in your browser.

## GitHub and deployment

- **[GITHUB.md](./GITHUB.md)** – initialize Git, create the GitHub repo, and push.
- **[DEPLOY.md](./DEPLOY.md)** – clone on a home server, Docker Compose, env, migrations, and updates (use as Cursor context next to an SSH terminal).

