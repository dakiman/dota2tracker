/**
 * The job registry: every pipeline job the queue runner and CLIs can
 * execute, keyed by job-type string. backup-db is NOT here — it needs
 * pg_dump and runs only in the refresh container via scripts/run-job.ts.
 */
import { run as fetchData } from './jobs/fetch-data.js'
import { run as populateBuilds } from './jobs/populate-builds.js'
import { run as fetchHeroBuilds } from './jobs/fetch-hero-builds.js'
import { run as fetchPlayerBuilds } from './jobs/fetch-player-builds.js'
import { run as requestParses } from './jobs/request-parses.js'
import { run as fetchPlayer } from './jobs/fetch-player.js'
import { run as refreshProfiles } from './jobs/refresh-profiles.js'
import type { JobPayload } from '@friendtracker/db'

export type { JobPayload }
export type JobFn = (payload: JobPayload | null) => Promise<string>

export const registry: Record<string, JobFn> = {
  'fetch-data': () => fetchData(),
  'populate-builds': () => populateBuilds(),
  'fetch-hero-builds': () => fetchHeroBuilds(),
  'fetch-player-builds': () => fetchPlayerBuilds(),
  'request-parses': () => requestParses(),
  'fetch-player': (p) => fetchPlayer(p),
  'refresh-profiles': () => refreshProfiles(),
}

export const JOB_TYPES = Object.keys(registry)
