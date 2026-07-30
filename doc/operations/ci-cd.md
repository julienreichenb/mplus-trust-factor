# CI / CD

## Required flow (programme intent = current CD)

```text
PR / feature branch
  → CI

merge to main
  → CI
  → CD: immutable SHA images → GHCR
  → migrate test DB (once, fail-closed)
  → deploy test stack
  → /health/ready + /api/v1/meta revision check
  → explicit success / failure (missing secrets fail the job)
```

## CI (`.github/workflows/ci.yml`)

Triggers: `pull_request`, push to `main` / `integration/**` / `agent/**`.

Quality path: install → format → shellcheck (deploy scripts) → dual-env dry-run → lint / build / typecheck → migrate → seed → test → docker builds + secret bake scan → invalid migration guard.

Local Postgres uses host **5433**; GitHub Actions Postgres uses **5432** via `DATABASE_URL`.

## CD (`.github/workflows/cd.yml`)

| Topic | Behaviour |
|-------|-----------|
| Push `main` | Build SHA images + deploy **test** |
| Push `prod` | Build SHA images + deploy **production** (prepared; do not create/push `prod` until test is clean and Environment protection is on) |
| `workflow_dispatch` | Build + optional deploy; **production only when ref is `refs/heads/prod`** |
| Missing deploy secrets | **Fail** the deploy job (no green no-op) |
| Health gate | `/health/ready` then `/api/v1/meta` `version` == image SHA |
| Concurrency | Per-environment group; production deploys are never cancelled mid-flight |
| Model activation | **Not** CD — DB/admin only (see [`model-lifecycle.md`](model-lifecycle.md)) |

### GitHub Environment variables (configure in UI)

| Variable | `test` | `production` |
|----------|--------|--------------|
| `ALLOWED_REF_PREFIX` | `refs/heads/main` | `refs/heads/prod` |
| `REQUIRE_WORKFLOW_DISPATCH` | `false` | `true` (optional extra gate) |

Enable **required reviewers** on the `production` Environment before first use.

### Secrets (per Environment)

See [`production.md`](production.md). Required for deploy: `VPS_SSH_HOST`, `VPS_SSH_USER`, `VPS_SSH_KEY`, `VPS_PUBLIC_URL`.

## Production policy (prepared, not activated)

- Source branch: **`prod`** (reviewed merges from `main`).
- No feature-branch production deploys.
- No production deployment as part of Agent 05 — do not create or push `prod` until test is clean.
- Rollback uses the previous immutable SHA only: `./infra/scripts/rollback.sh prod <sha>`.

## Manual process inventory

See [`manual-process-inventory.md`](manual-process-inventory.md).
