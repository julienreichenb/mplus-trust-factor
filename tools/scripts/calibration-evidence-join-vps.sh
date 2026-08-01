#!/usr/bin/env bash
# Server-side Agent 11 evidence join — Docker-network aware (test only).
#
# Does NOT modify /opt/mplus/test, publish Postgres, migrate, call providers,
# enqueue refreshes, or restart services.
#
# Usage (on the test VPS):
#   bash tools/scripts/calibration-evidence-join-vps.sh
#   bash tools/scripts/calibration-evidence-join-vps.sh /tmp/mplus-agent11-calibration-XXXX
#
# Requires: docker, a temporary git worktree of agent/11-scoring-calibration-study,
# and /opt/mplus/test/.env (sourced into the process only).
set -euo pipefail

COMPOSE_PROJECT="${COMPOSE_PROJECT:-mplus-test}"
MPLUS_ROOT="${MPLUS_ROOT:-/opt/mplus}"
ENV_FILE="${ENV_FILE:-${MPLUS_ROOT}/test/.env}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WORKTREE="${1:-$REPO_ROOT}"
NODE_IMAGE="${CALIBRATION_NODE_IMAGE:-node:22-bookworm}"

die() { printf 'calibration-evidence-join-vps ERROR: %s\n' "$*" >&2; exit 1; }
log() { printf 'calibration-evidence-join-vps: %s\n' "$*"; }

[[ -f "${ENV_FILE}" ]] || die "missing ${ENV_FILE}"
[[ -d "${WORKTREE}" ]] || die "worktree not found: ${WORKTREE}"
[[ -f "${WORKTREE}/doc/scoring/cohorts/agent11-2026-08-01/resolved.v1.json" ]] \
  || die "resolved.v1.json missing in worktree (checkout agent/11-scoring-calibration-study first)"

# Refuse accidental use against production compose project.
[[ "${COMPOSE_PROJECT}" == "mplus-test" ]] || die "COMPOSE_PROJECT must be mplus-test (got ${COMPOSE_PROJECT})"

# Load test env into this shell only (never write credentials into the worktree).
set -a
# shellcheck disable=SC1090
source "${ENV_FILE}"
set +a

[[ -n "${DATABASE_URL:-}" ]] || die "DATABASE_URL missing after sourcing ${ENV_FILE}"

export CALIBRATION_EVIDENCE_ENV=test
export CALIBRATION_EVIDENCE_DATABASE_URL="${DATABASE_URL}"
export ALLOW_LIVE_PROVIDER_CALLS=false

# Sanitize preview (no user/password) before any query.
node -e '
const u=new URL(process.env.CALIBRATION_EVIDENCE_DATABASE_URL);
const db=decodeURIComponent(u.pathname.replace(/^\//,"").split("?")[0]||"");
const port=u.port||"5432";
const host=u.hostname;
if (/prod|production|mplus-prod|mplus_trust_prod/i.test(host+"/"+db)) {
  console.error("REFUSED: production-looking target", host, db);
  process.exit(2);
}
console.log("evidenceDbTarget: hostname="+host+" port="+port+" database="+db);
console.log("CALIBRATION_EVIDENCE_ENV="+process.env.CALIBRATION_EVIDENCE_ENV);
'

# Discover the Docker-only app network attached to test postgres (no public publish).
if ! docker compose -p "${COMPOSE_PROJECT}" ps postgres >/dev/null 2>&1; then
  die "docker compose project ${COMPOSE_PROJECT} postgres not reachable via docker CLI"
fi

PG_CID="$(docker compose -p "${COMPOSE_PROJECT}" ps -q postgres | head -n1)"
[[ -n "${PG_CID}" ]] || die "postgres container id empty for ${COMPOSE_PROJECT}"

APP_NET="$(docker inspect -f '{{range $k, $_ := .NetworkSettings.Networks}}{{println $k}}{{end}}' "${PG_CID}" \
  | awk 'NF{print; exit}')"
[[ -n "${APP_NET}" ]] || die "could not resolve Docker network for postgres ${PG_CID}"

# Prefer the compose app network (mplus-test_app). Reject proxy-only attachment.
if [[ "${APP_NET}" == "mplus-proxy" ]]; then
  # Fall back: list networks and pick *mplus-test*_app
  APP_NET="$(docker inspect -f '{{range $k, $_ := .NetworkSettings.Networks}}{{println $k}}{{end}}' "${PG_CID}" \
    | awk '/_app$/ {print; exit}')"
fi
[[ "${APP_NET}" == *mplus-test* ]] || die "refusing network '${APP_NET}' (expected mplus-test app network)"
[[ "${APP_NET}" != *mplus-prod* ]] || die "refusing production network '${APP_NET}'"

log "compose_project=${COMPOSE_PROJECT}"
log "postgres_cid=${PG_CID}"
log "docker_network=${APP_NET}"
log "worktree=${WORKTREE}"

# If DATABASE_URL host is Docker-DNS (postgres), we MUST run inside the network.
DB_HOST="$(node -e 'console.log(new URL(process.env.CALIBRATION_EVIDENCE_DATABASE_URL).hostname)')"
if [[ "${DB_HOST}" == "postgres" || "${DB_HOST}" == *"_postgres"* ]]; then
  log "DATABASE_URL host '${DB_HOST}' is Docker-only — using ephemeral container on ${APP_NET}"
  docker run --rm \
    --network "${APP_NET}" \
    -v "${WORKTREE}:/workspace" \
    -w /workspace \
    -e CALIBRATION_EVIDENCE_ENV=test \
    -e ALLOW_LIVE_PROVIDER_CALLS=false \
    -e "CALIBRATION_EVIDENCE_DATABASE_URL=${CALIBRATION_EVIDENCE_DATABASE_URL}" \
    -e "SCORE_TTL_SECONDS=${SCORE_TTL_SECONDS:-604800}" \
    "${NODE_IMAGE}" \
    bash -lc '
      set -euo pipefail
      corepack enable
      corepack prepare pnpm@10.14.0 --activate
      pnpm install --frozen-lockfile
      pnpm calibration:evidence-join -- --preflight-only
    '
else
  log "DATABASE_URL host '${DB_HOST}' looks host-reachable — running in worktree on VPS host"
  cd "${WORKTREE}"
  pnpm install --frozen-lockfile
  pnpm calibration:evidence-join -- --preflight-only
fi

log "done — copy tmp/calibration/agent11-2026-08-01/evidence-join.* back (no .env)"
