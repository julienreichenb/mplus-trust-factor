# Deployment (prod | test)

## Commands

```bash
./infra/scripts/deploy.sh prod
./infra/scripts/deploy.sh test
./infra/scripts/deploy.sh test --dry-run
```

## Order (per environment)

1. Acquire **environment-specific** lock (`/var/lock/mplus-{prod|test}-deploy.lock`)
2. Ensure `mplus-proxy` exists (start `mplus-edge` if needed)
3. Pull images for that project only
4. Start that environment’s Postgres + Redis
5. Backup that environment’s database → `/opt/mplus/{env}/backups`
6. `prisma migrate deploy` via that project’s migrate one-shot
7. Roll out worker → api + web
8. Health check that project’s containers
9. Smoke `https://$APP_DOMAIN/health/live`
10. Write `/opt/mplus/{env}/releases/current` + manifest

On health failure: rollback **only that environment’s** app images.

## Migrations

| Topic | Behavior |
|-------|----------|
| Normal flow | One-shot `migrate` container on the env project; targets that env’s Postgres only |
| Failure | Deploy aborts before app rollout; other env untouched; restore that env’s backup if DB is inconsistent |
| Schema rollback | Not supported — ship a forward migration. Never `prisma migrate reset` |
| Restore | `restore-postgres.sh <prod\|test> <dump> <url>` with confirmations |

## Independent versions

Set different `IMAGE_TAG` values in `/opt/mplus/prod/.env` and `/opt/mplus/test/.env`. Both pull from GHCR by SHA.
