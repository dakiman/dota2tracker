FROM node:22-alpine AS builder
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9 --activate
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api
COPY scripts scripts
# apps/web is not built here, but its package.json must exist for the
# lockfile importer check to pass with --frozen-lockfile
COPY apps/web/package.json apps/web/package.json
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @friendtracker/shared build && pnpm --filter api build

FROM node:22-alpine
WORKDIR /app
COPY --from=builder /app .
ENV NODE_ENV=production
WORKDIR /app/apps/api
EXPOSE 3000
CMD ["node", "dist/index.js"]
