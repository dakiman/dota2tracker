import { describe, it, expect } from 'vitest'
import { parsePlayersParam } from '../apps/api/src/routes/util.js'

describe('parsePlayersParam', () => {
  it('returns null when the param is absent or empty', () => {
    expect(parsePlayersParam(undefined)).toBeNull()
    expect(parsePlayersParam('')).toBeNull()
  })

  it('parses and trims a valid list', () => {
    expect(parsePlayersParam('111, 222')).toEqual(['111', '222'])
  })

  it('drops invalid ids but keeps valid ones', () => {
    expect(parsePlayersParam('111,abc')).toEqual(['111'])
  })

  it("returns 'invalid' when no valid ids remain", () => {
    expect(parsePlayersParam('abc,def')).toBe('invalid')
  })

  it('caps at 50 ids', () => {
    const ids = Array.from({ length: 60 }, (_, i) => String(i + 1)).join(',')
    expect(parsePlayersParam(ids)).toHaveLength(50)
  })
})
