# FriendTracker — Roadmap

*Consolidated 2026-07-02 (commit `4bcee3f`). Handoff doc for a Fable review/update pass.*

This is the single source of truth for **where the product is going**. It merges the
prior agent-memory roadmap note (2026-06-10), the forward-looking §9 of `fable-review.md`,
and known data-quality gaps. Architecture and commands live in `CLAUDE.md`; the code
review itself (with per-finding detail) is in `fable-review.md`.

**Fable:** please pressure-test the phasing below, flag anything mis-scoped or missing,
and update this file in place. Open questions are collected at the bottom.

---

## Where we are today

FriendTracker is a read-only Dota 2 stats site for a fixed friend group. `player_matches`
(one row per player per significant match, role derived per match) is the single source of
truth for all stats. There is **no auth** — the `players` table is hand-seeded, CORS is
wide open (`apps/api/src/index.ts:12`), and there's no rate limiting or session handling.
Data is refreshed by **manually run scripts** (`pnpm fetch-data` → `populate-builds` →
`fetch-hero-builds` → `fetch-player-builds`, now chainable via `pnpm refresh`).

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

---

## Phase 1 — Data freshness (highest leverage, do first)

The single biggest gap that isn't a feature. Everything is manual-run scripts, so stats go
stale the moment the operator stops running them — which undermines the site for anyone who
isn't that operator. This is also a prerequisite for a multi-user site (Phase 3).

- **Scheduled refresh**: a cron container / systemd timer on dakis-server-v2 running
  `pnpm refresh` on a cadence. Needs to be OpenDota-rate-limit-friendly (scripts already
  have 429 retry) and idempotent (they are).
- Decide cadence (hourly? daily?) and whether to stagger per-player fetches.

## Phase 2 — Hardening (prerequisite for accounts)

These are fine for a read-only LAN site but **must** land before/with accounts. Grouped
from `fable-review.md` §3/§8.

- **CORS lockdown** — `cors()` currently allows every origin. Since nginx proxies `/api/`
  same-origin in prod, likely drop CORS entirely rather than configure it.
- **Rate limiting** — none today; Hono has middleware. Required once endpoints mutate.
- **Session/auth handling** — see Phase 3; the middleware stack lands here.
- **Split `app.ts` (construction) from `index.ts` (bootstrap)** — today migrations + serve
  run at import time (`index.ts:20-32`), which blocks testing routes with `app.request()`.
- **Test runner** — none exists. After the split, add vitest route tests + unit tests for
  the pure aggregators (`deriveRole`, `aggregateItemBuild`, `aggregateSkillBuild`,
  `buildDurationStats`). Owner previously deferred tests; revisit now that auth is coming.
- **Graceful shutdown** — SIGTERM handler → `server.close()` + `pool.end()` for clean
  container stops.
- **`timestamptz`** — `player_matches.start_time` and `hero_builds.last_updated` are
  `timestamp` without tz (`schema.ts:74`, `:41`); shift if the container TZ ever differs
  from the writer's. Needs a migration.

## Phase 3 — Accounts / Friends / Leagues (the product arc)

The stated product direction: turn the hand-seeded friend tracker into a real multi-user
site. Barely started — essentially all greenfield.

- **Accounts** — user sign-up/login. No auth exists yet. Decide identity model (Steam
  OpenID login is the obvious fit for a Dota site vs. email/password).
- **Friends** — users add each other; a user's view is scoped to their friends.
- **Custom leagues** — a league is a **named set of player IDs filtered over
  `player_matches`**. The schema was deliberately shaped for this: `players.id` as a text
  Steam ID and the existing `?players=id1,id2` query model (capped at 50) map cleanly onto
  "league = server-side named player set". Migrating the frontend filter store from raw IDs
  to a league ID is mostly frontend work — no schema surgery expected.
- Adding a tracked player currently means a hand-seed + a fetch run; accounts should make
  this self-service (with the OpenDota "Expose Public Match Data" caveat below surfaced in
  the UI).

## Phase 4 — Polish (low priority, opportunistic)

From `fable-review.md` §3/§7:

- **Client error handling** — every fetch failure renders "Hero not found";
  distinguish 404 from 500/network (status is already available in `useApi`).
- **`meta.ts` `limit(500)`** — can truncate at high hero×role counts (~630 theoretical);
  add a comment or raise it. Also note `pickRate` denominator double-counts co-op matches.
- **a11y** — `PlayerFilterDropdown` has no keyboard support (Escape/focus trap);
  `HeroTable` sort headers are `<th @click>` not buttons; image `@error` fallback for
  renamed Steam CDN slugs; drop the unnecessary `{ deep: true }` watch in
  `playerFilter.ts`; collapse `selectAll`/`clear`/`resetFilter` (three names, one fn).
- **Dead `JSON.parse` dance** — still in `fetch-hero-builds.ts:147` (Drizzle returns jsonb
  as objects; the string branch is dead).

---

## Known data-quality gaps (product-visible)

- **Low parsed coverage** — only ~4% of matches are OpenDota-parsed, so most per-match
  roles fall back to the static hero→role map, and per-player builds draw on small samples.
  More parsed coverage improves role/lane/build accuracy.
- **Chipe (78589430) has no public OpenDota data** — needs "Expose Public Match Data"
  enabled in his Dota client; until then his stats are absent.
- **Curated Abaddon seed build** — the fake "offlane · 1500 games" tab is now mostly
  self-healing (role tabs come from `player_matches`; `populate-builds` overwrites the
  curated count with real matches), but the seeded 1500 lingers until someone actually
  plays offlane Abaddon. Consider whether the curated build should carry stat numbers at all.

## Unverified / needs manual check

- **Talent left/right ordering** — `fetch-player-builds.ts` assumes OpenDota's
  `hero_abilities.talents` array is `[left, right]` matching the in-game tree (documented
  in code). Spot-check one hero's tree against the client; if reversed, every talent tree
  renders mirrored.

---

## Open questions for Fable

1. Is **Phase 1 (scheduled refresh) before Phase 2 (hardening)** the right order, or should
   the `app.ts`/`index.ts` split + tests land first so the accounts work starts on a
   testable base?
2. **Identity model** for accounts — Steam OpenID vs. email/password vs. both?
3. Should **leagues** be purely a saved filter (view-only, no data implications) or carry
   their own settings (default role, visibility, membership approval)?
4. Anything here mis-scoped, and what's missing entirely?
