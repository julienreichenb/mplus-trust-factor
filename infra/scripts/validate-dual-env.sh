#!/usr/bin/env bash
# Validate dual-environment compose + deploy dry-runs locally (no real VPS).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
# shellcheck source=./env-lib.sh
source "${SCRIPT_DIR}/env-lib.sh"

export MPLUS_ROOT="${ROOT_DIR}/infra/deploy"
DEPLOY_STUB="${MPLUS_ROOT}"

log() { printf '[validate] %s\n' "$*"; }
die() { printf '[validate] ERROR: %s\n' "$*" >&2; exit 1; }

# Ensure stub env files exist for config interpolation
mkdir -p "${DEPLOY_STUB}/prod" "${DEPLOY_STUB}/test" "${DEPLOY_STUB}/shared/caddy" \
  "${DEPLOY_STUB}/prod/backups" "${DEPLOY_STUB}/test/backups" \
  "${DEPLOY_STUB}/prod/releases" "${DEPLOY_STUB}/test/releases"

for env in prod test; do
  src="${ROOT_DIR}/infra/deploy/${env}/.env.example"
  dst="${DEPLOY_STUB}/${env}/.env"
  if [[ ! -f "${dst}" ]]; then
    # Normalize CRLF so bash can source on Windows/WSL checkouts
    tr -d '\r' < "${src}" > "${dst}"
  fi
done
if [[ ! -f "${DEPLOY_STUB}/shared/caddy/.env" ]]; then
  tr -d '\r' < "${ROOT_DIR}/infra/deploy/shared/caddy/.env.example" > "${DEPLOY_STUB}/shared/caddy/.env"
fi

log "edge compose config"
docker compose -p mplus-edge \
  -f "${ROOT_DIR}/infra/docker/docker-compose.edge.yml" \
  --env-file "${DEPLOY_STUB}/shared/caddy/.env" \
  config --quiet

for env in prod test; do
  resolve_mplus_env "${env}"
  log "app compose config (${COMPOSE_PROJECT})"
  compose_app config --quiet

  CFG="$(compose_app config)"
  if echo "${CFG}" | grep -qi "ports:"; then
    # App stacks must not publish host ports (edge owns 80/443 only)
    if echo "${CFG}" | grep -E 'published:|"80:|"443:|"5432:|"6379:|"3000:|"3001:|"8080:' | grep -v caddy; then
      die "${env}: unexpected published ports in app stack"
    fi
  fi

  # Ensure no host port bindings on postgres/redis in rendered config
  if echo "${CFG}" | awk '/^  postgres:/{p=1} /^  [a-z]/{if($1!="postgres:")p=0} p && /published:/' | grep -q .; then
    die "${env}: postgres publishes a host port"
  fi
  if echo "${CFG}" | awk '/^  redis:/{p=1} /^  [a-z]/{if($1!="redis:")p=0} p && /published:/' | grep -q .; then
    die "${env}: redis publishes a host port"
  fi
  if ! echo "${CFG}" | grep -q 'noeviction'; then
    die "${env}: redis maxmemory-policy must be noeviction for BullMQ"
  fi
  if echo "${CFG}" | grep -q 'allkeys-lru'; then
    die "${env}: redis must not use allkeys-lru (BullMQ requires noeviction)"
  fi

  log "validate-env (${env})"
  IMAGE_TAG=deadbeefcafebabe1234567890abcdef12345678 \
    STRICT_SECRETS=0 \
    "${SCRIPT_DIR}/validate-env.sh" "${env}"

  log "deploy dry-run (${env})"
  IMAGE_TAG=deadbeefcafebabe1234567890abcdef12345678 \
    STRICT_SECRETS=0 \
    "${SCRIPT_DIR}/deploy.sh" "${env}" --dry-run
done

log "invalid env must fail before deploy"
BAD_ENV="${DEPLOY_STUB}/test/.env.invalid-missing"
cp "${DEPLOY_STUB}/test/.env" "${BAD_ENV}"
# Remove a required key from the file under test
grep -vE '^SESSION_SECRET=' "${BAD_ENV}" > "${BAD_ENV}.tmp" && mv "${BAD_ENV}.tmp" "${BAD_ENV}"
# Isolate from inherited CI/shell secrets (SESSION_SECRET is exported by GitHub Actions).
# Only this negative invocation unsets secrets — valid prod/test checks above keep process env.
# IMAGE_TAG override is intentional; other required keys must come from BAD_ENV after source.
if env -u SESSION_SECRET -u ADMIN_API_KEY -u POSTGRES_PASSWORD -u REDIS_PASSWORD \
  ENV_FILE_OVERRIDE="${BAD_ENV}" \
  IMAGE_TAG=deadbeefcafebabe1234567890abcdef12345678 \
  STRICT_SECRETS=0 \
  "${SCRIPT_DIR}/validate-env.sh" test; then
  rm -f "${BAD_ENV}" "${BAD_ENV}.tmp"
  die "validate-env should have failed without SESSION_SECRET"
fi
rm -f "${BAD_ENV}" "${BAD_ENV}.tmp"
log "invalid env correctly failed"

log "set-image-tag updates file"
TAG_FILE="${DEPLOY_STUB}/test/.env"
BEFORE_TAG="$(grep -E '^IMAGE_TAG=' "${TAG_FILE}" | head -n1 | cut -d= -f2-)"
"${SCRIPT_DIR}/set-image-tag.sh" "${TAG_FILE}" "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
grep -qE '^IMAGE_TAG=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa$' "${TAG_FILE}" || die "set-image-tag failed"
"${SCRIPT_DIR}/set-image-tag.sh" "${TAG_FILE}" "${BEFORE_TAG:-deadbeefcafebabe1234567890abcdef12345678}"
rm -f "${TAG_FILE}.bak"

log "rollback usage rejects latest"
if "${SCRIPT_DIR}/rollback.sh" test latest 2>/dev/null; then
  die "rollback should refuse latest"
fi
log "rollback correctly refused latest"

log "distinct project names"
resolve_mplus_env prod
[[ "${COMPOSE_PROJECT}" == "mplus-prod" ]] || die "prod project"
resolve_mplus_env test
[[ "${COMPOSE_PROJECT}" == "mplus-test" ]] || die "test project"
[[ "${LOCK_FILE}" == *mplus-test* ]] || die "test lock isolation"
resolve_mplus_env prod
[[ "${LOCK_FILE}" == *mplus-prod* ]] || die "prod lock isolation"
[[ "${BACKUP_DIR}" != "$(resolve_mplus_env test >/dev/null; echo "${BACKUP_DIR}")" ]] || true

log "different IMAGE_TAG dry-runs"
IMAGE_TAG=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
  STRICT_SECRETS=0 \
  "${SCRIPT_DIR}/deploy.sh" prod --dry-run
IMAGE_TAG=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb \
  STRICT_SECRETS=0 \
  "${SCRIPT_DIR}/deploy.sh" test --dry-run

log "simulate: test failure must not touch prod release dir"
PROD_REL="${DEPLOY_STUB}/prod/releases"
TEST_REL="${DEPLOY_STUB}/test/releases"
echo "prod-sentinel" > "${PROD_REL}/current"
echo "test-old" > "${TEST_REL}/current"
BEFORE="$(cat "${PROD_REL}/current")"
# Only verify isolation of paths — do not run a failing live deploy
[[ -f "${PROD_REL}/current" && "$(cat "${PROD_REL}/current")" == "${BEFORE}" ]] || die "prod release mutated"
[[ "${PROD_REL}" != "${TEST_REL}" ]] || die "shared release dir"

log "PASS — dual-environment validation"
