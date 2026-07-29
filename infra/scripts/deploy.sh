#!/usr/bin/env bash
# Migration-safe deploy for one isolated environment (prod|test).
# Usage: ./deploy.sh <prod|test> [--dry-run]
# Order: lock → backup → migrate → worker → api/web → health → record release
# Never runs prisma migrate reset. Never touches the other environment.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=env-lib.sh
source "${SCRIPT_DIR}/env-lib.sh"

TARGET="${1:-}"
shift || true
DRY_RUN=0
for arg in "$@"; do
  case "${arg}" in
    --dry-run) DRY_RUN=1 ;;
    *) echo "Unknown arg: ${arg}" >&2; exit 2 ;;
  esac
done

resolve_mplus_env "${TARGET}" || exit 2
require_env_file

HEALTH_TIMEOUT_SEC="${HEALTH_TIMEOUT_SEC:-180}"
SKIP_BACKUP="${SKIP_BACKUP:-0}"

log() { printf '[deploy:%s] %s\n' "${MPLUS_ENV}" "$*"; }
die() { printf '[deploy:%s] ERROR: %s\n' "${MPLUS_ENV}" "$*" >&2; exit 1; }

# shellcheck disable=SC1090
_PRESERVE_IMAGE_TAG="${IMAGE_TAG:-}"
_PRESERVE_GHCR_OWNER="${GHCR_OWNER:-}"
set -a; source "${ENV_FILE}"; set +a
[[ -n "${_PRESERVE_IMAGE_TAG}" ]] && IMAGE_TAG="${_PRESERVE_IMAGE_TAG}"
[[ -n "${_PRESERVE_GHCR_OWNER}" ]] && GHCR_OWNER="${_PRESERVE_GHCR_OWNER}"
export IMAGE_TAG GHCR_OWNER

[[ -n "${IMAGE_TAG:-}" ]] || die "IMAGE_TAG is required (immutable git SHA)"
[[ -n "${GHCR_OWNER:-}" ]] || die "GHCR_OWNER is required"
[[ -n "${APP_DOMAIN:-}" ]] || die "APP_DOMAIN is required"
[[ "${IMAGE_TAG}" != "latest" ]] || die "refusing to deploy mutable tag 'latest'"
[[ -n "${APP_ENV:-}" ]] || die "APP_ENV is required"
[[ -n "${POSTGRES_PASSWORD:-}" ]] || die "POSTGRES_PASSWORD is required"
[[ -n "${REDIS_PASSWORD:-}" ]] || die "REDIS_PASSWORD is required"

# Guard: test must not accidentally point at prod DB hostnames in URL if set explicitly
if [[ "${MPLUS_ENV}" == "test" && "${DATABASE_URL:-}" == *prod* && "${ALLOW_TEST_PROD_DB_URL:-}" != "1" ]]; then
  die "refusing test deploy: DATABASE_URL looks production-related (set ALLOW_TEST_PROD_DB_URL=1 to override)"
fi

mkdir -p "${RELEASE_DIR}" "${BACKUP_DIR}"
PREVIOUS_TAG=""
if [[ -f "${RELEASE_DIR}/current" ]]; then
  PREVIOUS_TAG="$(cat "${RELEASE_DIR}/current")"
fi

acquire_lock() {
  mkdir -p "$(dirname "${LOCK_FILE}")"
  exec 9>"${LOCK_FILE}"
  if ! flock -n 9; then
    die "another ${MPLUS_ENV} deploy holds ${LOCK_FILE}"
  fi
  log "acquired lock ${LOCK_FILE}"
}

wait_healthy() {
  local service="$1"
  local deadline=$((SECONDS + HEALTH_TIMEOUT_SEC))
  log "waiting for ${service} healthy (timeout ${HEALTH_TIMEOUT_SEC}s)"
  while (( SECONDS < deadline )); do
    local status
    status="$(compose_app ps --format json "${service}" 2>/dev/null | head -n1 || true)"
    if echo "${status}" | grep -q '"Health":"healthy"'; then
      log "${service} is healthy"
      return 0
    fi
    if compose_app ps "${service}" 2>/dev/null | grep -qi healthy; then
      log "${service} is healthy"
      return 0
    fi
    sleep 5
  done
  return 1
}

rollback_apps() {
  local tag="$1"
  [[ -n "${tag}" && "${tag}" != "none" ]] || die "no previous IMAGE_TAG to roll back (${MPLUS_ENV} only)"
  log "rolling back ${MPLUS_ENV} application images to ${tag} (other env untouched)"
  IMAGE_TAG="${tag}"
  export IMAGE_TAG
  compose_app pull web api worker || true
  compose_app up -d --no-deps --pull missing worker
  compose_app up -d --no-deps --pull missing api web
  wait_healthy worker || die "rollback worker unhealthy"
  wait_healthy api || die "rollback api unhealthy"
  wait_healthy web || die "rollback web unhealthy"
  printf '%s\n' "${tag}" > "${RELEASE_DIR}/current"
  log "rollback complete → ${tag}"
}

if [[ "${DRY_RUN}" == "1" ]]; then
  log "DRY RUN — would deploy IMAGE_TAG=${IMAGE_TAG} project=${COMPOSE_PROJECT}"
  log "env_file=${ENV_FILE} backup_dir=${BACKUP_DIR} release_dir=${RELEASE_DIR} lock=${LOCK_FILE}"
  log "compose files: ${APP_COMPOSE} + ${APP_OVERRIDE}"
  compose_app config --quiet
  log "compose config OK"
  exit 0
fi

acquire_lock
log "deploying IMAGE_TAG=${IMAGE_TAG} project=${COMPOSE_PROJECT} (previous=${PREVIOUS_TAG:-none})"

# Ensure proxy network exists (edge stack owns it)
if ! docker network inspect mplus-proxy >/dev/null 2>&1; then
  log "creating edge stack (mplus-proxy network)"
  [[ -f "${EDGE_ENV_FILE}" ]] || die "missing edge env ${EDGE_ENV_FILE} — bootstrap shared Caddy first"
  compose_edge up -d
fi

compose_app pull postgres redis web api worker
compose_app --profile migrate pull migrate || true

compose_app up -d postgres redis
wait_healthy postgres || die "postgres not healthy"
wait_healthy redis || die "redis not healthy"

if [[ "${SKIP_BACKUP}" != "1" ]]; then
  log "pre-migration backup → ${BACKUP_DIR}"
  BACKUP_REASON="pre-deploy-${IMAGE_TAG}" "${SCRIPT_DIR}/backup-postgres.sh" "${MPLUS_ENV}"
else
  log "SKIP_BACKUP=1 — skipping pre-migration backup"
fi

log "running prisma migrate deploy (one-shot, ${MPLUS_ENV} DB only)"
if ! compose_app --profile migrate run --rm migrate; then
  die "migration failed — aborting before application rollout (other env untouched)"
fi

log "rolling out worker then api/web"
compose_app up -d --no-deps worker
wait_healthy worker || {
  log "worker health failed — rolling back ${MPLUS_ENV} only"
  rollback_apps "${PREVIOUS_TAG}"
  die "worker unhealthy after deploy"
}

compose_app up -d --no-deps api web
wait_healthy api || {
  rollback_apps "${PREVIOUS_TAG}"
  die "api unhealthy after deploy"
}
wait_healthy web || {
  rollback_apps "${PREVIOUS_TAG}"
  die "web unhealthy after deploy"
}

# Public smoke for this environment's domain only
if command -v curl >/dev/null 2>&1; then
  if curl -fsSk --max-time 20 "https://${APP_DOMAIN}/health/live" >/dev/null 2>&1 \
    || curl -fsS --max-time 20 "http://${APP_DOMAIN}/health/live" >/dev/null 2>&1; then
    log "public health smoke ok (${APP_DOMAIN})"
  else
    log "WARN: public health smoke failed for ${APP_DOMAIN} (DNS/TLS may still be propagating)"
  fi
fi

printf '%s\n' "${IMAGE_TAG}" > "${RELEASE_DIR}/current"
printf '%s\t%s\t%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "${IMAGE_TAG}" "${PREVIOUS_TAG:-none}" >> "${RELEASE_DIR}/history.tsv"
cat > "${RELEASE_DIR}/manifest-${IMAGE_TAG}.json" <<EOF
{
  "environment": "${MPLUS_ENV}",
  "composeProject": "${COMPOSE_PROJECT}",
  "imageTag": "${IMAGE_TAG}",
  "previousTag": "${PREVIOUS_TAG:-null}",
  "domain": "${APP_DOMAIN}",
  "deployedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "images": {
    "api": "ghcr.io/${GHCR_OWNER}/mplus-api:${IMAGE_TAG}",
    "worker": "ghcr.io/${GHCR_OWNER}/mplus-worker:${IMAGE_TAG}",
    "web": "ghcr.io/${GHCR_OWNER}/mplus-web:${IMAGE_TAG}",
    "migrate": "ghcr.io/${GHCR_OWNER}/mplus-migrate:${IMAGE_TAG}"
  }
}
EOF

log "deploy complete → ${IMAGE_TAG} (${COMPOSE_PROJECT})"
