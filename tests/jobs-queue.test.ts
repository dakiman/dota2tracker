import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { db, pool, jobs } from '@friendtracker/db'
import { enqueue } from '@friendtracker/pipeline'

afterAll(async () => {
  await pool.end()
})

beforeEach(async () => {
  await db.delete(jobs)
})

describe('jobs schema + enqueue', () => {
  it('inserts pending rows in argument order', async () => {
    const n = await enqueue([{ type: 'fetch-data' }, { type: 'populate-builds' }])
    expect(n).toBe(2)
    const rows = await db.select().from(jobs).orderBy(jobs.id)
    expect(rows.map((r) => r.type)).toEqual(['fetch-data', 'populate-builds'])
    expect(rows[0].status).toBe('pending')
    expect(rows[0].payload).toBeNull()
    expect(rows[0].createdAt).toBeInstanceOf(Date)
    expect(rows[0].startedAt).toBeNull()
  })

  it('dedups a pending job of the same type', async () => {
    expect(await enqueue([{ type: 'fetch-data' }])).toBe(1)
    expect(await enqueue([{ type: 'fetch-data' }])).toBe(0)
  })

  it('dedups per payload player, not globally', async () => {
    expect(await enqueue([{ type: 'fetch-player', payload: { playerId: '501' } }])).toBe(1)
    expect(await enqueue([{ type: 'fetch-player', payload: { playerId: '502' } }])).toBe(1)
    expect(await enqueue([{ type: 'fetch-player', payload: { playerId: '501' } }])).toBe(0)
  })

  it('does not dedup against running/finished rows', async () => {
    await enqueue([{ type: 'fetch-data' }])
    await db.update(jobs).set({ status: 'running' })
    expect(await enqueue([{ type: 'fetch-data' }])).toBe(1)
  })

  it('rejects job types outside the registry', async () => {
    await expect(enqueue([{ type: 'backup-db' }])).rejects.toThrow(/unknown job type/)
  })
})
