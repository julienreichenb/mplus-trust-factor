# Test environment

## Current behaviour

- `main` is integration only (fast PR CI; no deploy).
- Promote when ready: `pnpm promote:test` (fast-forward `main` → `test`).
- Push to **`test`** runs CD: verify SHA ∈ main → quality gate → immutable SHA images → deploy **test**.
- Missing GitHub Environment deploy secrets **fail** the deploy job (no green no-op).
- Post-deploy gate: `/health/ready` + `/api/v1/meta` `version` equals the deployed image SHA.

Canonical policy: [`release-promotion-flow.md`](release-promotion-flow.md).

## Production

- Production remains out of scope until test is clean.
- No direct production deployment from feature branches.
- Future: promote a SHA already on **`test`** to **`prod`** (deploy existing images; no rebuild).

## Health checks

| Probe | Use |
|-------|-----|
| `/health/live` | Process up (liveness) |
| `/health/ready` | DB + Redis ready — **CD gate** |
| `/api/v1/meta` | `version` must match `IMAGE_TAG` |

## Local vs test

| Concern | Local | Test |
|---------|-------|------|
| Postgres host port | Compose **5433** | Environment-specific (no host publish) |
| Battle.net login | May be absent | Present for the project owner |
| Secrets | Root `.env` only | VPS `/opt/mplus/test/.env` — never commit |
| Model activation | Seed / admin | Admin/DB; CD seeds only empty ScoreModel catalog |

## Manual inventory

See [`manual-process-inventory.md`](manual-process-inventory.md).
