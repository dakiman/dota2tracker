# FriendTracker — Codebase Review

*Reviewed 2026-07-02, full repo at commit `4242c4f`. All packages type-check clean (`pnpm lint` passes).*

Overall: the codebase is in good shape for its size — clear monorepo layout, `player_matches` as a single source of truth, parameterized queries throughout, input validation on both API routes, and honest docs (README "Known limitations" matches reality). The findings below are ordered by how much they matter in practice.

---

## 1. Bugs

### 1.1 Invalid `players` param silently returns data for *all* players
`apps/api/src/routes/meta.ts:18-26` and `apps/api/src/routes/heroes.ts:16-20`

```ts
const playerIds = playersParam?.split(',').map(...).filter((id) => /^\d+$/.test(id)).slice(0, 50) ?? null
...
if (playerIds?.length) { conditions.push(inArray(...)) }
```

If the caller sends `?players=abc` (or any value where every ID fails the digit regex), `playerIds` becomes `[]`, the length check is falsy, and the filter is dropped entirely — the response contains stats for **everyone** instead of no one. A malformed filter should 400 (or return an empty set), not widen the query. Fix: after parsing, if `playersParam` was provided but `playerIds.length === 0`, return `400`.

### 1.2 Player filter is lost on hero-page refresh / deep link
`apps/web/src/components/meta/HeroTable.vue:72` + `apps/web/src/stores/playerFilter.ts:30-42`

`RouterLink :to="`/hero/${h.heroSlug}`"` drops the current `?players=` query. The Pinia store keeps the selection in memory, so in-session navigation works — but the URL on the hero page no longer carries the filter. Refreshing (or sharing the link) resets the filter to "All players", silently changing every number on the page. Fix: carry the query through the link (`:to="{ path: `/hero/${h.heroSlug}`, query: $route.query }"`) or sync the query in a global `router.afterEach`.

### 1.3 Hero detail 404s for heroes that have matches but no `hero_builds` row
`apps/api/src/routes/heroes.ts:38-40`

The meta table is built straight from `player_matches`, so every hero anyone has played gets a row and a link. But `GET /api/heroes/:slug` returns 404 when `hero_builds` has no row for the slug — which is the state for any newly-played hero until `populate-builds` is re-run. The user clicks a hero in the table and lands on "Hero not found" even though the DB has full match stats for it. Fix: fall back to serving the `player_matches` aggregate (with empty build data) when no build row exists; only 404 when the slug isn't in `heroes` at all.

### 1.4 Seed clobbers live Abaddon stats, contradicting DEPLOY.md
`scripts/seed.ts:117-136` vs `DEPLOY.md:29`

DEPLOY.md says `pnpm seed` is "insert-only, won't clobber", but seed.ts **deletes and re-inserts** the global Abaddon offlane row, resetting `totalMatches`/`winRate` to the fake 1500 / 53.5% and wiping anything `populate-builds` wrote to that row. Running the documented refresh pipeline in order (`seed` → … → `populate-builds`) hides this, but running `seed` alone after the pipeline regresses the data. Either make seed skip when a row exists, or fix the doc. (Related known issue: the curated build's fake "offlane · 1500 games" role tab renders next to real data on the hero page.)

### 1.5 `fetch-data.ts` dies on OpenDota rate limiting
`scripts/fetch-data.ts:20-24` vs `scripts/fetch-player-builds.ts:32-45`

`fetch-player-builds.ts` has proper 429 retry-after handling; `fetch-data.ts` and `fetch-hero-builds.ts` throw on any non-OK response and abort the whole run. The scripts are idempotent so a re-run recovers, but a single 429 mid-run wastes everything before it. Extract the retrying `fetchJson` into a shared helper used by all three scripts.

---

## 2. Data-consistency issues (one page, three sources of truth)

The hero detail page mixes numbers from different pipelines, and they visibly disagree:

- **Header total matches / WR** — live aggregate over `player_matches` (all roles combined), `heroes.ts:98-121`.
- **Role tab chips** — `hero_builds.totalMatches/winRate`, which is whatever the last `populate-builds` / `fetch-player-builds` run wrote (stale between runs; only ~20 parsed matches for player builds; fake numbers for the curated seed row).
- **Build content** — "first row with content" (`heroes.ts:43-50`), which can belong to *any role and any selected player*; the page never tells the user whose build or which role they're looking at.

Additionally the role-tab chips don't respect the player filter consistently: with players selected, a player-specific row wins per role, but roles where the player has no build row silently fall back to global numbers (`heroes.ts:54-62`).

Suggestions:
- Compute role tabs from `player_matches` (`GROUP BY role`) like the header, so all headline numbers share one source and honor the player filter. `hero_builds` should only supply build *content*.
- Label the displayed build (role + player) in the UI, and make the role tabs actually switch builds — right now they're static chips, which reads as broken UI.

Related nit: `HeroDetailPage.vue:207-209` derives wins/losses by rounding `totalMatches * winRate / 100`, which can be off by one. The API already computes `wins` exactly — return it in the payload instead of reconstructing it.

---

## 3. API design & robustness

- **Wide-open CORS** (`apps/api/src/index.ts:12`): `cors()` with no options allows every origin. Harmless while the API is read-only and LAN-only, but it must be locked down before the planned accounts/leagues phase adds cookies or tokens. Since nginx already proxies `/api/` same-origin, you likely don't need CORS at all in production.
- **`limit(500)` can silently truncate** (`meta.ts:50`): hero×role combinations can theoretically reach ~630 (126 heroes × 5 roles). Ordered by match count desc, so only rare rows drop — but if you ever notice missing heroes, this is why. Also: the meta `pickRate` denominator counts each player-match row, so a match with two tracked friends counts twice; worth a comment (or just drop the field — see §5).
- **404 vs 500 conflated in the client** (`HeroDetailPage.vue:217-228`): every error — timeout, 500, network — renders "Hero not found". `useApi` already knows the status; attach it to the thrown error and show a different message for non-404s.
- **Dead defensive parsing** (`heroes.ts:43-77`): the `typeof x === 'string' ? JSON.parse(x) : x` dance is unnecessary — Drizzle always returns `jsonb` columns as objects. Same pattern in `fetch-hero-builds.ts:156`. Removing it deletes ~20 lines and two dead catch blocks.
- **No graceful shutdown** (`index.ts`): a SIGTERM handler that closes the server and calls `pool.end()` would make container stops clean instead of relying on the kill timeout.
- **`timestamp` without timezone** (`schema.ts:74`): `start_time` is `timestamp` (no tz). node-postgres serializes Dates in server-local time, so results shift if the API container's TZ ever differs from the writer's. `timestamp with time zone` is the safe default for instants.

## 4. Scripts / data pipeline

- **Hero sync is 126 sequential round trips** (`fetch-data.ts:74-80`): one upsert per hero. A single multi-row `insert ... onConflictDoUpdate` does it in one query. Same N+1 pattern in `populate-builds.ts:42-82` (select-then-insert/update per hero+role — a single upsert per row, or one batched upsert, would halve the queries).
- **`populate-builds` never prunes**: rows for hero+role combos that no longer exist in `player_matches` (e.g. after role-derivation changes) linger with stale counts and keep feeding the hero page's role tabs.
- **`fetch-player-builds` keys builds by static role** (`fetch-player-builds.ts:579`): `getHeroRole(heroId)` ignores which role the player actually played (which `player_matches.role` knows). A player's mid-lane Abaddon builds get stored under "support", and the unique index means one row absorbs all roles.
- **Talent left/right ordering is trusted blindly** (`fetch-player-builds.ts:354-374`): `names[0]/names[1]` from OpenDota's `hero_abilities` constants are assumed to be left/right. Worth spot-checking one hero against the in-game tree — if the convention is reversed, every talent tree renders mirrored and the "picked" highlight lands on the wrong side.
- **Pipeline ordering is convention-only**: `fetch-data` → `populate-builds` → `fetch-*-builds` must run in order (heroes.ts 404s depend on it, §1.3). A single `pnpm refresh` script chaining them would remove the footgun; long-term, a cron container on the server would keep stats fresh without manual runs.

## 5. Dead code / dead features

- **`SITE_NAME` / `AppConfig.siteName` is never rendered.** The API returns it (`config.ts:10`), but `NavBar.vue:12`, `HomePage.vue:8`, and `index.html:7` all hardcode "FriendTracker". Either wire it up or delete the env var and field.
- **`HeroStat.pickRate` and `HeroStat.playerId`** (`packages/shared/src/types.ts:28-30`) are computed/declared but never used by the frontend.
- **`@shared/*` path alias** in `tsconfig.base.json` is referenced nowhere.
- **`SkillBuildCard` titles lie** (`HeroDetailPage.vue:176`): `i === 0 ? 'Most Popular' : 'Highest Win Rate'` — the aggregator only ever produces one build, and if it ever produced three, two would claim "Highest Win Rate".

## 6. Docker / infra

- **No `.dockerignore` — add one.** Both Dockerfiles `COPY apps/... packages/...` from an unfiltered context, so the host's `node_modules` (with symlinks into the pnpm store that don't exist in the image), `dist`, and any local `.env` files are shipped to the daemon on every build and can land in layers. `node_modules`, `dist`, `.git`, `.env*`, `*.log` at minimum.
- **API runtime image installs the web app's prod deps** (`apps/api/Dockerfile:21-23`): `pnpm install --prod` at the workspace root installs *every* importer's dependencies — vue, vue-router, and pinia end up inside the API image. `pnpm install --prod --frozen-lockfile --filter api...` (or `pnpm deploy --filter api`) keeps the recent slimming work honest and shaves the image further.
- **nginx serves everything uncompressed** (`apps/web/nginx.conf`): no `gzip on`. The Vue bundle is a few hundred KB; enabling gzip for JS/CSS/JSON (and it applies to proxied `/api/` responses too) is a one-stanza win. While there, `add_header X-Content-Type-Options nosniff;` costs nothing.
- **Local compose lacks an API healthcheck** (`docker-compose.yml:35-42`): `web` depends on `api` with no condition, so nginx can start proxying before the API finished migrations. The `resolver`+variable trick in nginx.conf means nginx *starts* fine, so this only shows up as first-request 502s — low stakes, but a `wget /api/health` healthcheck + `condition: service_healthy` fixes it.

## 7. Frontend polish (low priority)

- `PlayerFilterDropdown.vue` has no keyboard support (no Escape-to-close, no focus trap) and the click-outside handler is document-wide; the sort headers in `HeroTable.vue` are `<th @click>` rather than buttons — invisible to keyboard users. Fine for a friends-only site, cheap to fix.
- `heroCropUrl`/`itemImageUrl` images have no error fallback — a renamed hero slug on Steam's CDN shows a broken-image icon. A tiny `@error` handler swapping in a placeholder would cover it.
- `playerFilter.ts:41` uses `{ deep: true }` on a watch whose array is always replaced immutably — the flag is unnecessary.
- The store's `selectAll`/`clear`/`resetFilter` are three names for the same function (`playerFilter.ts:49-51`); keep one.

## 8. Testing

`export default app` in `apps/api/src/index.ts` means Hono routes are already testable with `app.request()` without a running server — but migrations/serve run at import time, which blocks that. Split app construction (`app.ts`) from bootstrap (`index.ts`), then a handful of vitest route tests against a throwaway Postgres (or even just unit tests for `deriveRole` and the two scripts' aggregation functions, which are pure) would catch most regressions. `deriveRole`, `aggregateItemBuild`, `aggregateSkillBuild`, and `buildDurationStats` are the highest-value pure targets. This matters more once the accounts/leagues work starts touching auth.

## 9. Forward-looking (accounts / friends / leagues roadmap)

Things that are fine today but will bite the planned transformation:

- **Auth boundary**: wide-open CORS (§3), no rate limiting, and error handlers that `console.error` full errors are all fine read-only, none are fine with accounts. Budget for CORS lockdown + a rate limiter (hono has middleware) + session handling in the same change.
- **`players.id` as text Steam ID works well** for the league model — leagues as "a named set of player IDs filtered over `player_matches`" needs no schema surgery, as intended.
- **The `players` query param model** (comma-separated IDs, capped at 50) maps cleanly onto "league = server-side named player set"; migrating the filter store from raw IDs to a league ID later will be mostly frontend work.
- **Data freshness** is the real product gap: everything is manual-run scripts. A scheduled fetch (cron container or systemd timer hitting the pipeline) is probably worth doing before accounts, since stale data undermines the site for any user who isn't the person running `pnpm fetch-data`.

---

## Quick-win checklist

*All 10 implemented in commit on `main` (2026-07-02). Verified end-to-end: `pnpm lint` + web build pass; API routes exercised against a throwaway Postgres.*

| # | Fix | Effort | Status |
|---|-----|--------|--------|
| 1 | 400 on all-invalid `players` param (meta + heroes routes) | tiny | ✅ done |
| 2 | Carry `?players=` query into hero links | tiny | ✅ done |
| 3 | Hero detail: fall back to `player_matches` stats when no build row | small | ✅ done |
| 4 | Make seed idempotent (or fix DEPLOY.md claim) | tiny | ✅ done — seed now insert-only, so DEPLOY.md's claim is true |
| 5 | Shared `fetchJson` with 429 retry across all scripts | small | ✅ done — extracted to `scripts/lib/opendota.ts` |
| 6 | Add `.dockerignore` | tiny | ✅ done |
| 7 | `--filter api...` on the prod-deps install in the API image | tiny | ✅ done |
| 8 | `gzip on` in nginx.conf | tiny | ✅ done (+ `X-Content-Type-Options: nosniff`) |
| 9 | Delete dead siteName/pickRate/playerId or wire them up | tiny | ✅ done — `siteName` wired up via new `stores/config.ts`; `pickRate`/`playerId` deleted |
| 10 | Role tabs from `player_matches`, label the shown build | medium | ✅ done — role tabs now aggregate from matches; build labeled with role + player. (Tabs still don't *switch* builds — see §2, deferred) |

## Progress notes

**Done** (quick-win pass, `main` @ 2026-07-02): §1.1, §1.2, §1.3, §1.4, §1.5, plus the role-tabs-from-`player_matches` and build-labeling parts of §2, the `pickRate` drop from §3, the dead-code cleanup in §5 (siteName wired up, pickRate/playerId deleted), and all of §6 (.dockerignore, gzip, `--filter api...`).

**Done** (second pass, `main` @ 2026-07-02) — §2, §4, §5:
- §2 — role tabs are now clickable and switch the displayed build (payload returns `builds[]` per role; a ● marks roles that have a build; empty-state shown for roles without one). API returns exact `wins`; client no longer rounds `totalMatches * winRate`.
- §4 — `fetch-data` hero sync and `populate-builds` are single batched upserts (no more N+1); `populate-builds` prunes stale empty global rows while preserving curated builds; `fetch-player-builds` keys builds by the player's actual dominant role (`mode()`), not static `getHeroRole`; added `pnpm refresh` chaining the pipeline in order. Talent L/R ordering left as-is with a documented assumption in `fetch-player-builds.ts` — still needs a one-hero manual spot-check against the in-game tree (no ground truth to verify from code).
- §5 — deleted the unused `@shared/*` path alias; `SkillBuildCard` no longer claims "Highest Win Rate" (only one build is ever produced, so the title is a single honest "Most Popular").
- Verified: `pnpm lint` (+ scripts `tsc`) passes; batched upsert / prune / `mode()` / new route payload exercised against a throwaway Postgres (curated Abaddon build preserved through both upsert and prune; exact wins, per-role builds, and the §1.3 no-build-row fallback all confirmed).

**Still open** (deferred):
- §3 — CORS lockdown, `limit(500)` comment, 404-vs-500 client handling, remove dead JSON.parse dance (partly gone from `heroes.ts`), graceful shutdown, `timestamptz`.
- §4 — talent L/R in-game spot-check (see above).
- §7, §8, §9 — frontend a11y polish, tests, accounts/leagues forward-looking work.
