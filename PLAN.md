# Dota2Tracker — Fix Plan

## Current State (verified 2026-03-23)

Stack starts and serves traffic. DB has schema applied, 2 players, 132 hero_stats rows (mostly 0-match
junk from a partial fetch run + 10 real seeded rows), and only 1 hero_builds row (Abaddon). The result:

- Meta page loads and shows ~5 heroes (only seeded ones with non-zero matches)
- Hero detail page returns 404 for every hero except Abaddon
- Role assignments for many heroes are wrong (map defaults to carry/support rotation)
- No real player data has successfully loaded from OpenDota

---

## Issues (by priority)

### 1. CRITICAL — Hero detail page 404s for all heroes except Abaddon

**Root cause:** `fetch-data.ts` populates `hero_stats` (win/loss/KDA counts) but nothing populates
`hero_builds`. The `/api/heroes/:slug` route requires a row in `hero_builds` to return anything.
There is no script to bridge the gap.

**Fix:** Create `scripts/populate-builds.ts` that reads all distinct `(hero_slug, role)` combinations
from `hero_stats`, aggregates the stats across all players, and upserts a `hero_builds` row per
combination. The `buildData` will be a minimal valid placeholder (empty skill builds, empty item lists)
since actual skill/item builds are not available from the basic OpenDota endpoints used. The
`statsData` block will be populated from real aggregated data (win rate, matches). This gets every
hero that has been played to show a detail page instead of a 404.

### 2. CRITICAL — No auto-migration; fresh deployments fail silently

**Root cause:** The API starts and crashes (or returns 500) if DB tables don't exist. Migrations
must be manually triggered via `local-deploy.sh` or a separate step. If that step is missed, nothing
works and the error is not obvious.

**Fix:** Add `migrate()` from `drizzle-orm/node-postgres/migrator` to `apps/api/src/index.ts` so
migrations run automatically on every API startup, idempotently. This is the standard Drizzle pattern
for self-hosted apps.

### 3. CRITICAL — `fetch-data.ts` inserts 0-match hero rows

**Root cause:** OpenDota's `/api/players/{id}/heroes` can return heroes with `games: 0`. The script
inserts these, polluting `hero_stats`. While the meta query filters them out with `HAVING matches > 0`,
they waste space and confuse `populate-builds.ts` which would create empty build entries for unplayed
heroes.

**Fix:** Add `if (ph.games === 0) continue` guard in the fetch loop before inserting.

### 4. SIGNIFICANT — `HERO_ROLE_MAP` is wrong for most heroes

**Root cause:** The map covers hero IDs 1–200 with a hard-coded alternating carry/support/mid/etc
pattern. Dota 2 heroes only go up to ~140 with gaps, and actual roles don't follow this pattern. The
result is that most heroes in the meta table show the wrong role and role filtering is broken.

**Fix:** Rewrite `packages/shared/src/constants.ts` with accurate hero ID → primary role mappings
derived from the actual Dota 2 hero list. The fetch script should also fetch `/api/heroes` from
OpenDota which includes a `roles` array for each hero, and use the first/primary role for the mapping.
For now, hardcode the correct mapping for all ~124 current heroes and trim the map to stop at the
last real hero ID.

### 5. SIGNIFICANT — `hero_builds` unique index broken for global (null player_id) rows

**Root cause:** The unique index `(hero_slug, role, player_id)` does not prevent duplicate global
builds because PostgreSQL treats NULL as distinct in btree indexes — two rows with the same
`(hero_slug, role, NULL)` are not considered duplicates. The seed works around this with a
`DELETE` before `INSERT`, but any `onConflictDoUpdate` call for global builds will silently
insert a duplicate instead of updating.

**Fix:** Replace the single index with two partial indexes via a new Drizzle migration:
- `UNIQUE (hero_slug, role) WHERE player_id IS NULL` — for global builds
- `UNIQUE (hero_slug, role, player_id) WHERE player_id IS NOT NULL` — for player-specific builds

Update `schema.ts` to reflect these partial indexes. The `populate-builds.ts` script should rely
on this to do clean upserts without pre-deleting.

### 6. MODERATE — `local-deploy.sh` doesn't run the full data pipeline

**Root cause:** The deploy script runs `docker compose up` and applies migrations but stops there.
Players must be seeded manually, then `fetch-data` and (once created) `populate-builds` must be
run separately. A fresh deployment leaves the app with no data.

**Fix:** Extend `local-deploy.sh` to run the full sequence after migrations:
1. `pnpm seed` — inserts configured players + Abaddon curated build
2. `pnpm fetch-data` — fetches real hero stats from OpenDota for each player
3. `pnpm populate-builds` — creates `hero_builds` for every hero found in `hero_stats`

The script should use `DATABASE_URL` pointing at the DB's host-mapped port (5474).

### 7. MODERATE — API Docker image is oversized

**Root cause:** The production Dockerfile stage does `COPY --from=builder /app .` which copies
everything: all source files, devDependencies in node_modules, test artifacts. The image is
unnecessarily large.

**Fix:** In the production stage, only copy:
- `node_modules/.pnpm/` and workspace `node_modules/` (production deps only, via `pnpm prune --prod`)
- `apps/api/dist/`
- `packages/shared/dist/`
- `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`

Run `pnpm prune --prod` at the end of the builder stage before copying.

### 8. MINOR — Stray files in repo root not gitignored

`friendtracker-dota2-stats@0.1.0` (a pnpm pack tarball) and `pnpm` (a local pnpm binary) appear
as untracked files. Add both to `.gitignore`.

### 9. MINOR — DEPLOY.md references wrong DB host port

DEPLOY.md says to connect to the server's Postgres on port **5432** for running migrations from a
dev machine, but `docker-compose.yml` maps Postgres to host port **5474**. Update the docs.

### 10. MINOR — Meta page KDA uses last 200 matches but match count is total lifetime games

`fetch-data.ts` fetches KDA from `?limit=200` most recent matches but stores it against total
`games` count from `/players/{id}/heroes`. The KDA is therefore meaningless for players with
many games. Either fetch all match KDA (expensive) or label it "last 200 matches" in the UI.
The simplest fix is to just drop the KDA aggregation from the fetch and compute it only when full
match data is available.

---

## Implementation Order

```
Step 1  Add auto-migrate to API startup                     apps/api/src/index.ts
Step 2  Fix fetch-data.ts (filter 0-match heroes)           scripts/fetch-data.ts
Step 3  Fix HERO_ROLE_MAP with accurate data                packages/shared/src/constants.ts
Step 4  Fix hero_builds unique index (new migration)        apps/api/src/db/schema.ts + migration
Step 5  Create populate-builds.ts script                    scripts/populate-builds.ts
        Add "populate-builds" script to package.json
Step 6  Extend local-deploy.sh to run full pipeline         scripts/local-deploy.sh
Step 7  Fix API Dockerfile                                  apps/api/Dockerfile
Step 8  Gitignore + DEPLOY.md fixes                         .gitignore, DEPLOY.md
```

Steps 1–6 are required for the app to be fully functional. Steps 7–8 are quality improvements.

---

## Data Flow After Fix

```
docker compose up -d --build
  └─ API auto-migrates DB on startup

pnpm seed
  └─ Inserts players (Daki, Chipe)
  └─ Inserts Abaddon curated build

pnpm fetch-data
  └─ For each player: fetches /players/{id}/heroes (skips 0-match)
  └─ Upserts hero_stats rows with real win/loss/KDA data

pnpm populate-builds
  └─ Reads hero_stats, groups by (hero_slug, role)
  └─ Aggregates matches + winRate across players
  └─ Upserts hero_builds rows with statsData + placeholder buildData

App state:
  - Meta page: shows all heroes the group has played, correct roles
  - Hero detail: loads for every played hero (shows stats, placeholder builds)
  - Abaddon detail: shows full curated skill/item build data
```

---

## What Remains Out of Scope (for later)

- **Real item/skill builds from OpenDota**: Would require fetching individual match data and
  aggregating purchases/abilities per hero. Significant scope increase. For now, hero detail pages
  show stats only, except for manually curated heroes like Abaddon.
- **Scheduled data refresh**: Automating `fetch-data` + `populate-builds` on a cron inside the
  container. Can be done with a simple cron job or a scheduler in the API once core flow works.
- **Player profile images**: OpenDota's `/players/{id}` returns avatar URLs. The fetch script
  could update `players.avatar` while fetching.
