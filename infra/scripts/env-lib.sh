#!/usr/bin/env bash
# Shared helpers for prod|test environment targeting.
# shellcheck shell=bash

resolve_mplus_env() {
  local target="${1:-}"
  case "${target}" in
    prod|production)
      MPLUS_ENV="prod"
      COMPOSE_PROJECT="mplus-prod"
      APP_OVERRIDE_FILE="docker-compose.prod.yml"
      GH_ENVIRONMENT="production"
      ;;
    test)
      MPLUS_ENV="test"
      COMPOSE_PROJECT="mplus-test"
      APP_OVERRIDE_FILE="docker-compose.test.yml"
      GH_ENVIRONMENT="test"
      ;;
    *)
      echo "ERROR: environment must be 'prod' or 'test' (got: '${target:-}')" >&2
      echo "Usage: $0 <prod|test> [args...]" >&2
      return 2
      ;;
  esac

  # Prefer VPS layout; fall back to repo-local deploy stubs for validation.
  if [[ -z "${MPLUS_ROOT:-}" ]]; then
    if [[ -d /opt/mplus ]]; then
      MPLUS_ROOT=/opt/mplus
    else
      MPLUS_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/infra/deploy"
    fi
  fi

  REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
  INFRA_DOCKER="${REPO_ROOT}/infra/docker"
  ENV_DIR="${MPLUS_ROOT}/${MPLUS_ENV}"
  ENV_FILE="${ENV_FILE_OVERRIDE:-${ENV_DIR}/.env}"
  RELEASE_DIR="${ENV_DIR}/releases"
  BACKUP_DIR="${ENV_DIR}/backups"
  LOCK_FILE="${LOCK_FILE_OVERRIDE:-/var/lock/mplus-${MPLUS_ENV}-deploy.lock}"
  EDGE_ENV_FILE="${MPLUS_ROOT}/shared/caddy/.env"
  EDGE_COMPOSE="${INFRA_DOCKER}/docker-compose.edge.yml"
  APP_COMPOSE="${INFRA_DOCKER}/docker-compose.app.yml"
  APP_OVERRIDE="${INFRA_DOCKER}/${APP_OVERRIDE_FILE}"

  export MPLUS_ENV COMPOSE_PROJECT GH_ENVIRONMENT MPLUS_ROOT REPO_ROOT
  export ENV_DIR ENV_FILE RELEASE_DIR BACKUP_DIR LOCK_FILE
  export EDGE_ENV_FILE EDGE_COMPOSE APP_COMPOSE APP_OVERRIDE INFRA_DOCKER
}

require_env_file() {
  [[ -f "${ENV_FILE}" ]] || {
    echo "ERROR: missing env file for ${MPLUS_ENV}: ${ENV_FILE}" >&2
    return 1
  }
}

compose_app() {
  # Explicit project name — never rely on directory name.
  # ENV_FILE must already be exported (resolve_mplus_env) for compose interpolation.
  docker compose \
    -p "${COMPOSE_PROJECT}" \
    -f "${APP_COMPOSE}" \
    -f "${APP_OVERRIDE}" \
    --env-file "${ENV_FILE}" \
    "$@"
}

compose_edge() {
  docker compose \
    -p mplus-edge \
    -f "${EDGE_COMPOSE}" \
    --env-file "${EDGE_ENV_FILE}" \
    "$@"
}
