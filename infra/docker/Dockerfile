# syntax=docker/dockerfile:1.7
# Production images for M+ Trust Factor (api / worker / migrate).
# Web static assets: see Dockerfile.web
#
# Build:
#   docker build -f infra/docker/Dockerfile --target api -t mplus-api:local .
#   docker build -f infra/docker/Dockerfile --target worker -t mplus-worker:local .
#   docker build -f infra/docker/Dockerfile --target migrate -t mplus-migrate:local .

ARG NODE_VERSION=24

# -----------------------------------------------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS base
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@10.14.0 --activate
WORKDIR /app

# -----------------------------------------------------------------------------
FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./
COPY apps ./apps
COPY packages ./packages
COPY tools ./tools
COPY tsconfig.base.json tsconfig.json ./
RUN pnpm install --frozen-lockfile

# -----------------------------------------------------------------------------
FROM deps AS build
ARG APP_VERSION=0.0.0
ARG GIT_SHA=unknown
ENV APP_VERSION=${APP_VERSION}
LABEL org.opencontainers.image.revision=${GIT_SHA}

RUN pnpm --filter @mplus/database exec prisma generate
# Patch TS-source package exports to compiled dist for Node runtime
COPY infra/docker/patch-exports-for-runtime.mjs infra/docker/patch-exports-for-runtime.mjs
RUN node infra/docker/patch-exports-for-runtime.mjs
RUN pnpm -r --if-present --filter '!@mplus/web' run build

# -----------------------------------------------------------------------------
FROM base AS runtime-prep
ARG APP_VERSION=0.0.0
ARG GIT_SHA=unknown
ARG BUILD_DATE=unknown

RUN groupadd --system --gid 10001 mplus \
  && useradd --system --uid 10001 --gid mplus --home-dir /app --shell /usr/sbin/nologin mplus

COPY --from=build --chown=mplus:mplus /app /app

ENV NODE_ENV=production \
    APP_VERSION=${APP_VERSION} \
    GIT_SHA=${GIT_SHA}

LABEL org.opencontainers.image.title="mplus-trust-factor" \
      org.opencontainers.image.description="M+ Trust Factor production runtime" \
      org.opencontainers.image.version="${APP_VERSION}" \
      org.opencontainers.image.revision="${GIT_SHA}" \
      org.opencontainers.image.created="${BUILD_DATE}" \
      org.opencontainers.image.source="https://github.com/julienreichenb/mplus-trust-factor"

USER mplus
WORKDIR /app

# -----------------------------------------------------------------------------
FROM runtime-prep AS api
ENV API_HOST=0.0.0.0 \
    API_PORT=3000
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
  CMD curl -fsS "http://127.0.0.1:${API_PORT}/health/live" || exit 1
STOPSIGNAL SIGTERM
CMD ["node", "apps/api/dist/index.js"]

# -----------------------------------------------------------------------------
FROM runtime-prep AS worker
ENV WORKER_HEALTH_PORT=3001
EXPOSE 3001
HEALTHCHECK --interval=15s --timeout=5s --start-period=40s --retries=3 \
  CMD curl -fsS "http://127.0.0.1:${WORKER_HEALTH_PORT}/health/live" || exit 1
STOPSIGNAL SIGTERM
CMD ["node", "apps/worker/dist/index.js"]

# -----------------------------------------------------------------------------
FROM runtime-prep AS migrate
# One-shot migration image — never use prisma migrate reset in production.
# Invoke the local Prisma CLI directly (no pnpm/Corepack) so the non-root
# `mplus` user never needs a writable /app/.cache for Corepack.
USER root
RUN mkdir -p /var/lock/mplus && chown mplus:mplus /var/lock/mplus
USER mplus
WORKDIR /app/packages/database
CMD ["./node_modules/.bin/prisma", "migrate", "deploy"]
