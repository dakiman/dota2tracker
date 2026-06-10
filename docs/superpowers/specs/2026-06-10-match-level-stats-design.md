# Match-level stats + slim API image — design

**Date:** 2026-06-10
**Status:** Approved
**Scope:** Fixes the flagged data-accuracy issues (K/D/A sample mismatch, static hero roles) by
moving to per-match storage, and shrinks the API Docker image. Test runner explicitly deferred.

## Problem

1. `fetch-data` stores lifetime `matches`/`wins` from `/players/:id/heroes` but sums
   kills/deaths/assists from only the last 200 matches — raw K/D/A totals on the hero page are
   not from the same sample as the match counts.
2. Hero roles come from a static `HERO_ROLE_MAP` (one primary role per hero), so role filtering
   reflects an assumption, not what was actually played.
3. The API Docker image's final stage copies the entire builder workspace: sources,
   devDependencies (typescript, drizzle-kit, tsx), and scripts.

Issues 1 and 2 share a root cause — aggregates are stored instead of the matches they derive
from — so both are fixed by one schema change.

## Decisions (made with owner)

- Per-match role breakdown: one player+hero can appear under multiple roles.
- Full lifetime history per player, synced idempotently.
- Turbo/non-significant matches excluded (OpenDota's default "significant" filter).
- `hero_stats` is dropped, not kept as a cache; routes aggregate matches directly.
- Docker fix uses a fresh `--prod` install in the final stage.
- No test runner in this round.

## Schema (one new Drizzle migration)

### New table `player_matches` — source of truth

| column      | type                       | notes                                   |
|-------------|----------------------------|-----------------------------------------|
| player_id   | text FK players.id cascade | composite PK with match_id              |
| match_id    | bigint                     |                                          |
| hero_id     | integer not null           | index                                    |
| won         | boolean not null           | `(player_slot < 128) === radiant_win`    |
| kills/deaths/assists | integer not null default 0 |                                |
| duration    | integer not null           | seconds                                  |
| start_time  | timestamp not null         |                                          |
| lane_role   | smallint nullable          | null until OpenDota parses the match     |
| is_roaming  | boolean nullable           |                                          |
| role        | text not null ($type Role) | derived at ingest (see below)            |

### New table `heroes` — lookup

`hero_id` (int PK), `name` (localized, e.g. "Anti-Mage"), `slug` (e.g. `antimage`).
Refreshed from OpenDota `/heroes` at the start of every `fetch-data` run. Replaces the
name/slug denormalized onto `hero_stats` rows today.

### Dropped: `hero_stats`

Fully regenerable from OpenDota; the migration drops it outright. No data migration.

## Role derivation

New pure function in `packages/shared`:

```
deriveRole(laneRole: number | null, isRoaming: boolean | null, heroId: number): Role
```

- `isRoaming` → `support`
- lane 2 → `mid`
- lane 1 → `hard_support` if the hero's static role is support-flavored, else `carry`
- lane 3 or 4 → `support` if support-flavored, else `offlane`
- `laneRole` null (unparsed match) → `getHeroRole(heroId)` fallback

"Support-flavored" = `getHeroRole(heroId)` returns `support` or `hard_support`.
`HERO_ROLE_MAP` is demoted from source of truth to classifier + fallback. The derived role is
stored on the row so all queries are a plain `GROUP BY role`.

## fetch-data rewrite

1. Fetch `/heroes`, upsert the `heroes` table.
2. Per player, one call:
   `/players/{id}/matches?project=hero_id,kills,deaths,assists,duration,player_slot,radiant_win,lane_role,is_roaming,start_time`
   (no `limit`; no `significant` param so OpenDota's default significant-only filter applies).
3. Upsert each row with `ON CONFLICT (player_id, match_id) DO UPDATE` setting all non-key
   columns — matches get parsed after first sight, so re-runs pick up `lane_role` and upgrade
   the derived role.
4. `/players/:id/heroes` is no longer called.

Full-list refetch every run (one call per player) instead of cursor-based incremental sync:
idempotent, no state, trivially re-runnable.

## Other scripts

- **seed.ts**: players + curated Abaddon `hero_builds` row only. The fake sample `hero_stats`
  block is deleted (real data is one `fetch-data` away).
- **populate-builds.ts**: input aggregation switches from `hero_stats` to
  `player_matches` grouped by `(hero_id, role)`, joined to `heroes` for slug/name.
- **fetch-player-builds.ts**: the per-player hero list (and its `matches >= 3` threshold)
  comes from a `player_matches` aggregate instead of `hero_stats`. Downstream logic unchanged.

## API routes

- **GET /api/meta**: aggregate `player_matches` joined to `heroes`, `GROUP BY hero_id, role`
  (plus optional player/role filters as today). Response shape unchanged. A hero can now appear
  once per role actually played. K/D/A, matches, and wins all derive from the same rows.
- **GET /api/heroes/:slug**: resolve slug → `hero_id` via `heroes`, aggregate
  `player_matches` for the stats-override block. Role tabs still come from `hero_builds`.
- **Frontend**: no changes. `HeroTable` rows are already keyed `heroId + role`.
- **README**: delete the K/D/A-mismatch and static-roles entries from Known limitations.

## API Dockerfile (final stage)

Builder stage unchanged except the `scripts/` copy is removed (scripts run from the host).
Final stage:

1. Copy `pnpm-workspace.yaml`, root + api + web + shared `package.json`s, lockfile.
2. `pnpm install --prod --frozen-lockfile` (drops typescript/drizzle-kit/tsx/etc.).
3. Copy from builder: `packages/shared/dist`, `apps/api/dist`, `apps/api/src/db/migrations`.
4. `WORKDIR /app/apps/api`, `CMD ["node", "dist/index.js"]` as today (migrator resolves
   `src/db/migrations` relative to cwd).

## Rollout

1. Rebuild/redeploy API — startup auto-migration creates `player_matches` + `heroes`, drops
   `hero_stats`. Meta page is empty until backfill; nothing errors.
2. `pnpm fetch-data` — one-time lifetime backfill (1 call per player + 1 for heroes).
3. `pnpm populate-builds` — refresh global build rows from the new aggregates.

Risk is low: every dropped byte is re-fetchable from OpenDota.

## Out of scope

- Test runner / CI (deferred by owner to save scope).
- Accounts, friends, leagues (next phase; this design feeds it — leagues become filters over
  `player_matches`).
- Per-position accuracy beyond the lane heuristic (OpenDota has no true position data).
