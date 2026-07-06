/**
 * In-process job poller — the single executor for all pipeline jobs.
 * Serial by construction: one tick drains the whole queue; overlapping
 * ticks no-op on the in-flight guard. The interval is .unref()ed so it
 * never holds the process open (graceful-shutdown constraint).
 */
import { recoverOrphanedJobs, pruneOldJobs, runPendingJobs } from '@friendtracker/pipeline'

const POLL_MS = 5_000
const SHUTDOWN_GRACE_MS = 5_000

let interval: NodeJS.Timeout | null = null
let inFlight: Promise<void> | null = null

export async function startPoller(): Promise<void> {
  const recovered = await recoverOrphanedJobs()
  if (recovered > 0) console.log(`[poller] re-pended ${recovered} orphaned job(s)`)
  const pruned = await pruneOldJobs()
  if (pruned > 0) console.log(`[poller] pruned ${pruned} old job row(s)`)

  interval = setInterval(() => {
    if (inFlight) return
    inFlight = runPendingJobs()
      .then((n) => {
        if (n > 0) console.log(`[poller] processed ${n} job(s)`)
      })
      .catch((e) => console.error('[poller] tick failed:', e))
      .finally(() => {
        inFlight = null
      })
  }, POLL_MS)
  interval.unref()
  console.log(`[poller] polling every ${POLL_MS / 1000}s`)
}

/**
 * Stop ticking, give an in-flight job a short grace, then return. A job
 * outliving the grace is abandoned — process exit kills it and boot
 * recovery re-pends its row (all jobs are idempotent upserts).
 */
export async function stopPoller(): Promise<void> {
  if (interval) clearInterval(interval)
  interval = null
  if (inFlight) {
    await Promise.race([
      inFlight,
      new Promise<void>((resolve) => {
        setTimeout(resolve, SHUTDOWN_GRACE_MS).unref()
      }),
    ])
  }
}
