# syntax=docker/dockerfile:1.7
# Build context: REPO ROOT  (docker build -f apps/api/Dockerfile .)
ARG NODE_VERSION=22

FROM node:${NODE_VERSION}-alpine AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
RUN apk add --no-cache openssl libc6-compat
# Version comes from root package.json "packageManager" (pnpm@11.25.0)
RUN corepack enable
WORKDIR /app

FROM base AS build
COPY . .
RUN corepack prepare --activate >/dev/null 2>&1 || true
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter api...
# Prisma client generation (no-op if the api has no prisma schema yet)
RUN cd apps/api && if [ -d prisma ] || [ -f prisma.config.ts ]; then pnpm exec prisma generate; fi
RUN pnpm --filter api build

# Runtime: keep the installed workspace (includes prisma CLI for `migrate deploy`)
# and the generated client. Simple and robust to Prisma layout changes.
FROM base AS runtime
ENV NODE_ENV=production PORT=3000
COPY --from=build /app /app
COPY apps/api/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh \
    && chown -R node:node /app
USER node
WORKDIR /app/apps/api
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=30s --retries=5 \
  CMD wget -qO- http://127.0.0.1:${PORT:-3000}/api/health || exit 1
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "dist/main"]
