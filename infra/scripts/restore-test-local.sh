#!/usr/bin/env bash
# Local dump/restore round-trip for one logical environment label (uses local Compose Postgres).
# Usage: ./restore-test-local.sh <prod|test>
# No production credentials required.
set -euo pipefail

TARGET="${1:-}"
case "${TARGET}" in
  prod|test) ;;
  *) echo "Usage: $0 <prod|test>" >&2; exit 2 ;;
esac

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPOSE_LOCAL="${ROOT_DIR}/infra/docker/docker-compose.yml"
WORKDIR="${ROOT_DIR}/data/backups-local-test/${TARGET}"
mkdir -p "${WORKDIR}"

echo "[restore-test:${TARGET}] starting local postgres"
docker compose -f "${COMPOSE_LOCAL}" up -d postgres
sleep 3

RESTORE_DB="mplus_trust_${TARGET}_restore"
PROBE_NOTE="ok-${TARGET}"

docker compose -f "${COMPOSE_LOCAL}" exec -T postgres \
  psql -U mplus -d mplus_trust -v ON_ERROR_STOP=1 -c \
  "DROP TABLE IF EXISTS restore_probe;
   CREATE TABLE restore_probe (id int primary key, note text, env text);
   INSERT INTO restore_probe (id, note, env) VALUES (1, '${PROBE_NOTE}', '${TARGET}');"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DUMP="${WORKDIR}/mplus-${TARGET}-${STAMP}-local-probe.sql.gz"
docker compose -f "${COMPOSE_LOCAL}" exec -T postgres \
  pg_dump -U mplus -d mplus_trust --no-owner --no-acl | gzip -c > "${DUMP}"

echo "[restore-test:${TARGET}] dump → ${DUMP}"

docker compose -f "${COMPOSE_LOCAL}" exec -T postgres \
  psql -U mplus -d postgres -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS ${RESTORE_DB};"
docker compose -f "${COMPOSE_LOCAL}" exec -T postgres \
  psql -U mplus -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE ${RESTORE_DB} OWNER mplus;"

gunzip -c "${DUMP}" | docker compose -f "${COMPOSE_LOCAL}" exec -T postgres \
  psql -U mplus -d "${RESTORE_DB}" -v ON_ERROR_STOP=1

GOT="$(docker compose -f "${COMPOSE_LOCAL}" exec -T postgres \
  psql -U mplus -d "${RESTORE_DB}" -tAc "SELECT note FROM restore_probe WHERE id=1;")"
[[ "${GOT}" == "${PROBE_NOTE}" ]] || { echo "[restore-test:${TARGET}] FAIL got '${GOT}'" >&2; exit 1; }

# Safeguard check: test dump must not silently be accepted for prod restore without override
if [[ "${TARGET}" == "test" ]]; then
  if RESTORE_CONFIRM=production "${ROOT_DIR}/infra/scripts/restore-postgres.sh" test "${DUMP}" \
    'postgresql://mplus:mplus@localhost:5433/production_looking_db' 2>/dev/null; then
    echo "[restore-test] FAIL: test→prod restore should have been refused" >&2
    exit 1
  fi
  echo "[restore-test:${TARGET}] safeguard OK (test dump → prod URL refused)"
fi

echo "[restore-test:${TARGET}] PASS"
