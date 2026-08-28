# syntax=docker/dockerfile:1.7
# Dedicated ability-catalog refresh tooling image.
# Ships a pinned SimC CLI at /usr/local/bin/simc for admin/CLI catalog refresh.
# NOT used by api/worker scoring runtime — those images must not require SimC.
#
# Build:
#   docker build -f infra/docker/ability-catalog-refresh.Dockerfile \
#     --build-arg SIMC_GIT_REF=a060a356e16fdf266cb8b93fa4a9c892f3e26af3 \
#     -t mplus-ability-catalog-refresh:local .
#
# Runtime evidence (version/revision/WoW build/LIVE) always comes from binary
# interrogation during refresh — SIMC_GIT_REF is packaging pin only.
# Do not bake Blizzard/DB/Redis secrets into this image.

ARG NODE_VERSION=24
ARG SIMC_GIT_REF=a060a356e16fdf266cb8b93fa4a9c892f3e26af3

# -----------------------------------------------------------------------------
FROM debian:bookworm-slim AS simc-build
ARG SIMC_GIT_REF
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates git build-essential cmake libssl-dev curl \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /src
RUN git clone --depth 1 https://github.com/simulationcraft/simc.git . \
  && git fetch --depth 1 origin "${SIMC_GIT_REF}" \
  && git checkout "${SIMC_GIT_REF}"
# CLI only — no GUI / qt
WORKDIR /src/engine
RUN make -j"$(nproc)" optimized \
  && install -m 0755 simc /usr/local/bin/simc

# -----------------------------------------------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS runtime
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
RUN pnpm install --frozen-lockfile \
  && pnpm --filter @mplus/abilities run build

# Default binary path for resolveCatalogSimcBinary Linux convention.
ENV ABILITY_CATALOG_SIMC_BIN=/usr/local/bin/simc

LABEL org.opencontainers.image.title="mplus-ability-catalog-refresh" \
  org.opencontainers.image.description="Catalog refresh tooling with bundled SimulationCraft CLI"

CMD ["pnpm", "ability-catalog:simc:extract", "--", "--out", "/tmp/simc-live.json"]
