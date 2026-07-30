#!/usr/bin/env bash
# Validate an environment .env before any compose/stack mutation.
# Usage: ./validate-env.sh <prod|test>
# Does not print secret values — only key names and pass/fail.
#
# Env:
#   STRICT_SECRETS=1  refuse CHANGE_ME* placeholders (CD / real VPS)
#   IMAGE_TAG / GHCR_OWNER overrides take precedence over the file
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./env-lib.sh
source "${SCRIPT_DIR}/env-lib.sh"

resolve_mplus_env "${1:-}" || exit 2
require_env_file || exit 1

STRICT_SECRETS="${STRICT_SECRETS:-0}"

log() { printf '[validate-env:%s] %s\n' "${MPLUS_ENV}" "$*"; }
die() { printf '[validate-env:%s] ERROR: %s\n' "${MPLUS_ENV}" "$*" >&2; exit 1; }

_PRESERVE_IMAGE_TAG="${IMAGE_TAG:-}"
_PRESERVE_GHCR_OWNER="${GHCR_OWNER:-}"

REQUIRED=(
  APP_ENV
  APP_DOMAIN
  GHCR_OWNER
  IMAGE_TAG
  POSTGRES_DB
  POSTGRES_USER
  POSTGRES_PASSWORD
  REDIS_PASSWORD
  SESSION_SECRET
  ADMIN_API_KEY
)

# Clear required keys so inherited CI/shell env cannot satisfy a missing .env entry.
# IMAGE_TAG / GHCR_OWNER may be restored after source as intentional overrides.
for _key in "${REQUIRED[@]}"; do
  unset "${_key}" || true
done

# shellcheck disable=SC1090
set -a
# shellcheck disable=SC1090
source "${ENV_FILE}"
set +a
[[ -n "${_PRESERVE_IMAGE_TAG}" ]] && IMAGE_TAG="${_PRESERVE_IMAGE_TAG}"
[[ -n "${_PRESERVE_GHCR_OWNER}" ]] && GHCR_OWNER="${_PRESERVE_GHCR_OWNER}"
export IMAGE_TAG GHCR_OWNER

MISSING=()
for key in "${REQUIRED[@]}"; do
  val="${!key:-}"
  if [[ -z "${val}" ]]; then
    MISSING+=("${key}")
  fi
done

if ((${#MISSING[@]} > 0)); then
  die "missing required variables: ${MISSING[*]}"
fi

[[ "${IMAGE_TAG}" != "latest" ]] || die "IMAGE_TAG must be an immutable git SHA (refusing 'latest')"
[[ "${IMAGE_TAG}" != "replace-with-git-sha" ]] || die "IMAGE_TAG is still the placeholder"
[[ "${#SESSION_SECRET}" -ge 32 ]] || die "SESSION_SECRET must be at least 32 characters"

if [[ "${STRICT_SECRETS}" == "1" ]]; then
  [[ "${POSTGRES_PASSWORD}" != CHANGE_ME* ]] || die "POSTGRES_PASSWORD still uses CHANGE_ME placeholder"
  [[ "${REDIS_PASSWORD}" != CHANGE_ME* ]] || die "REDIS_PASSWORD still uses CHANGE_ME placeholder"
  [[ "${ADMIN_API_KEY}" != CHANGE_ME* ]] || die "ADMIN_API_KEY still uses CHANGE_ME placeholder"
  [[ "${SESSION_SECRET}" != CHANGE_ME* ]] || die "SESSION_SECRET still uses CHANGE_ME placeholder"
fi

if [[ "${MPLUS_ENV}" == "test" && "${DATABASE_URL:-}" == *prod* && "${ALLOW_TEST_PROD_DB_URL:-}" != "1" ]]; then
  die "DATABASE_URL looks production-related (set ALLOW_TEST_PROD_DB_URL=1 to override)"
fi

compose_app config --quiet || die "docker compose config failed for ${COMPOSE_PROJECT}"

log "OK — env file valid; compose config OK"
log "IMAGE_TAG=${IMAGE_TAG} GHCR_OWNER=${GHCR_OWNER} APP_DOMAIN=${APP_DOMAIN} APP_ENV=${APP_ENV}"
