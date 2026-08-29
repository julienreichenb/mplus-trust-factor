# syntax=docker/dockerfile:1.7
# Ability Catalog source-sync one-shot image.
# Ships pinned SimC at /usr/local/bin/simc + Node sync CLI.
# NOT used by api/worker/web/migrate scoring runtime.
#
# Build:
#   docker build -f infra/docker/ability-catalog-refresh.Dockerfile \
#     --build-arg SIMC_GIT_REF=a060a356e16fdf266cb8b93fa4a9c892f3e26af3 \
#     --build-arg APP_VERSION=local \
#     -t mplus-catalog-sync:local .
#
# Run (compose profile):
#   docker compose -f infra/docker/docker-compose.app.yml --profile catalog-sync run --rm catalog-sync
#
# Runtime SimC identity always comes from binary interrogation.
# SIMC_GIT_REF is packaging pin only. Do not bake secrets into this image.

ARG NODE_VERSION=24
ARG SIMC_GIT_REF=a060a356e16fdf266cb8b93fa4a9c892f3e26af3
ARG APP_VERSION=0.0.0
ARG GIT_SHA=unknown

# -----------------------------------------------------------------------------
FROM debian:bookworm-slim AS simc-build
ARG SIMC_GIT_REF
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates git build-essential cmake libssl-dev libcurl4-openssl-dev curl \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /src
RUN git clone --depth 1 https://github.com/simulationcraft/simc.git . \
  && git fetch --depth 1 origin "${SIMC_GIT_REF}" \
  && git checkout "${SIMC_GIT_REF}"
WORKDIR /src/engine
RUN make -j"$(nproc)" optimized \
  && install -m 0755 simc /usr/local/bin/simc

# -----------------------------------------------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS runtime
ARG APP_VERSION
ARG GIT_SHA
ENV APP_VERSION=${APP_VERSION}
LABEL org.opencontainers.image.revision=${GIT_SHA}

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@10.14.0 --activate
WORKDIR /app

COPY --from=simc-build /usr/local/bin/simc /usr/local/bin/simc
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./
COPY apps ./apps
COPY packages ./packages
COPY tools ./tools
COPY tsconfig.base.json tsconfig.json ./
COPY infra/docker/patch-exports-for-runtime.mjs infra/docker/patch-exports-for-runtime.mjs

RUN pnpm install --frozen-lockfile \
  && pnpm --filter @mplus/database exec prisma generate \
  && node infra/docker/patch-exports-for-runtime.mjs \
  && pnpm -r --if-present --filter '!@mplus/web' run build
# Sync CLI entrypoint uses tsx; packages above provide compiled workspace deps.

ENV ABILITY_CATALOG_SIMC_BIN=/usr/local/bin/simc
ENV NODE_ENV=production

LABEL org.opencontainers.image.title="mplus-catalog-sync" \
  org.opencontainers.image.description="One-shot Ability Catalog source sync with bundled SimulationCraft CLI"

# Default: complete source sync (SimC + Blizzard → import). Never publishes.
# Env comes from compose/env_file — do not use with-env.mjs here.
CMD ["pnpm", "--filter", "@mplus/api", "exec", "tsx", "src/cli/catalog-sync.ts"]
