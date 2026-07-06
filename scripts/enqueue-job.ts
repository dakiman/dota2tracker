/**
 * Enqueue pipeline jobs for the API's in-process poller. Used by the
 * refresh container's cron lines and entrypoint self-heal; dedup (pending
 * rows only) makes re-enqueueing over a backlog a silent no-op.
 * Usage: tsx scripts/enqueue-job.ts <job-type> [<job-type> ...]
 */
import 'dotenv/config'
import { pool } from '@friendtracker/db'
import { enqueue, JOB_TYPES } from '@friendtracker/pipeline'

async function main() {
  const names = process.argv.slice(2)
  if (names.length === 0 || names.some((n) => !JOB_TYPES.includes(n))) {
    console.error(`Usage: tsx scripts/enqueue-job.ts <${JOB_TYPES.join('|')} ...>`)
    process.exit(2)
  }
  const inserted = await enqueue(names.map((type) => ({ type })))
  console.log(
    `[enqueue-job] enqueued ${inserted}/${names.length} (${names.length - inserted} already pending)`
  )
  await pool.end()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
