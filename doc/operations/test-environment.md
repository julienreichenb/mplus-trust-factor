# Test environment

## Current behaviour

- Push/merge to **`main`** runs CI, then CD builds immutable SHA images and deploys **test**.
- Missing GitHub Environment deploy secrets **fail** the deploy job (no green no-op).
- Post-deploy gate: `/health/ready` + `/api/v1/meta` `version` equals the deployed image SHA.

## Production

- Production remains out of scope until test is clean.
- No direct production deployment from feature branches.
- Future: reviewed merges to **`prod`** deploy production (workflow prepared; branch not activated in Agent 05).

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
