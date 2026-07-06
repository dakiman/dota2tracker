#!/bin/sh
# Enqueue one cheap sync on container start (idempotent — pending dedup) so
# a fresh deploy is never stale until the first cron tick, then hand off to
# crond as PID 1 (exec => clean SIGTERM handling). The API poller executes.
cd /app
./node_modules/.bin/tsx scripts/enqueue-job.ts fetch-data populate-builds || echo "initial enqueue failed; cron will retry"
exec crond -f -l 2
