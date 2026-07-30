# Deployment (prod | test)

## Commands

```bash
./infra/scripts/validate-env.sh test          # fail-closed before touch
./infra/scripts/deploy.sh prod
./infra/scripts/deploy.sh test
./infra/scripts/deploy.sh test --dry-run
./infra/scripts/smoke-deploy.sh test <sha>
./infra/scripts/rollback.sh test <previous-sha>
```

## Order (per environment)

1. **Validate env + compose config** (`validate-env.sh`) — before lock / stack mutation
2. Acquire **environment-specific** lock (`/var/lock/mplus-{prod|test}-deploy.lock`)
3. Ensure `mplus-proxy` exists (start `mplus-edge` if needed)
4. Pull images for that project only
5. Start that environment’s Postgres + Redis
6. Backup that environment’s database → `/opt/mplus/{env}/backups`
7. `prisma migrate deploy` via that project’s migrate one-shot (once; fail aborts rollout)
8. **Empty-DB seed only** — if `ScoreModel` count is 0; otherwise skip (no env-based model activation)
9. Roll out worker → api + web
10. Container health (`/health/ready` healthchecks) + running image tag == `IMAGE_TAG`
11. Public smoke: `/health/ready` + `/api/v1/meta` `version` == SHA
12. Write `/opt/mplus/{env}/releases/current` + manifest

On health / revision failure: rollback **only that environment’s** app images to the previous immutable SHA.

## Migrations

| Topic | Behavior |
|-------|----------|
| Normal flow | One-shot `migrate` container on the env project; targets that env’s Postgres only |
| Failure | Deploy aborts before app rollout; other env untouched; restore that env’s backup if DB is inconsistent |
| Schema rollback | Not supported — ship a forward migration. Never `prisma migrate reset` |
| Restore | `restore-postgres.sh <prod\|test> <dump> <url>` with confirmations |

## Independent versions

Set different `IMAGE_TAG` values in `/opt/mplus/prod/.env` and `/opt/mplus/test/.env`. Both pull from GHCR by SHA.

## Model lifecycle

CD must not flip `ACTIVE_SCORE_MODEL_KEY` / `ACTIVE_SCORE_MODEL_VERSION` to “activate” a model. Those env vars may bootstrap a **truly empty** database via seed; day-to-day activation is admin/DB (see [`model-lifecycle.md`](model-lifecycle.md)).

## Manual inventory

See [`manual-process-inventory.md`](manual-process-inventory.md).
