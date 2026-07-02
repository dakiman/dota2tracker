/** Pure aggregation of OpenDota /heroes/:id/durations buckets into UI brackets. */
import type { MatchDurationWinRate } from '@friendtracker/shared'

export interface DurationBucket {
  duration_bin: number
  games_played: number
  wins: number
}

export function buildDurationStats(buckets: DurationBucket[]): MatchDurationWinRate[] {
  const brackets: { label: string; minSec: number; maxSec: number }[] = [
    { label: '<20 min', minSec: 0, maxSec: 1200 },
    { label: '20-30 min', minSec: 1200, maxSec: 1800 },
    { label: '30-40 min', minSec: 1800, maxSec: 2400 },
    { label: '40-50 min', minSec: 2400, maxSec: 3000 },
    { label: '50+ min', minSec: 3000, maxSec: Infinity },
  ]

  return brackets
    .map(({ label, minSec, maxSec }) => {
      const inRange = buckets.filter(
        (b) => b.duration_bin >= minSec && b.duration_bin < maxSec
      )
      const matches = inRange.reduce((s, b) => s + b.games_played, 0)
      const wins = inRange.reduce((s, b) => s + b.wins, 0)
      if (matches < 10) return null
      return { bracket: label, winRate: Math.round((wins / matches) * 1000) / 10, matches }
    })
    .filter((x): x is MatchDurationWinRate => x != null)
}
