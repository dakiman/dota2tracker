import { describe, it, expect } from 'vitest'
import { aggregateItemBuild, type ParsedMatch } from '../scripts/lib/player-aggregates.js'

const itemIdMap = new Map<number, string>([
  [1, 'blink'],
  [2, 'black_king_bar'],
  [3, 'tango'],
])

function match(overrides: Partial<ParsedMatch>): ParsedMatch {
  return {
    matchId: 1,
    duration: 2400,
    won: true,
    isRadiant: true,
    purchaseLog: [],
    abilityUpgrades: [],
    finalItems: [],
    neutralItem: 0,
    kills: 0,
    deaths: 0,
    assists: 0,
    firstPurchaseTime: {},
    ...overrides,
  }
}

describe('aggregateItemBuild', () => {
  it('puts items in >=40% of matches into core and excludes consumables', () => {
    const matches = [
      match({ matchId: 1, won: true, finalItems: [1, 3] }), // blink + tango (excluded)
      match({ matchId: 2, won: false, finalItems: [1] }),
    ]
    const build = aggregateItemBuild(matches, itemIdMap)
    expect(build.coreItems).toEqual([{ items: ['blink'], matches: 2, winRate: 50 }])
  })

  it('groups identical starting purchases (time <= 0) ignoring order', () => {
    const matches = [
      match({
        matchId: 1,
        won: true,
        purchaseLog: [
          { time: -60, key: 'tango' },
          { time: -60, key: 'branches' },
        ],
      }),
      match({
        matchId: 2,
        won: false,
        purchaseLog: [
          { time: -60, key: 'branches' },
          { time: -60, key: 'tango' },
        ],
      }),
    ]
    const build = aggregateItemBuild(matches, itemIdMap)
    expect(build.startingItems).toEqual([
      { items: ['branches', 'tango'], matches: 2, winRate: 50 },
    ])
  })

  it('never emits unknown item ids', () => {
    const build = aggregateItemBuild([match({ finalItems: [999] })], itemIdMap)
    expect(build.coreItems).toEqual([])
  })
})
