/**
 * Single CLI entrypoint for all pipeline jobs. Wraps each job with a
 * refresh_runs row (started/finished/ok/detail) so scheduled runs are
 * observable. Usage: tsx scripts/run-job.ts <job-name>
 */
import 'dotenv/config'
import { eq } from 'drizzle-orm'
import { db, pool, refreshRuns } from '@friendtracker/db'
import { registry, type JobFn } from '@friendtracker/pipeline'

const JOBS: Record<string, JobFn> = {
  ...registry,
  'backup-db': async () => (await import('./backup-db.js')).run(),
}

async function main() {
  const name = process.argv[2]
  const job = name ? JOBS[name] : undefined
  if (!name || !job) {
    console.error(`Usage: tsx scripts/run-job.ts <${Object.keys(JOBS).join('|')}>`)
    process.exit(2)
  }

  const [row] = await db
    .insert(refreshRuns)
    .values({ job: name })
    .returning({ id: refreshRuns.id })

  try {
    const summary = await job(null)
    await db
      .update(refreshRuns)
      .set({ finishedAt: new Date(), ok: true, detail: { summary } })
      .where(eq(refreshRuns.id, row.id))
    console.log(`[run-job] ${name} ok: ${summary}`)
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    await db
      .update(refreshRuns)
      .set({ finishedAt: new Date(), ok: false, detail: { error } })
      .where(eq(refreshRuns.id, row.id))
    console.error(`[run-job] ${name} FAILED: ${error}`)
    process.exitCode = 1
  } finally {
    await pool.end()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
