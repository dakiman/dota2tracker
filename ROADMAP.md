# FriendTracker — Roadmap

*Consolidated 2026-07-02 (commit `4bcee3f`). Reviewed and updated in place by Fable
2026-07-02; detailed implementation plan (per-phase work items, feasibility, estimates)
in `docs/superpowers/plans/2026-07-02-roadmap-implementation-plan.md`.*

**Status 2026-07-02 (post-implementation):** Phases 1 and 2 are **implemented and merged
to main** (`5403587`) via the executable plans in `docs/superpowers/plans/` (both plan docs
have their checkboxes ticked and double as build logs). **Next up: Phase 2.5.** The only
Phase 1/2 remainder is the operator prod rollout — see the note in Phase 1 below.

This is the single source of truth for **where the product is going**. Architecture and
commands live in `CLAUDE.md`; the code review itself (with per-finding detail) is in
`fable-review.md`.

**Fable review verdict:** phasing is sound — Phase 1 before Phase 2 stands (disjoint
code surfaces, freshness is pure leverage). Changes made in this pass: **Friends cut
from Phase 3** (a league *is* a friend group; user↔user edges pay off only with social
features nothing here needs); **Phase 2.5 added** (cheap read-only product wins on
existing data — the old plan jumped from plumbing to platform with no user value in
between); refresh **observability** and a **parse-request job** added to Phase 1;
**backups** and the **Cloudflare tunnel cutover** surfaced as Phase 3 prerequisites;
stale `pickRate` note dropped from Phase 4. Open questions at the bottom are now
answered.

---

## Where we are today

FriendTracker is a read-only Dota 2 stats site for a fixed friend group. `player_matches`
(one row per player per significant match, role derived per match) is the single source of
truth for all stats. There is **no auth** — the `players` table is hand-seeded and there's
no rate limiting or session handling (CORS middleware is gone; the API is same-origin
behind nginx/Vite proxies). Data refresh is **automated**: a `refresh` sidecar container
runs the pipeline on a cron (6 h match sync, daily build fetch), every job logs to
`refresh_runs`, and the web footer shows data age. Manual runs still work
(`pnpm fetch-data` etc., all routed through `scripts/run-job.ts`).

Ops reality: the prod stack on `/srv/dakis` is **intentionally kept stopped** and started
on demand — treat "prod is down" as normal, never as an incident. The refresh container's
entrypoint runs a full refresh on start, so each prod start self-heals freshness.

Dev environment on this host: the repo's compose Postgres runs as project `dota2tracker`
(`sg docker -c 'docker compose -p dota2tracker up -d db'` → container `dota2tracker-db-1`,
volume `dota2tracker_pgdata`, published on **5474**). It's fully migrated (0000–0005,
drizzle bookkeeping in place) and seeded with real data (~7 k matches, 3 players).
**It shares port 5474 with the prod db container** — stop one before starting the other.
Ports 3000 (jira-rag) and 8743/5474 (prod, when up) are owned by other services; the dev
API honors `PORT` for verification runs.

### Recently completed — do not re-propose
- **Match-level-stats refactor** (2026-06-10): `player_matches` became source of truth,
  `hero_stats` removed, API image slimmed.
- **Fable review pass 1** (quick-wins): 400 on all-invalid `players` param, carry
  `?players=` into hero links, hero-detail falls back to `player_matches` when no build
  row, seed made insert-only, shared `fetchJson` with 429 retry, `.dockerignore`,
  API image `--filter api...`, nginx gzip + `nosniff`, `siteName` wired up, dead
  `pickRate`/`playerId` removed, role tabs sourced from `player_matches`.
- **Fable review pass 2** (§2/§4/§5): role tabs now switch the displayed build (per-role
  `builds[]`), exact `wins` returned by the API, `fetch-data`/`populate-builds` batched
  (no more N+1), `populate-builds` prunes stale empty rows (curated builds spared),
  `fetch-player-builds` keys builds by the player's real dominant role, `pnpm refresh`
  added, dead `@shared/*` alias removed, `SkillBuildCard` title lie fixed.
- **Phase 1 — Data freshness** (2026-07-02, merged in `b3d62ab`…`85bf0fc`): `refresh_runs`
  job-log table (migration 0004), scripts converted to `export async function run()` +
  `scripts/run-job.ts` wrapper, `request-parses` job, `lastRefreshed` on `/api/config` +
  data-age footer, `infra/refresh/` cron container wired into `docker-compose.yml`.
- **Phase 2 — Hardening** (2026-07-02, merged in `c63a42f`…`5403587`): `app.ts`/`index.ts`
  split, vitest (24 tests: pure aggregators lifted to `scripts/lib/`, route tests via
  `app.request()` against a throwaway `friendtracker_test` DB), CORS middleware removed,
  graceful shutdown (SIGTERM → `server.close()` + `pool.end()`, container stops in <1 s),
  `timestamptz` migration (0005) applied.

---

## Phase 1 — Data freshness — ✅ DONE 2026-07-02

All items below shipped (see the ticked plan doc for the build log). **Remaining: operator
prod rollout only** (Phase 1 plan, Task 7 steps 3–6): add the `refresh` service to the prod
compose in `/srv/dakis/apps/dota2tracker/`, rebuild api/web from this repo, verify the
data-age footer on :8743, commit `/srv/dakis`. dakiman does this by hand when he next
starts the stack — agents should not touch `/srv/dakis` for this.

- **Refresh container** — `dota2tracker-refresh` service in the prod compose (built from
  this repo: workspace + `tsx` + supercronic or a sleep loop), per the `/srv/dakis`
  per-app container convention. Preferred over a host systemd timer, which would couple
  prod freshness to the host's node/pnpm setup.
- **Cadence** (fits OpenDota free tier, 2 000 calls/day, with ~4× headroom):
  `fetch-data` + `populate-builds` every **6 h** (~10 calls/run);
  `fetch-hero-builds` + `fetch-player-builds` **daily**, off-peak (~300–500 calls).
  Scripts are already idempotent and 429-tolerant.
- **Observability** *(added — a silently failing cron is worse than a manual script)* —
  `refresh_runs` table written by each job; `lastRefreshed` exposed on `/api/config`;
  "data updated X ago" in the web footer.
- **Parse-request job** *(added — attacks the ~4% parsed-coverage gap below)* — after
  each `fetch-data`, `POST /request/{match_id}` to OpenDota for the group's recent
  unparsed matches (capped per run); subsequent runs pick up the lane data.
- **Pipeline-as-library seed** *(added — pays off in Phase 3b)* — while touching the
  scripts, restructure each as `export async function run()` with a thin CLI `main()`,
  so the API can later invoke fetches without shelling out.

## Phase 2 — Hardening — ✅ DONE 2026-07-02

All items below shipped except rate limiting, which stays deferred to Phase 3a as decided.
`pnpm test` is now a real gate (vitest, needs the local compose Postgres; uses a throwaway
`friendtracker_test` DB).

- **Split `app.ts` (construction) from `index.ts` (bootstrap)** — today migrations +
  serve run at import time (`index.ts:20-32`), which blocks testing routes with
  `app.request()`.
- **Test runner** — vitest: unit tests for the pure aggregators (`deriveRole`,
  `aggregateItemBuild`, `aggregateSkillBuild`, duration stats — export them from
  `fetch-player-builds.ts` or lift into `scripts/lib/`), route tests via
  `app.request()` against the local compose Postgres (`TEST_DATABASE_URL` + throwaway
  database; no testcontainers).
- **CORS: drop entirely** — nginx proxies `/api/` same-origin in prod, Vite proxies in
  dev; remove `app.use(cors())` rather than configuring it.
- **Graceful shutdown** — SIGTERM handler → `server.close()` + `pool.end()`.
- **`timestamptz`** — `player_matches.start_time` and `hero_builds.last_updated` via
  `ALTER ... USING <col> AT TIME ZONE 'UTC'` (both written from UTC containers, safe).
- **Rate limiting: deferred to Phase 3a** *(changed)* — nothing mutates yet;
  `hono-rate-limiter` is a 20-minute add and lands with the first mutating endpoint.

## Phase 2.5 — Product wins on existing data — **← NEXT UP** — ~2–3 days, each item independently shippable

`player_matches` already supports friend-group features that need **no auth and no
schema surgery** — worth shipping before the accounts arc so the site gets better for
its actual users now.

- **Recent matches feed** — `GET /api/matches`: the group's latest games, grouped by
  `match_id` so party games render as one card with everyone in it; home page becomes
  an activity feed. (One new index on `start_time`.)
- **Played-together stats** — self-join on `match_id`: win rate together vs solo,
  best/worst duos. The most on-theme feature a site called FriendTracker doesn't have.
- **Player profile page** — `/player/:id`: overall WR, recent form, top heroes by role;
  reuses meta-page components.
- **Client error handling** *(pulled up from Phase 4)* — distinguish 404 from
  500/network instead of rendering "Hero not found" for every failure (status already
  available in `useApi`).

## Phase 3 — Accounts / Leagues (the product arc) — ~2–3 weeks part-time

Turn the hand-seeded friend tracker into a real multi-user site. Greenfield.
**Prerequisites** *(added)*: Phase 2 done; nightly `pg_dump` backups (see standing
tasks); realistically the **Cloudflare tunnel cutover** — accounts on a LAN-only site
serve nobody, and public exposure is what makes rate limiting mandatory.

Decomposed into sub-projects, each its own spec → plan → implement cycle:

- **3a — Auth: Steam OpenID only** *(decided, was open question 2)* — `users` +
  `sessions` tables, httpOnly cookie, hand-rolled OpenID 2.0 verify (~100 lines; no
  Steam API key needed — profile data via OpenDota). Login links a user to their own
  `players` row via steam64→account-ID. No email/password (audience is Steam users by
  definition); schema keeps a provider discriminator so one could be added later.
  Rate limiting + auth middleware land here. OpenID redirects are browser-side, so the
  LAN origin works today; verify the multi-origin story (LAN/Tailscale/public) with an
  early spike.
- **3b — Pipeline-as-service + self-service players** — finish the pipeline-as-library
  refactor (→ `packages/pipeline`); minimal job runner (`jobs` table + in-process
  poller — this scale never needs Redis); `POST /api/players` validates the account
  against OpenDota, surfaces the "Expose Public Match Data" caveat in the UI when
  detected, and enqueues the fetch; admin "refresh now".
- **3c — Leagues: pure saved filter** *(decided, was open question 3)* — `leagues` +
  `league_members`; a league is a named player set resolved server-side onto the
  existing `?players=` code path (`?league=slug` accepted by meta/heroes/matches
  routes). Reads public → share-by-link is free. Frontend filter store gains league
  awareness; ad-hoc `?players=` kept. **Out of v1:** visibility, membership approval,
  per-league settings.
- **3d — Friends: cut** *(decided, was in scope)* — leagues subsume the use case;
  revisit only if a concrete social feature needs user↔user edges.

## Phase 4 — Polish (low priority, opportunistic)

From `fable-review.md` §3/§7:

- **`meta.ts` `limit(500)`** — can truncate at high hero×role counts (~630 theoretical);
  add a comment or raise it. *(Stale `pickRate` double-count note dropped — that code
  was removed in review pass 1.)*
- **a11y** — `PlayerFilterDropdown` has no keyboard support (Escape/focus trap);
  `HeroTable` sort headers are `<th @click>` not buttons; image `@error` fallback for
  renamed Steam CDN slugs; drop the unnecessary `{ deep: true }` watch in
  `playerFilter.ts`; collapse `selectAll`/`clear`/`resetFilter` (three names, one fn).
- **Dead `JSON.parse` dance** — still in `fetch-hero-builds.ts:147` (Drizzle returns jsonb
  as objects; the string branch is dead).

---

## Standing tasks (not phase-gated)

- **Drizzle snapshots out of sync** *(added 2026-07-02, hit twice during Phase 1/2)* —
  migrations 0001–0005 were hand-written with manual `_journal.json` entries and no
  `meta/` snapshots, so `pnpm --filter api db:generate` diffs against the stale 0000
  snapshot and prompts interactively. Until snapshots are regenerated, **hand-write new
  migrations** (follow the 0004/0005 convention: `IF NOT EXISTS`-style idempotent SQL +
  a journal entry). Fix properly before Phase 3's schema work (`users`, `sessions`,
  `leagues` tables) — that phase generates too many migrations to hand-write.
- **Backups** *(added)* — nightly `pg_dump` to `/srv/dakis/data/dota2tracker-backups/`,
  7-day rotation; trivial once the Phase 1 refresh container exists; **mandatory before
  Phase 3** (user-generated data).
- **Talent left/right spot-check** — `fetch-player-builds.ts` assumes OpenDota's
  `hero_abilities.talents` array is `[left, right]` matching the in-game tree. One
  manual session against the client; if reversed, fix is a single array swap.
- **Curated Abaddon seed build** — strip the fake stat numbers from the seed (keep
  items/skills as a curated *guide* with a "curated" badge instead of match counts);
  kills the last data lie instead of waiting for it to self-heal.

## Known data-quality gaps (product-visible)

- **Low parsed coverage** — only ~4% of matches are OpenDota-parsed, so most per-match
  roles fall back to the static hero→role map, and per-player builds draw on small
  samples. → The Phase 1 `request-parses` job now runs after every scheduled `fetch-data`
  (only *recent* unparsed matches, capped per run), so coverage improves going forward
  but the historical backlog stays unparsed.
- **Chipe (78589430) has no public OpenDota data** — needs "Expose Public Match Data"
  enabled in his Dota client; until then his stats are absent. → Phase 3b's validation
  flow surfaces this in the UI and makes his onboarding self-service once he flips it.

---

## Open questions — answered 2026-07-02

1. **Phase order** → Phase 1 first stands; the `app.ts`/`index.ts` split + vitest are
   simply the first items *within* Phase 2. The phases touch disjoint code, so there's
   no dependency — freshness is the higher-leverage start.
2. **Identity model** → Steam OpenID only; no email/password. See Phase 3a.
3. **Leagues** → pure saved filter, reads public (share-by-link free), no settings in
   v1. See Phase 3c.
4. **Mis-scoped / missing** → Friends cut (3d); Phase 2.5 added; refresh observability
   + parse requests added to Phase 1; backups + tunnel cutover surfaced as Phase 3
   prerequisites; stale `pickRate` note dropped. Full reasoning in
   `docs/superpowers/plans/2026-07-02-roadmap-implementation-plan.md`.
