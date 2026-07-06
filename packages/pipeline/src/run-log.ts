import { eq } from 'drizzle-orm'
import { db, refreshRuns } from '@friendtracker/db'

export type RunResult = { ok: true; summary: string } | { ok: false; error: string }

/**
 * Brackets a job with a refresh_runs row (started/finished/ok/detail) —
 * the single logging story for cron CLIs and the API poller alike.
 * Never throws; failures come back as { ok: false }.
 */
export async function withRunLog(name: string, fn: () => Promise<string>): Promise<RunResult> {
  const [row] = await db.insert(refreshRuns).values({ job: name }).returning({ id: refreshRuns.id })
  try {
    const summary = await fn()
    await db
      .update(refreshRuns)
      .set({ finishedAt: new Date(), ok: true, detail: { summary } })
      .where(eq(refreshRuns.id, row.id))
    return { ok: true, summary }
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    await db
      .update(refreshRuns)
      .set({ finishedAt: new Date(), ok: false, detail: { error } })
      .where(eq(refreshRuns.id, row.id))
    return { ok: false, error }
  }
}
