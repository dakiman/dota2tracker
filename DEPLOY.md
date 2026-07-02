# Deploy FriendTracker

Production runs on **dakis-server-v2** under the `/srv/dakis` convention:

- Source repo: `~/dev/dota2tracker` (this repo)
- Deployment dir: `/srv/dakis/apps/dota2tracker/` — holds only `compose.yml`, which builds the
  images straight from `~/dev/dota2tracker`
- Secrets: `/srv/dakis/secrets/dota2tracker.env` (`DATABASE_URL`, `POSTGRES_PASSWORD`)
- Data: `/srv/dakis/data/dota2tracker-pg/` (bind mount)
- Published ports: **8743** (web, proxies `/api/` to the API container) · **5474** (Postgres)

## Redeploy after code changes

```bash
cd /srv/dakis
sg docker -c 'docker compose up -d --build dota2tracker-api dota2tracker-web'
```

The API runs Drizzle migrations automatically on startup, so no manual migration step is needed.

Health check: `curl -s http://localhost:8743/api/health`

## Data pipeline (run after first deploy or to refresh stats)

**Refresh is scheduled** — the `dota2tracker-refresh` container syncs matches every
6 h and rebuilds hero/player builds daily (see `infra/refresh/crontab`), logging every
run to the `refresh_runs` table. The manual commands below still work for one-off
runs and initial seeding.

From the repo root, with `DATABASE_URL` pointing at the published Postgres port:

```bash
export DATABASE_URL='postgresql://friendtracker:<password>@localhost:5474/friendtracker'
pnpm seed                 # players + curated Abaddon build (insert-only, won't clobber)
pnpm fetch-data           # full per-player match history from OpenDota
pnpm populate-builds      # global hero_builds rows from aggregated stats
pnpm fetch-hero-builds    # global item builds / duration stats from OpenDota
pnpm fetch-player-builds  # per-player builds from parsed match details (slow)
```

## Local / dev stack

`docker-compose.yml` in this repo runs the same stack locally (web on 8743, Postgres on 5474):

```bash
docker compose up -d --build      # full stack
docker compose up -d db           # just Postgres for pnpm dev:api / dev:web
```

`scripts/local-deploy.sh` does full stack + the seed/fetch/populate pipeline in one go.
