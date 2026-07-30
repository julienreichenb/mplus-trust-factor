#!/usr/bin/env bash
# Roll back application images for one environment only to an immutable SHA.
# Usage: ./rollback.sh <prod|test> <image-tag>
# Previous tag may be omitted only when releases/history.tsv has a previous column.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./env-lib.sh
source "${SCRIPT_DIR}/env-lib.sh"

resolve_mplus_env "${1:-}" || exit 2
shift || true
TARGET_TAG="${1:-}"

require_env_file
# shellcheck disable=SC1090
set -a
# shellcheck disable=SC1090
source "${ENV_FILE}"
set +a

if [[ -z "${TARGET_TAG}" ]]; then
  if [[ -f "${RELEASE_DIR}/history.tsv" ]]; then
    # history columns: timestamp, newTag, previousTag
    TARGET_TAG="$(awk -F'\t' 'END {print $3}' "${RELEASE_DIR}/history.tsv")"
  fi
fi
[[ -n "${TARGET_TAG}" && "${TARGET_TAG}" != "none" && "${TARGET_TAG}" != "null" ]] \
  || { echo "usage: rollback.sh <prod|test> <immutable-image-tag>" >&2; exit 1; }
[[ "${TARGET_TAG}" != "latest" ]] \
  || { echo "ERROR: refusing mutable tag latest" >&2; exit 1; }

export IMAGE_TAG="${TARGET_TAG}"
GHCR_OWNER="${GHCR_OWNER:?GHCR_OWNER required in env file}"
export GHCR_OWNER

echo "[rollback:${MPLUS_ENV}] rolling back ${COMPOSE_PROJECT} → ${IMAGE_TAG} (other env untouched)"

STRICT_SECRETS="${STRICT_SECRETS:-0}" IMAGE_TAG="${IMAGE_TAG}" GHCR_OWNER="${GHCR_OWNER}" \
  "${SCRIPT_DIR}/validate-env.sh" "${MPLUS_ENV}"

compose_app pull web api worker
compose_app up -d --no-deps worker
compose_app up -d --no-deps api web

# Container health (compose healthchecks use /health/ready)
HEALTH_TIMEOUT_SEC="${HEALTH_TIMEOUT_SEC:-180}"
deadline=$((SECONDS + HEALTH_TIMEOUT_SEC))
for service in worker api web; do
  echo "[rollback:${MPLUS_ENV}] waiting for ${service} healthy"
  ok=0
  while ((SECONDS < deadline)); do
    if compose_app ps --format json "${service}" 2>/dev/null | grep -q '"Health":"healthy"'; then
      ok=1
      break
    fi
    if compose_app ps "${service}" 2>/dev/null | grep -qi healthy; then
      ok=1
      break
    fi
    sleep 5
  done
  [[ "${ok}" == "1" ]] || {
    echo "[rollback:${MPLUS_ENV}] ERROR: ${service} unhealthy after rollback" >&2
    exit 1
  }
done

image="$(compose_app ps --format '{{.Image}}' api 2>/dev/null | head -n1 || true)"
if [[ "${image}" != *":${IMAGE_TAG}" ]]; then
  echo "[rollback:${MPLUS_ENV}] ERROR: api image '${image}' does not match :${IMAGE_TAG}" >&2
  exit 1
fi

# Persist IMAGE_TAG in env file so future deploys know the running SHA
"${SCRIPT_DIR}/set-image-tag.sh" "${ENV_FILE}" "${IMAGE_TAG}"

mkdir -p "${RELEASE_DIR}"
printf '%s\n' "${IMAGE_TAG}" > "${RELEASE_DIR}/current"
printf '%s\t%s\trollback\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "${IMAGE_TAG}" >> "${RELEASE_DIR}/history.tsv"

if [[ "${SKIP_PUBLIC_SMOKE:-0}" != "1" ]] && command -v curl >/dev/null 2>&1; then
  "${SCRIPT_DIR}/smoke-deploy.sh" "${MPLUS_ENV}" "${IMAGE_TAG}" "https://${APP_DOMAIN}" \
    || "${SCRIPT_DIR}/smoke-deploy.sh" "${MPLUS_ENV}" "${IMAGE_TAG}" "http://${APP_DOMAIN}" \
    || {
      echo "[rollback:${MPLUS_ENV}] ERROR: public smoke failed after rollback" >&2
      exit 1
    }
fi

echo "[rollback:${MPLUS_ENV}] complete → ${IMAGE_TAG}"
