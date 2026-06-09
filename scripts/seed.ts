/**
 * Seeds players and sample hero_stats + one curated hero build (Abaddon).
 * Run: pnpm seed (from repo root). Requires DATABASE_URL.
 */
import 'dotenv/config'
import { db, players, heroStats, heroBuilds, and, eq, isNull } from '../apps/api/src/db/index.js'
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

  await db
    .delete(heroBuilds)
    .where(
      and(
        eq(heroBuilds.heroSlug, ABADDON_SLUG),
        eq(heroBuilds.role, role),
        isNull(heroBuilds.playerId)
      )
    )
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

  const sampleHeroStats = [
    { heroId: 1, heroName: 'Anti-Mage', heroSlug: 'antimage', role: 'carry' as const, matches: 50, wins: 28 },
    { heroId: 102, heroName: 'Abaddon', heroSlug: 'abaddon', role: 'offlane' as const, matches: 30, wins: 16 },
    { heroId: 2, heroName: 'Axe', heroSlug: 'axe', role: 'offlane' as const, matches: 45, wins: 24 },
    { heroId: 3, heroName: 'Bane', heroSlug: 'bane', role: 'support' as const, matches: 20, wins: 11 },
    { heroId: 4, heroName: 'Bloodseeker', heroSlug: 'bloodseeker', role: 'mid' as const, matches: 25, wins: 14 },
  ]

  for (const player of SAMPLE_PLAYERS) {
    for (const h of sampleHeroStats) {
      await db.insert(heroStats).values({
        playerId: player.id,
        heroId: h.heroId,
        heroName: h.heroName,
        heroSlug: h.heroSlug,
        role: h.role,
        matches: h.matches,
        wins: h.wins,
        kills: h.matches * 5,
        deaths: h.matches * 4,
        assists: h.matches * 8,
      }).onConflictDoUpdate({
        target: [heroStats.playerId, heroStats.heroId],
        set: {
          matches: h.matches,
          wins: h.wins,
          kills: h.matches * 5,
          deaths: h.matches * 4,
          assists: h.matches * 8,
          lastUpdated: new Date(),
        },
      })
    }
  }
  console.log('Seeded sample hero_stats.')

  console.log('Seed done.')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
