import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { desc, eq } from 'drizzle-orm'
import { db, pool, jobs, refreshRuns } from '@friendtracker/db'
import {
  enqueue,
  runPendingJobs,
  recoverOrphanedJobs,
  pruneOldJobs,
  type JobFn,
} from '@friendtracker/pipeline'

afterAll(async () => {
  await pool.end()
})

beforeEach(async () => {
  await db.delete(jobs)
})

describe('runPendingJobs', () => {
  it('drains claimed jobs in id order, marks them done, logs to refresh_runs', async () => {
    const calls: string[] = []
    const reg: Record<string, JobFn> = {
      'fetch-data': async () => {
        calls.push('fetch-data')
        return 'synced'
      },
      'populate-builds': async () => {
        calls.push('populate-builds')
        return 'built'
      },
    }
    await enqueue([{ type: 'fetch-data' }, { type: 'populate-builds' }])
    expect(await runPendingJobs(reg)).toBe(2)
    expect(calls).toEqual(['fetch-data', 'populate-builds'])
    const rows = await db.select().from(jobs).orderBy(jobs.id)
    expect(rows.map((r) => r.status)).toEqual(['done', 'done'])
    expect(rows[0].startedAt).toBeInstanceOf(Date)
    expect(rows[0].finishedAt).toBeInstanceOf(Date)
    const [run] = await db
      .select()
      .from(refreshRuns)
      .where(eq(refreshRuns.job, 'fetch-data'))
      .orderBy(desc(refreshRuns.id))
      .limit(1)
    expect(run.ok).toBe(true)
    expect(run.detail).toEqual({ summary: 'synced' })
  })

  it('marks a throwing job failed (jobs.error + refresh_runs) and keeps draining', async () => {
    const reg: Record<string, JobFn> = {
      'fetch-data': async () => {
        throw new Error('boom')
      },
      'populate-builds': async () => 'ok',
    }
    await enqueue([{ type: 'fetch-data' }, { type: 'populate-builds' }])
    expect(await runPendingJobs(reg)).toBe(2)
    const rows = await db.select().from(jobs).orderBy(jobs.id)
    expect(rows[0].status).toBe('failed')
    expect(rows[0].error).toBe('boom')
    expect(rows[1].status).toBe('done')
    const [run] = await db
      .select()
      .from(refreshRuns)
      .where(eq(refreshRuns.job, 'fetch-data'))
      .orderBy(desc(refreshRuns.id))
      .limit(1)
    expect(run.ok).toBe(false)
  })

  it('fails a job whose type is not in the registry', async () => {
    await db.insert(jobs).values({ type: 'bogus' })
    expect(await runPendingJobs({})).toBe(1)
    const [row] = await db.select().from(jobs)
    expect(row.status).toBe('failed')
    expect(row.error).toMatch(/unknown job type/)
  })

  it('passes the payload to the job fn', async () => {
    let got: unknown
    const reg: Record<string, JobFn> = {
      'fetch-player': async (p) => {
        got = p
        return 'ok'
      },
    }
    await enqueue([{ type: 'fetch-player', payload: { playerId: '77' } }])
    await runPendingJobs(reg)
    expect(got).toEqual({ playerId: '77' })
  })

  it('returns 0 on an empty queue', async () => {
    expect(await runPendingJobs({})).toBe(0)
  })
})

describe('recovery + pruning', () => {
  it('re-pends running rows (orphans from a killed process)', async () => {
    await enqueue([{ type: 'fetch-data' }])
    await db.update(jobs).set({ status: 'running', startedAt: new Date() })
    expect(await recoverOrphanedJobs()).toBe(1)
    const [row] = await db.select().from(jobs)
    expect(row.status).toBe('pending')
    expect(row.startedAt).toBeNull()
  })

  it('prunes only finished rows older than 30 days', async () => {
    const old = new Date(Date.now() - 31 * 24 * 3600 * 1000)
    await db.insert(jobs).values([
      { type: 'fetch-data', status: 'done', finishedAt: old },
      { type: 'populate-builds', status: 'done', finishedAt: new Date() },
      { type: 'request-parses', status: 'pending' },
    ])
    expect(await pruneOldJobs()).toBe(1)
    expect(await db.select().from(jobs)).toHaveLength(2)
  })
})
