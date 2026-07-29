#!/usr/bin/env bash
# Compressed PostgreSQL backup for one environment.
# Usage: ./backup-postgres.sh <prod|test>
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./env-lib.sh
source "${SCRIPT_DIR}/env-lib.sh"

resolve_mplus_env "${1:-}" || exit 2
require_env_file

# shellcheck disable=SC1090
set -a
# shellcheck disable=SC1090
source "${ENV_FILE}"
set +a

RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
REASON="${BACKUP_REASON:-manual}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "${BACKUP_DIR}"

OUT_SQL="${BACKUP_DIR}/mplus-${MPLUS_ENV}-${STAMP}-${REASON}.sql.gz"
OUT_ENC="${OUT_SQL}.age"

echo "[backup:${MPLUS_ENV}] dumping postgres → ${OUT_SQL}"

if compose_app ps postgres 2>/dev/null | grep -q Up; then
  compose_app exec -T postgres \
    pg_dump -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" --no-owner --no-acl \
    | gzip -c > "${OUT_SQL}"
else
  echo "[backup:${MPLUS_ENV}] ERROR: postgres service not up for ${COMPOSE_PROJECT}" >&2
  exit 1
fi

FINAL="${OUT_SQL}"
if [[ -n "${BACKUP_AGE_RECIPIENT:-}" ]]; then
  command -v age >/dev/null 2>&1 || { echo "age not installed" >&2; exit 1; }
  age -r "${BACKUP_AGE_RECIPIENT}" -o "${OUT_ENC}" "${OUT_SQL}"
  rm -f "${OUT_SQL}"
  FINAL="${OUT_ENC}"
  echo "[backup:${MPLUS_ENV}] encrypted → ${FINAL}"
fi

find "${BACKUP_DIR}" -type f \( -name "mplus-${MPLUS_ENV}-*.sql.gz" -o -name "mplus-${MPLUS_ENV}-*.sql.gz.age" \) \
  -mtime "+${RETENTION_DAYS}" -print -delete || true

if [[ -n "${BACKUP_OFFSITE_HINT:-}" ]]; then
  echo "[backup:${MPLUS_ENV}] off-site: copy ${FINAL} → ${BACKUP_OFFSITE_HINT}"
fi

echo "[backup:${MPLUS_ENV}] done: ${FINAL}"
printf '%s\n' "${FINAL}"
