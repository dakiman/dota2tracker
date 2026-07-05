/** Matches friendtracker-YYYY-MM-DD.dump */
export const DUMP_RE = /^friendtracker-(\d{4}-\d{2}-\d{2})\.dump$/

const DAY_MS = 24 * 3600 * 1000

/**
 * Names of dump files older than keepDays relative to `now`. Filenames that
 * don't match DUMP_RE are never returned — foreign files are never deleted.
 */
export function filesToDelete(names: string[], now: Date, keepDays: number): string[] {
  const cutoff = now.getTime() - keepDays * DAY_MS
  return names.filter((n) => {
    const m = DUMP_RE.exec(n)
    if (!m) return false
    return new Date(`${m[1]}T00:00:00Z`).getTime() < cutoff
  })
}
