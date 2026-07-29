#!/usr/bin/env bash
# Wait until URL returns HTTP 200 (used by CD health verification).
set -euo pipefail
URL="${1:?usage: health-wait.sh <url> [timeout_sec]}"
TIMEOUT="${2:-180}"
DEADLINE=$((SECONDS + TIMEOUT))
while (( SECONDS < DEADLINE )); do
  if curl -fsSk --max-time 5 "${URL}" >/dev/null 2>&1; then
    echo "healthy: ${URL}"
    exit 0
  fi
  sleep 5
done
echo "timeout waiting for ${URL}" >&2
exit 1
