import { sql } from 'drizzle-orm'
import { db, type JobPayload } from '@friendtracker/db'
import { registry, type JobFn } from './registry.js'
import { withRunLog } from './run-log.js'

type ClaimedJob = { id: number; type: string; payload: JobPayload | null }

/** Claim the oldest pending job. Single-process today; SKIP LOCKED is free
 *  correctness insurance if that ever changes. */
async function claimNext(): Promise<ClaimedJob | null> {
  const res = await db.execute(sql`
    UPDATE jobs SET status = 'running', started_at = now()
    WHERE id = (
      SELECT id FROM jobs WHERE status = 'pending'
      ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED
    )
    RETURNING id, type, payload
  `)
  return (res.rows[0] as ClaimedJob | undefined) ?? null
}

/**
 * Drain the queue serially in id order. Each job is bracketed with a
 * refresh_runs row, then its queue row is marked done/failed. No retries —
 * the 6h cron re-enqueues the same job types, which is the retry.
 * Returns the number of jobs processed. `reg` is injectable for tests.
 */
export async function runPendingJobs(reg: Record<string, JobFn> = registry): Promise<number> {
  let processed = 0
  for (;;) {
    const job = await claimNext()
    if (!job) return processed
    processed++
    const fn = reg[job.type]
    const result = fn
      ? await withRunLog(job.type, () => fn(job.payload))
      : ({ ok: false, error: `unknown job type: ${job.type}` } as const)
    await db.execute(sql`
      UPDATE jobs SET status = ${result.ok ? 'done' : 'failed'},
        error = ${result.ok ? null : result.error},
        finished_at = now()
      WHERE id = ${job.id}
    `)
  }
}

/** Any 'running' row at boot is an orphan from a killed process — with a
 *  single executor and idempotent jobs, re-pending is always safe. */
export async function recoverOrphanedJobs(): Promise<number> {
  const res = await db.execute(
    sql`UPDATE jobs SET status = 'pending', started_at = NULL WHERE status = 'running'`
  )
  return res.rowCount ?? 0
}

/** Queue rows are disposable; refresh_runs is the permanent history. */
export async function pruneOldJobs(): Promise<number> {
  const res = await db.execute(
    sql`DELETE FROM jobs WHERE status IN ('done', 'failed') AND finished_at < now() - interval '30 days'`
  )
  return res.rowCount ?? 0
}
