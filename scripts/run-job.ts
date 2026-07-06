/**
 * Single CLI entrypoint for all pipeline jobs. Wraps each job with a
 * refresh_runs row (started/finished/ok/detail) so scheduled runs are
 * observable. Usage: tsx scripts/run-job.ts <job-name>
 */
import 'dotenv/config'
import { eq } from 'drizzle-orm'
import { db, pool, refreshRuns } from '@friendtracker/db'

type JobModule = { run: () => Promise<string> }

const JOBS: Record<string, () => Promise<JobModule>> = {
  'fetch-data': () => import('./fetch-data.js'),
  'populate-builds': () => import('./populate-builds.js'),
  'fetch-hero-builds': () => import('./fetch-hero-builds.js'),
  'fetch-player-builds': () => import('./fetch-player-builds.js'),
  'request-parses': () => import('./request-parses.js'),
  'backup-db': () => import('./backup-db.js'),
}

async function main() {
  const name = process.argv[2]
  const loader = name ? JOBS[name] : undefined
  if (!name || !loader) {
    console.error(`Usage: tsx scripts/run-job.ts <${Object.keys(JOBS).join('|')}>`)
    process.exit(2)
  }

  const [row] = await db
    .insert(refreshRuns)
    .values({ job: name })
    .returning({ id: refreshRuns.id })

  try {
    const mod = await loader()
    const summary = await mod.run()
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
