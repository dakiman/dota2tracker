FROM node:22-alpine AS builder
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9 --activate
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/web apps/web
# apps/api is not built here, but its package.json must exist for the
# lockfile importer check to pass with --frozen-lockfile
COPY apps/api/package.json apps/api/package.json
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @friendtracker/shared build
WORKDIR /app/apps/web
RUN pnpm build

FROM nginx:alpine
COPY --from=builder /app/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
