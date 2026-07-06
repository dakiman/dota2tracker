/**
 * Single CLI entrypoint for direct (non-queued) job runs: manual dev runs
 * and the refresh container's backup-db cron line. Queued execution goes
 * through the API poller instead. Usage: tsx scripts/run-job.ts <job-name>
 */
import 'dotenv/config'
import { pool } from '@friendtracker/db'
import { registry, withRunLog, type JobFn } from '@friendtracker/pipeline'

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

  const result = await withRunLog(name, () => job(null))
  if (result.ok) {
    console.log(`[run-job] ${name} ok: ${result.summary}`)
  } else {
    console.error(`[run-job] ${name} FAILED: ${result.error}`)
    process.exitCode = 1
  }
  await pool.end()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
