# Scheduled data-refresh runner: full pnpm workspace + tsx so the pipeline
# scripts run from source. Deliberately not size-optimized — this image is
# not on the serving path. BusyBox crond (built into alpine) is PID 1.
FROM node:22-alpine
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9 --activate
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN pnpm install --frozen-lockfile \
  && rm -rf /root/.cache /root/.local/share/pnpm /root/.npm
RUN pnpm --filter @friendtracker/shared build
COPY apps/api/src/db apps/api/src/db
COPY scripts scripts
COPY infra/refresh/crontab /etc/crontabs/root
COPY infra/refresh/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
CMD ["/entrypoint.sh"]
