import { describe, it, expect } from 'vitest'
import { filesToDelete } from '../scripts/lib/backup-rotation.js'

// Nightly job runs at 04:10 UTC; filenames carry the run date.
const NOW = new Date('2026-07-05T04:10:00Z')

describe('filesToDelete', () => {
  it('deletes dumps older than keepDays and keeps recent ones', () => {
    const names = [
      'friendtracker-2026-07-05.dump',
      'friendtracker-2026-06-29.dump',
      'friendtracker-2026-06-28.dump',
      'friendtracker-2026-06-20.dump',
    ]
    expect(filesToDelete(names, NOW, 7)).toEqual([
      'friendtracker-2026-06-28.dump',
      'friendtracker-2026-06-20.dump',
    ])
  })

  it('never touches filenames that do not match the dump pattern', () => {
    const names = ['pgdata.tar', 'friendtracker-notadate.dump', 'other-2020-01-01.dump']
    expect(filesToDelete(names, NOW, 7)).toEqual([])
  })

  it('returns empty when everything is fresh', () => {
    expect(filesToDelete(['friendtracker-2026-07-04.dump'], NOW, 7)).toEqual([])
  })
})
