import { describe, it, expect } from 'vitest'
import { deriveRole } from '@friendtracker/shared'

describe('deriveRole', () => {
  it('maps roaming to support regardless of lane', () => {
    expect(deriveRole(1, true, 1)).toBe('support')
  })

  it('safe lane: carry for core-flavored heroes', () => {
    expect(deriveRole(1, false, 1)).toBe('carry')
  })

  it('safe lane: hard support for support-flavored heroes', () => {
    expect(deriveRole(1, false, 5)).toBe('hard_support')
  })

  it('mid lane is mid regardless of hero flavor', () => {
    expect(deriveRole(2, false, 5)).toBe('mid')
  })

  it('off/jungle lanes: offlane for cores, support for support-flavored', () => {
    expect(deriveRole(3, false, 1)).toBe('offlane')
    expect(deriveRole(3, false, 5)).toBe('support')
    expect(deriveRole(4, false, 1)).toBe('offlane')
  })

  it('falls back to the static hero role when lane data is missing', () => {
    expect(deriveRole(null, null, 1)).toBe('carry')
    expect(deriveRole(null, null, 5)).toBe('support')
  })
})
