#!/usr/bin/env bash
# Wait until URL returns HTTP 200 (optional JSON field assertion).
# Usage:
#   health-wait.sh <url> [timeout_sec]
#   health-wait.sh <url> [timeout_sec] --expect-json-field <field> <value>
# Portable: no python/jq required (grep/sed for JSON string fields).
set -euo pipefail

URL="${1:?usage: health-wait.sh <url> [timeout_sec] [--expect-json-field field value]}"
TIMEOUT="${2:-180}"
if (($# >= 2)); then
  shift 2
else
  shift 1
fi

EXPECT_FIELD=""
EXPECT_VALUE=""
while (($# > 0)); do
  case "$1" in
    --expect-json-field)
      EXPECT_FIELD="${2:?}"
      EXPECT_VALUE="${3:?}"
      shift 3
      ;;
    *)
      echo "unknown arg: $1" >&2
      exit 2
      ;;
  esac
done

json_string_field() {
  local file="$1"
  local field="$2"
  # Matches "field": "value" or "field":"value"
  grep -oE "\"${field}\"[[:space:]]*:[[:space:]]*\"[^\"]*\"" "${file}" 2>/dev/null \
    | head -n1 \
    | sed -E "s/.*:[[:space:]]*\"([^\"]*)\"/\1/"
}

DEADLINE=$((SECONDS + TIMEOUT))
BODY_FILE="$(mktemp)"
trap 'rm -f "${BODY_FILE}"' EXIT

while ((SECONDS < DEADLINE)); do
  code="$(curl -fsSk --max-time 5 -o "${BODY_FILE}" -w '%{http_code}' "${URL}" 2>/dev/null || true)"
  if [[ "${code}" == "200" ]]; then
    if [[ -n "${EXPECT_FIELD}" ]]; then
      actual="$(json_string_field "${BODY_FILE}" "${EXPECT_FIELD}")"
      if [[ "${actual}" == "${EXPECT_VALUE}" ]]; then
        echo "healthy: ${URL} (${EXPECT_FIELD}=${EXPECT_VALUE})"
        exit 0
      fi
      echo "waiting: ${URL} HTTP 200 but ${EXPECT_FIELD}='${actual}' want '${EXPECT_VALUE}'"
    else
      echo "healthy: ${URL}"
      exit 0
    fi
  fi
  sleep 5
done

echo "timeout waiting for ${URL}" >&2
if [[ -s "${BODY_FILE}" ]]; then
  echo "last body:" >&2
  head -c 2000 "${BODY_FILE}" >&2 || true
  echo >&2
fi
exit 1
