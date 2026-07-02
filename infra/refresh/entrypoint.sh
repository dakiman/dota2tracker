#!/bin/sh
# Run one cheap sync on container start (idempotent, ~10 API calls) so a
# fresh deploy is never stale until the first cron tick, then hand off to
# crond as PID 1 (exec => clean SIGTERM handling).
cd /app
./node_modules/.bin/tsx scripts/run-job.ts fetch-data || echo "initial fetch-data failed; cron will retry"
./node_modules/.bin/tsx scripts/run-job.ts populate-builds || echo "initial populate-builds failed; cron will retry"
exec crond -f -l 2
