/**
 * Seeds players and one curated hero build (Abaddon).
 * Real stats come from `pnpm fetch-data` (player_matches).
 * Run: pnpm seed (from repo root). Requires DATABASE_URL.
 */
import 'dotenv/config'
import { db, players, heroBuilds, and, eq, isNull } from '@friendtracker/db'
import type { BuildData, StatsData } from '@friendtracker/shared'

const SAMPLE_PLAYERS = [
  { id: '78589430', name: 'Chipe', avatar: undefined },
  { id: '83534161', name: 'Daki', avatar: undefined },
  { id: '82470544', name: 'Dekoz', avatar: undefined },
]

const ABADDON_SLUG = 'abaddon'
const ABADDON_NAME = 'Abaddon'
const ABADDON_ID = 102

const abaddonBuildData: BuildData = {
  skillBuilds: [
    {
      levels: [
        'abaddon_death_coil',
        'abaddon_aphotic_shield',
        'abaddon_aphotic_shield',
        'abaddon_death_coil',
        'abaddon_aphotic_shield',
        'abaddon_borrowed_time',
        'abaddon_aphotic_shield',
        'abaddon_death_coil',
        'abaddon_death_coil',
        'abaddon_frostmourne',
      ],
      talents: [
        { level: 10, left: '+25% XP', right: '+8 Strength', picked: 'right', winRate: 54 },
        { level: 15, left: '+90 Gold/min', right: '+20 Movement Speed', picked: 'left', winRate: 52 },
        { level: 20, left: '+400 Aphotic Shield Health', right: '-4s Death Coil Cooldown', picked: 'left', winRate: 53 },
        { level: 25, left: 'Curse of Avernus Silences', right: '+1.5s Borrowed Time Duration', picked: 'right', winRate: 55 },
      ],
    },
  ],
  itemBuild: {
    startingItems: [
      { items: ['tango', 'gauntlets', 'gauntlets', 'circlet', 'branches'], matches: 1200, winRate: 54 },
      { items: ['tango', 'slippers', 'slippers', 'circlet', 'magic_stick'], matches: 800, winRate: 52 },
    ],
    coreItems: [
      { items: ['soul_ring', 'power_treads', 'radiance'], matches: 2000, winRate: 56 },
      { items: ['soul_ring', 'power_treads', 'abyssal_blade'], matches: 1500, winRate: 53 },
    ],
    situationalItems: [
      { itemName: 'black_king_bar', itemImage: 'black_king_bar', purchaseRate: 45, avgMinute: 22 },
      { itemName: 'assault', itemImage: 'assault', purchaseRate: 30, avgMinute: 28 },
    ],
    neutralItems: [
      {
        tier: 1,
        items: [
          { name: 'arcane_ring', image: 'arcane_ring', pickRate: 22, winRate: 54, isBest: true },
          { name: 'faded_broach', image: 'faded_broach', pickRate: 18, winRate: 52 },
        ],
      },
      {
        tier: 2,
        items: [
          { name: 'vambrace', image: 'vambrace', pickRate: 20, winRate: 55, isBest: true },
        ],
      },
      { tier: 3, items: [] },
      { tier: 4, items: [] },
      { tier: 5, items: [] },
    ],
    lateGameInventories: [
      { bracket: '20-35 min', items: ['soul_ring', 'power_treads', 'radiance', 'black_king_bar'] },
      { bracket: '35-55 min', items: ['soul_ring', 'power_treads', 'radiance', 'black_king_bar', 'assault'] },
      { bracket: '55+ min', items: ['boots_of_bearing', 'radiance', 'black_king_bar', 'assault', 'abyssal_blade'] },
    ],
  },
}

const abaddonStatsData: StatsData = {
  laneStats: [
    { lane: 'Mid', advantagePct: 48, wins: 400, draws: 50, losses: 350 },
    { lane: 'Safe', advantagePct: 52, wins: 600, draws: 40, losses: 360 },
  ],
  radiantWinRate: 52,
  direWinRate: 48,
  networthAt10: 4200,
  networthAt15: 6800,
  networthAt20: 9500,
  pickPhases: [
    { phase: 'First', winRate: 51, matches: 500 },
    { phase: 'Second', winRate: 53, matches: 800 },
    { phase: 'Last', winRate: 49, matches: 200 },
  ],
  matchDurationWinRate: [
    { bracket: '<35 min', winRate: 48, matches: 400 },
    { bracket: '35-50 min', winRate: 54, matches: 700 },
    { bracket: '50+ min', winRate: 52, matches: 400 },
  ],
}

async function main() {
  for (const p of SAMPLE_PLAYERS) {
    await db.insert(players).values(p).onConflictDoUpdate({
      target: players.id,
      set: { name: p.name, avatar: p.avatar ?? null },
    })
  }
  console.log('Seeded players.')

  const role = 'offlane' as const
  const totalMatches = 1500
  const winRate = 53.5

  // Insert-only: don't clobber whatever populate-builds / fetch-hero-builds
  // may have written to this row on a later pipeline pass. Re-running seed
  // alone must not regress live stats back to the curated placeholders.
  const existing = await db
    .select({ heroSlug: heroBuilds.heroSlug })
    .from(heroBuilds)
    .where(
      and(
        eq(heroBuilds.heroSlug, ABADDON_SLUG),
        eq(heroBuilds.role, role),
        isNull(heroBuilds.playerId)
      )
    )
    .limit(1)

  if (existing.length === 0) {
    await db.insert(heroBuilds).values({
      heroId: ABADDON_ID,
      heroSlug: ABADDON_SLUG,
      heroName: ABADDON_NAME,
      role,
      playerId: null,
      totalMatches,
      winRate,
      buildData: abaddonBuildData,
      statsData: abaddonStatsData,
    })
    console.log('Seeded hero_builds (Abaddon).')
  } else {
    console.log('hero_builds (Abaddon) already present, skipping.')
  }

  console.log('Seed done.')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
