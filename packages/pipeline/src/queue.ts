import { db, jobs, type JobPayload } from '@friendtracker/db'
import { registry } from './registry.js'

/**
 * Insert queue rows one by one, in order (serial ids = execution order).
 * The pending-dedup unique index turns duplicates into silent no-ops.
 * Returns how many rows were actually inserted.
 */
export async function enqueue(
  items: Array<{ type: string; payload?: JobPayload }>
): Promise<number> {
  let inserted = 0
  for (const item of items) {
    if (!(item.type in registry)) throw new Error(`unknown job type: ${item.type}`)
    const rows = await db
      .insert(jobs)
      .values({ type: item.type, payload: item.payload ?? null })
      .onConflictDoNothing()
      .returning({ id: jobs.id })
    inserted += rows.length
  }
  return inserted
}
