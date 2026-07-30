#!/usr/bin/env bash
# Set IMAGE_TAG in an env file atomically (no secret echo).
# Usage: ./set-image-tag.sh <env-file> <sha>
set -euo pipefail

ENV_FILE="${1:?usage: set-image-tag.sh <env-file> <sha>}"
TAG="${2:?}"

[[ -f "${ENV_FILE}" ]] || {
  echo "ERROR: missing env file ${ENV_FILE}" >&2
  exit 1
}
[[ "${TAG}" != "latest" ]] || {
  echo "ERROR: refusing mutable tag latest" >&2
  exit 1
}

TMP="$(mktemp)"
trap 'rm -f "${TMP}"' EXIT

if grep -qE '^IMAGE_TAG=' "${ENV_FILE}"; then
  sed -E "s|^IMAGE_TAG=.*|IMAGE_TAG=${TAG}|" "${ENV_FILE}" > "${TMP}"
else
  cat "${ENV_FILE}" > "${TMP}"
  printf '\nIMAGE_TAG=%s\n' "${TAG}" >> "${TMP}"
fi

# Preserve mode when possible
if command -v chmod >/dev/null 2>&1; then
  MODE="$(stat -c '%a' "${ENV_FILE}" 2>/dev/null || stat -f '%OLp' "${ENV_FILE}" 2>/dev/null || echo 600)"
  chmod "${MODE}" "${TMP}" 2>/dev/null || chmod 600 "${TMP}"
fi

mv "${TMP}" "${ENV_FILE}"
trap - EXIT
echo "IMAGE_TAG updated in ${ENV_FILE}"
