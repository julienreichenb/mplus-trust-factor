#!/usr/bin/env bash
# Post-deploy environment smoke checks (public surface only).
# Usage: ./smoke-deploy.sh <prod|test> [expected-image-tag] [public-base-url]
#
# Checks:
#   1. /health/ready → HTTP 200
#   2. /api/v1/meta version matches expected IMAGE_TAG (revision gate)
# Never prints secrets. Failures are explicit.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./env-lib.sh
source "${SCRIPT_DIR}/env-lib.sh"

resolve_mplus_env "${1:-}" || exit 2
EXPECTED_TAG="${2:-}"
PUBLIC_URL="${3:-}"

require_env_file
# shellcheck disable=SC1090
set -a
# shellcheck disable=SC1090
source "${ENV_FILE}"
set +a

if [[ -z "${EXPECTED_TAG}" ]]; then
  EXPECTED_TAG="${IMAGE_TAG:-}"
fi
[[ -n "${EXPECTED_TAG}" ]] || {
  echo "[smoke:${MPLUS_ENV}] ERROR: expected IMAGE_TAG required" >&2
  exit 1
}

if [[ -z "${PUBLIC_URL}" ]]; then
  PUBLIC_URL="https://${APP_DOMAIN}"
fi
# Trim trailing slash
PUBLIC_URL="${PUBLIC_URL%/}"

log() { printf '[smoke:%s] %s\n' "${MPLUS_ENV}" "$*"; }
die() { printf '[smoke:%s] ERROR: %s\n' "${MPLUS_ENV}" "$*" >&2; exit 1; }

log "ready probe → ${PUBLIC_URL}/health/ready"
"${SCRIPT_DIR}/health-wait.sh" "${PUBLIC_URL}/health/ready" "${HEALTH_TIMEOUT_SEC:-180}"

log "revision probe → ${PUBLIC_URL}/api/v1/meta (expect version=${EXPECTED_TAG})"
"${SCRIPT_DIR}/health-wait.sh" "${PUBLIC_URL}/api/v1/meta" 60 --expect-json-field version "${EXPECTED_TAG}"

# Lightweight web shell check (HTML index)
if curl -fsSk --max-time 20 "${PUBLIC_URL}/" -o /dev/null; then
  log "web shell OK (${PUBLIC_URL}/)"
else
  die "web shell failed (${PUBLIC_URL}/)"
fi

log "PASS — ready + revision ${EXPECTED_TAG} + web shell"
