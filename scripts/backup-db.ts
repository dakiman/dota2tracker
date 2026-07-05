/**
 * Nightly pg_dump of DATABASE_URL to BACKUP_DIR (custom format, so
 * pg_restore can do selective restores), pruning dumps older than
 * BACKUP_KEEP_DAYS. Runs via: tsx scripts/run-job.ts backup-db
 * Requires pg_dump >= the server major (postgresql16-client in the image).
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, readdir, stat, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { filesToDelete } from './lib/backup-rotation.js'

const execFileP = promisify(execFile)

export async function run(): Promise<string> {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set')
  const dir = process.env.BACKUP_DIR ?? '/backups'
  const keepDays = Number(process.env.BACKUP_KEEP_DAYS) || 7
  const stamp = new Date().toISOString().slice(0, 10)
  const file = join(dir, `friendtracker-${stamp}.dump`)

  await mkdir(dir, { recursive: true })
  await execFileP('pg_dump', ['--format=custom', '--file', file, '--dbname', url])
  const { size } = await stat(file)
  // Sanity floor: a real dump of this DB is far larger; a truncated/empty
  // dump must fail the run so refresh_runs shows it.
  if (size < 10_000) throw new Error(`dump suspiciously small: ${size} bytes`)

  const stale = filesToDelete(await readdir(dir), new Date(), keepDays)
  await Promise.all(stale.map((f) => unlink(join(dir, f))))
  return `wrote ${file} (${size} bytes), pruned ${stale.length} old dump(s)`
}
