#!/usr/bin/env bash
# Restore a dump into a target database URL.
# Usage: ./restore-postgres.sh <prod|test> <dump.sql.gz|.age> <target-database-url>
#
# Safeguards:
#   - Requires explicit environment label matching the dump filename prefix when possible
#   - Refuses restoring into production URL unless RESTORE_CONFIRM=production
#   - Refuses restoring a test-* dump into a production URL without RESTORE_TEST_INTO_PROD=1
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=env-lib.sh
source "${SCRIPT_DIR}/env-lib.sh"

ENV_LABEL="${1:-}"
DUMP_PATH="${2:-}"
TARGET_URL="${3:-}"

usage() {
  cat <<'EOF'
Usage: restore-postgres.sh <prod|test> <dump.sql.gz|.age> <target-database-url>

Examples:
  ./restore-postgres.sh test ./backups/mplus-test-....sql.gz \
    'postgresql://mplus_test:...@localhost:5433/mplus_trust_test_restore'

Safety:
  - RESTORE_CONFIRM=production required for production-looking target URLs
  - RESTORE_TEST_INTO_PROD=1 required to load a test dump into a production URL
EOF
}

resolve_mplus_env "${ENV_LABEL}" || { usage; exit 2; }
[[ -n "${DUMP_PATH}" && -n "${TARGET_URL}" ]] || { usage; exit 1; }
[[ -f "${DUMP_PATH}" ]] || { echo "dump not found: ${DUMP_PATH}" >&2; exit 1; }

DUMP_BASE="$(basename "${DUMP_PATH}")"
if [[ "${DUMP_BASE}" == *"-test-"* && "${TARGET_URL}" =~ (prod|production) && "${RESTORE_TEST_INTO_PROD:-}" != "1" ]]; then
  echo "Refusing to restore a TEST dump into a production-looking URL." >&2
  echo "Set RESTORE_TEST_INTO_PROD=1 if this is intentional." >&2
  exit 1
fi

if [[ "${MPLUS_ENV}" == "prod" || "${TARGET_URL}" =~ (prod|production) ]]; then
  if [[ "${RESTORE_CONFIRM:-}" != "production" ]]; then
    echo "Refusing production restore. Set RESTORE_CONFIRM=production to override." >&2
    exit 1
  fi
fi

WORKDIR="$(mktemp -d)"
trap 'rm -rf "${WORKDIR}"' EXIT
SQL_FILE="${WORKDIR}/restore.sql"

if [[ "${DUMP_PATH}" == *.age ]]; then
  [[ -n "${BACKUP_AGE_IDENTITY:-}" ]] || { echo "BACKUP_AGE_IDENTITY required for .age dumps" >&2; exit 1; }
  age -d -i "${BACKUP_AGE_IDENTITY}" -o "${SQL_FILE}.gz" "${DUMP_PATH}"
  gunzip -c "${SQL_FILE}.gz" > "${SQL_FILE}"
elif [[ "${DUMP_PATH}" == *.gz ]]; then
  gunzip -c "${DUMP_PATH}" > "${SQL_FILE}"
else
  cp "${DUMP_PATH}" "${SQL_FILE}"
fi

echo "[restore:${MPLUS_ENV}] loading dump (credentials redacted)"
psql "${TARGET_URL}" -v ON_ERROR_STOP=1 -c "SELECT 1" >/dev/null
psql "${TARGET_URL}" -v ON_ERROR_STOP=1 -f "${SQL_FILE}"
psql "${TARGET_URL}" -v ON_ERROR_STOP=1 -c "SELECT COUNT(*) AS schema_migrations FROM _prisma_migrations;"
echo "[restore:${MPLUS_ENV}] done"
