import { describe, it, expect } from 'vitest'
import { buildDurationStats } from '@friendtracker/pipeline'

describe('buildDurationStats', () => {
  it('groups duration bins into brackets and computes win rate to one decimal', () => {
    const stats = buildDurationStats([
      { duration_bin: 1200, games_played: 30, wins: 15 },
      { duration_bin: 1500, games_played: 10, wins: 8 },
    ])
    // both bins fall in [1200, 1800) → "20-30 min": 40 games, 23 wins → 57.5%
    expect(stats).toEqual([{ bracket: '20-30 min', winRate: 57.5, matches: 40 }])
  })

  it('drops brackets with fewer than 10 matches', () => {
    const stats = buildDurationStats([{ duration_bin: 600, games_played: 9, wins: 9 }])
    expect(stats).toEqual([])
  })

  it('returns empty for no buckets', () => {
    expect(buildDurationStats([])).toEqual([])
  })
})
