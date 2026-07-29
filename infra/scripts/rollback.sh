#!/usr/bin/env bash
# Roll back application images for one environment only.
# Usage: ./rollback.sh <prod|test> [image-tag]
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
    TARGET_TAG="$(awk -F'\t' 'END {print $3}' "${RELEASE_DIR}/history.tsv")"
  fi
fi
[[ -n "${TARGET_TAG}" && "${TARGET_TAG}" != "none" && "${TARGET_TAG}" != "null" ]] \
  || { echo "usage: rollback.sh <prod|test> <image-tag>" >&2; exit 1; }

export IMAGE_TAG="${TARGET_TAG}"
echo "[rollback:${MPLUS_ENV}] rolling back ${COMPOSE_PROJECT} → ${IMAGE_TAG} (other env untouched)"

compose_app pull web api worker
compose_app up -d --no-deps worker
compose_app up -d --no-deps api web

mkdir -p "${RELEASE_DIR}"
printf '%s\n' "${IMAGE_TAG}" > "${RELEASE_DIR}/current"
printf '%s\t%s\trollback\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "${IMAGE_TAG}" >> "${RELEASE_DIR}/history.tsv"
echo "[rollback:${MPLUS_ENV}] complete"
