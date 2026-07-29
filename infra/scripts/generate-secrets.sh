#!/usr/bin/env bash
# Generate secrets for one environment (does not write files).
# Usage: ./generate-secrets.sh <prod|test>
set -euo pipefail

TARGET="${1:-}"
case "${TARGET}" in
  prod|test) ;;
  *) echo "Usage: $0 <prod|test>" >&2; exit 2 ;;
esac

rand() { openssl rand -base64 "$1" | tr -d '\n'; }

cat <<EOF
# Paste into /opt/mplus/${TARGET}/.env (chmod 600). Do not commit.
# Environment: ${TARGET}
ADMIN_API_KEY=$(rand 48)
SESSION_SECRET=$(rand 48)
POSTGRES_PASSWORD=$(rand 32)
REDIS_PASSWORD=$(rand 32)
EOF
