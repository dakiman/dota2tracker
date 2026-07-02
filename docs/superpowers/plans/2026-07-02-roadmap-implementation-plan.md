# Roadmap Implementation Plan — 2026-07-02

Fable review of `ROADMAP.md` @ `8dd23b4`. This is the detailed implementation plan the
roadmap asked for: phasing verdicts, per-phase work breakdown, feasibility, and
surrounding features. `ROADMAP.md` has been updated in place to match; this doc carries
the implementation detail that doesn't belong in the roadmap.

## Verdicts on the open questions

**Q1 — Phase 1 vs Phase 2 order: keep Phase 1 first.** The two phases touch disjoint
code (Phase 1 is scripts + compose; Phase 2 is API server code), so there's no
dependency either way — the order question is pure leverage, and freshness wins. The
real sequencing constraint is *within* Phase 2: the `app.ts`/`index.ts` split and vitest
scaffold must be the first Phase 2 item, before any auth code exists to need testing.
One Phase 1 design choice matters for Phase 3, though: build the refresh entrypoints as
**importable functions, not just CLI scripts** (see "pipeline-as-library" below), so the
self-service player add in Phase 3 can trigger fetches without shelling out.

**Q2 — Identity model: Steam OpenID only.** The audience is by definition Steam users;
login yields a steam64 → 32-bit account ID that links a user directly to their own
`players` row and stats. No password storage, reset flows, or email verification to
build. Steam OpenID 2.0 needs no API key (profile name/avatar can come from OpenDota's
`/players/{account_id}`), and the redirect is browser-side, so `http://192.168.100.81:8743`
works as a return URL on LAN today — public HTTPS is *not* a blocker for building it,
only for opening it up. Design the `users` table so a second provider could be added
(nullable `steam_id` + a `provider` discriminator is enough), but don't build one.

**Q3 — Leagues: pure saved filter first.** A league = `(id, name, owner, member player
IDs)` resolved server-side to the existing `?players=` semantics. No visibility,
approval, or per-league settings in v1 — the site is read-only, so "anyone with the
link can view" is fine and free. Add settings only when a concrete need appears.

**Q4 — Mis-scoped / missing:**
- **Friends is YAGNI — cut it.** A league *is* a friend group. User↔user friendship
  edges only pay off with social features (activity feeds, permissions) that nothing
  else on this roadmap needs. Leagues + share-by-link cover the actual use case.
  Reframe: "friends" = members of leagues you're in.
- **The roadmap jumps from plumbing to platform with no product value in between.**
  `player_matches` already supports several cheap, high-fun features for the friend
  group (recent-matches feed, player profiles, played-together stats). Insert a
  "Phase 2.5" of read-only product wins — they need no auth and deliver value sooner
  than accounts do.
- **Refresh observability is missing from Phase 1.** A cron that fails silently is
  worse than a manual script you know you have to run. Needs a `refresh_runs` log and
  a "data updated X ago" surface in the UI.
- **The ~4% parsed-coverage gap is listed but has no roadmap item attacking it.**
  OpenDota accepts parse requests (`POST /request/{match_id}`); a job that requests
  parses for recent unparsed matches directly improves role/lane/build accuracy.
- **No backup story.** Read-only today, tolerable; with accounts, user-generated data
  (users, leagues) makes `pg_dump` mandatory. Land it with or before Phase 3.
- **Public exposure is an unstated dependency of Phase 3.** Accounts for a LAN-only
  site serve ~nobody. The Cloudflare tunnel cutover (pending on dakis-server-v2) is
  effectively a Phase 3 prerequisite and pulls rate limiting from "nice" to "required".
- **Stale Phase 4 bullet**: the `pickRate` double-count note refers to code removed in
  review pass 1. (The remaining `pickRate` is inside curated-build JSONB — unrelated.)

---

## Phase 1 — Scheduled refresh (~1 day)

### Approach

Two options considered:

- **(a) Host systemd timer** running `pnpm refresh` in `~/dev/dota2tracker` against the
  published pg port. Simplest, but couples prod freshness to the host's node/pnpm setup
  and lives outside the `/srv/dakis` compose convention.
- **(b) Refresh container** (recommended): a `dota2tracker-refresh` service in the prod
  compose, built from this repo (node + pnpm workspace with `scripts/`, `packages/shared`,
  `apps/api/src/db`), running [supercronic](https://github.com/aptible/supercronic) (or a
  plain `while sleep` loop) with `DATABASE_URL` from the existing secrets env. Follows
  the established per-app container pattern; survives host reprovisioning; `sg docker`
  logs give run history for free.

### Cadence (fits OpenDota free tier: 2 000 calls/day, 60/min; scripts already pace at 1.1 s)

| Job | Cadence | Approx. calls |
|---|---|---|
| `fetch-data` + `populate-builds` | every 6 h | 1 + N_players ≈ 10/run |
| `fetch-hero-builds` + `fetch-player-builds` | daily, off-peak | ~2×heroes-with-builds + parsed-match details ≈ 300–500 |

Total ≈ 550/day worst case — comfortable headroom. Stagger the daily job away from the
6-hourly ones. Scripts are already idempotent (upserts) and 429-tolerant, so overlap or
a crashed run is harmless.

### Work items

1. `Dockerfile.refresh` (or a `refresh` build target): workspace install, `tsx` runtime,
   crontab with the two cadences above.
2. Compose service in `/srv/dakis/apps/dota2tracker/compose.yml` (+ local equivalent in
   `docker-compose.yml`), `restart: unless-stopped`.
3. **Observability**: `refresh_runs` table (`id, job, started_at, finished_at, ok,
   detail jsonb`) written by a thin wrapper around each script's `main()`; expose
   `lastRefreshed` on `GET /api/config`; render "data updated X ago" in the web footer.
4. **Parse-request job** (small, optional but recommended here): after `fetch-data`,
   `POST /request/{match_id}` for the group's unparsed matches from the last N days
   (cap ~20/run to stay polite). Re-runs of `fetch-data` then pick up the lane data.
5. Structure each script as `export async function run()` with the CLI `main()` as a
   thin caller — this is the seed of the Phase 3 pipeline-as-library refactor, nearly
   free to do now while touching the files anyway.

### Feasibility

High. No schema surgery beyond the additive `refresh_runs` table; scripts already
idempotent and rate-limit-safe. Risk: image needs dev-ish deps (`tsx`, workspace
packages) — accept a fatter refresh image (it's not the serving path).

## Phase 2 — Hardening (~1–2 days)

In order:

1. **`app.ts`/`index.ts` split** — `app.ts` constructs and exports the Hono app;
   `index.ts` does migrations, `serve()`, and shutdown wiring. Unblocks `app.request()`
   testing. (~30 min)
2. **Vitest** — workspace dev-dep. Unit tests for the pure aggregators
   (`deriveRole`/`getHeroRole` in `packages/shared`; `aggregateItemBuild`,
   `aggregateSkillBuild`, duration-stats helpers in `scripts/fetch-player-builds.ts` —
   export them or lift them into `scripts/lib/`). Route tests via `app.request()`
   against the local compose Postgres using a `TEST_DATABASE_URL` + a per-run schema or
   throwaway database — skip testcontainers, it's overkill here. Wire `pnpm test` into
   `lint`'s CI-ish role.
3. **Drop CORS** — remove `app.use(cors())` entirely. Prod is same-origin behind nginx;
   dev goes through the Vite proxy. Verify both paths, delete the dep usage.
4. **Graceful shutdown** — SIGTERM/SIGINT → `server.close()` + `pool.end()`.
5. **`timestamptz` migration** — `ALTER ... TYPE timestamptz USING <col> AT TIME ZONE
   'UTC'` for `player_matches.start_time` and `hero_builds.last_updated` (both written
   from UTC containers, so the reinterpretation is safe). One generated migration.
6. **Rate limiting — defer to Phase 3 entry.** Nothing mutates yet; an in-memory
   limiter (`hono-rate-limiter`) is a 20-minute add when the first mutating endpoint or
   public exposure lands, and doing it now just adds config to a read-only LAN site.

Feasibility: high, all mechanical. The only judgment call is test-DB plumbing; keep it
to "compose db + separate database name" and it stays small.

## Phase 2.5 — Product wins on existing data (new; ~2–3 days, cuttable/reorderable per item)

All pure reads on `player_matches`; no auth, no schema changes (one optional index).

- **Recent matches feed** — `GET /api/matches?players=…&limit=50`: the group's latest
  games (hero, W/L, KDA, duration, when; group rows by `match_id` so a party game shows
  as one card with everyone in it). Home page becomes an activity feed instead of a
  static player list. Add `index on (start_time desc)`.
- **Player profile page** — `/player/:id`: overall WR, recent form (last 20), top
  heroes by role, KDA trends. Route + aggregation query, largely reusing meta-page
  components.
- **Played-together stats** — self-join `player_matches` on `match_id`: WR when X and Y
  queue together vs solo, best/worst duo pairings. This is *the* friend-group feature —
  nothing on the current roadmap is more on-theme for a site called FriendTracker.
- **Client error handling** (pulled up from Phase 4) — distinguish 404 from 5xx/network
  in `useApi` consumers; it's cheap and product-visible.

## Phase 3 — Accounts + Leagues (the platform arc; ~2–3 weeks part-time)

Prerequisites: Phase 2 complete; Cloudflare tunnel cutover (for the "real site" goal);
`pg_dump` backup cron on `/srv/dakis/data/dota2tracker-pg`.

Decompose into three sub-projects, each its own spec → plan → implement cycle:

### 3a — Auth (~2–3 days)
- Schema: `users` (`id, steam_id unique, player_id nullable FK → players, name, avatar,
  created_at`), `sessions` (`id, user_id, expires_at`) — httpOnly cookie, rolling expiry.
  Hand-rolled session table over a framework; it's ~50 lines and Drizzle-native.
- Steam OpenID 2.0: `GET /api/auth/steam` (redirect) + `GET /api/auth/steam/callback`
  (verify assertion server-side — ~100 lines or the `steam-signin` npm package),
  steam64 → account-ID conversion, upsert user, set cookie. `GET /api/me`, `POST
  /api/auth/logout`.
- Land rate limiting (deferred from Phase 2) + auth middleware in the same change.
- Mutations auth-gated; all existing read routes stay public.

### 3b — Pipeline-as-service + self-service players (~3–5 days)
- Finish the pipeline-as-library refactor (started in Phase 1): move fetch/aggregate
  logic to `packages/pipeline` importable by both the refresh container and the API.
- Minimal job runner: `jobs` table + in-process poller in the API (this scale never
  needs Redis/BullMQ). Jobs: `fetch-player`, `refresh-all`, `request-parses`.
- `POST /api/players` (auth-gated): validate account ID against OpenDota
  (`/players/{id}` — detect the private-data case and surface the "Expose Public Match
  Data" caveat in the UI), insert, enqueue `fetch-player`; UI shows fetch progress.
  This also finally makes adding Chipe's data self-service the day he flips the flag.
- Admin "refresh now" button.

### 3c — Leagues (~2–3 days)
- Schema: `leagues` (`id, slug, name, owner_user_id, created_at`), `league_members`
  (`league_id, player_id`, PK both).
- Routes: CRUD (auth-gated writes, public reads), and `?league=slug` accepted by
  `/api/meta`, `/api/heroes/:slug`, `/api/matches` — resolved server-side to the member
  ID set, reusing the existing `?players=` code path (`players` wins if both given).
- Frontend: `playerFilter` store gains league awareness (selected league → chip in the
  nav, URL carries `?league=`); ad-hoc `?players=` selection kept. Share-by-link works
  with zero extra code because reads are public.
- Explicitly out of v1: visibility settings, membership approval, default-role,
  league avatars.

### 3d — Friends: **cut** (see Q4). Revisit only if a concrete social feature needs it.

Feasibility: 3a/3c are well-trodden; 3b is the real engineering (job runner + refactor)
but has no unknowns. The one external unknown is Steam OpenID return-URL behavior across
the three origins (LAN IP, Tailscale HTTPS, future public domain) — verify early with a
spike; realm/return-URL are per-request in OpenID 2.0, so multi-origin should be fine.

## Phase 4 — Polish (unchanged, opportunistic)

As in the roadmap, minus the items pulled forward (client error handling → 2.5) and the
stale `pickRate` note (dropped). a11y items, `meta.ts` limit comment, dead `JSON.parse`
branch in `fetch-hero-builds.ts:147`, `playerFilter` dedup of `selectAll`/`clear`/
`resetFilter` + `{ deep: true }` removal.

## Standing tasks (not phase-gated)

- **Talent left/right spot-check** — one manual session against the in-game client;
  if mirrored, fix is a single array swap in `fetch-player-builds.ts`.
- **Curated Abaddon build** — recommendation: strip the fake stat numbers from the
  seed (keep items/skills as a curated *guide*, render "curated" badge instead of
  match counts). Small, kills the last data lie.
- **Backups** — nightly `pg_dump` to `/srv/dakis/data/dota2tracker-backups/` with
  7-day rotation; trivial cron in the refresh container once it exists (Phase 1 gives
  us the container; do it there).

## Suggested execution order

1. Phase 1 (with observability + parse requests + `run()` exports)
2. Phase 2 (split → tests → CORS → shutdown → timestamptz)
3. Phase 2.5 (feed → played-together → profiles; each independently shippable)
4. Tunnel cutover decision + backups
5. Phase 3a → 3b → 3c as separate spec/plan cycles
