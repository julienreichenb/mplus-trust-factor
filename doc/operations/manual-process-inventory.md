# Manual process inventory (deploy / CD)

What still needs a human once vs what CD/scripts automate.

| Process | Status | How |
|---------|--------|-----|
| Secret generation | **Manual once / rotate** | `./infra/scripts/generate-secrets.sh <prod\|test>` → paste into `/opt/mplus/{env}/.env` (`chmod 600`). Never commit. |
| VPS directory preparation | **Manual once** | `mkdir -p /opt/mplus/{repo,shared/caddy,prod/{backups,releases},test/{backups,releases}}`; clone repo; copy `.env.example` files. See [`production.md`](production.md). |
| Shared proxy network (`mplus-proxy`) | **Automated on deploy** if missing; **manual first** edge `.env` | `deploy.sh` starts edge compose when network absent; requires `/opt/mplus/shared/caddy/.env`. |
| GHCR login on VPS | **Automated in CD** | SSH deploy logs in with `GHCR_TOKEN` / `GITHUB_TOKEN` before pull. |
| Migrations | **Automated** | One-shot `migrate` container per env; fails closed before app rollout. Never `migrate reset`. |
| Image tag update | **Automated in CD** | `set-image-tag.sh` writes immutable SHA into env `.env`. |
| Deploy | **Automated on `test` promotion** (`pnpm promote:test`) | `deploy.sh`: validate → lock → backup → migrate → empty-DB seed only → rollout → ready/revision smoke. |
| Readiness wait | **Automated** | Compose healthchecks + `health-wait.sh` / `smoke-deploy.sh` on `/health/ready`. |
| Smoke checks | **Automated** | Ready + `/api/v1/meta` version == SHA + web shell. |
| Rollback | **Manual / on-call** (scripted) | `./infra/scripts/rollback.sh <env> <previous-sha>` — immutable SHA only. |
| Backup preconditions | **Automated pre-migrate** | `backup-postgres.sh` unless `SKIP_BACKUP=1`. Retention via env. |
| First-admin bootstrap | **Manual once** (Agent 04 contract) | Sign in via Battle.net → `pnpm iam:grant-admin -- --user-id <uuid>` (or battlenet subject). No HTTP bootstrap. See [`../architecture/iam-and-admin.md`](../architecture/iam-and-admin.md). |
| Score-model activation | **Admin UI / DB** — never CD | Env `ACTIVE_SCORE_MODEL_*` are empty-DB bootstrap/lookup aids only. |
| Create `prod` branch + Environment reviewers | **Manual when activating production** | Not done in Agent 05. |

## Explicitly retained as manual

1. Generating and rotating application secrets on the VPS.
2. First VPS bootstrap (Docker, firewall, DNS, directory layout, edge env).
3. First-admin grant after Battle.net login.
4. Creating the `prod` branch and enabling GitHub Environment required reviewers.
5. Deciding to roll back (command is automated; decision is human).
