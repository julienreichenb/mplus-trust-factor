# Production operations — dual environment VPS

**Status:** Production remains out of scope until test is clean. CD is prepared for a protected `prod` branch; do **not** create or push `prod` until Environment reviewers and secrets are configured.

Programme flow: feature → PR/CI → `main` (auto test deploy) → reviewed merge to `prod` (production). See [`ci-cd.md`](ci-cd.md) and [`test-environment.md`](test-environment.md).

## First bootstrap

1. Non-root `deploy` user, SSH keys only, Docker Engine + Compose.
2. Firewall: `22`, `80`, `443` only.
3. Layout:

```bash
sudo mkdir -p /opt/mplus/{repo,shared/caddy,prod/{backups,releases},test/{backups,releases}}
sudo chown -R deploy:deploy /opt/mplus
cd /opt/mplus/repo && git clone <repo-url> .
cp infra/deploy/shared/caddy/.env.example /opt/mplus/shared/caddy/.env
cp infra/deploy/prod/.env.example /opt/mplus/prod/.env
cp infra/deploy/test/.env.example /opt/mplus/test/.env
# fill secrets (separate for prod vs test!) — ./infra/scripts/generate-secrets.sh <env>
chmod 600 /opt/mplus/prod/.env /opt/mplus/test/.env /opt/mplus/shared/caddy/.env
```

4. DNS: `APP_PROD_DOMAIN` and `APP_TEST_DOMAIN` A/AAAA → VPS.
5. Start edge, then test first:

```bash
export MPLUS_ROOT=/opt/mplus
docker compose -p mplus-edge -f infra/docker/docker-compose.edge.yml \
  --env-file /opt/mplus/shared/caddy/.env up -d
./infra/scripts/deploy.sh test
# prod only after policy activation — not during Agent 05
```

## GitHub Environment setup

Create Environments **`test`** and **`production`**.

### Secrets (per environment)

| Secret | Purpose |
|--------|---------|
| `VPS_SSH_HOST` | VPS hostname/IP |
| `VPS_SSH_USER` | deploy user |
| `VPS_SSH_KEY` | private key |
| `VPS_SSH_PORT` | optional, default 22 |
| `VPS_MPLUS_ROOT` | default `/opt/mplus` |
| `VPS_REPO_DIR` | default `/opt/mplus/repo` |
| `VPS_PUBLIC_URL` | `https://<that-env-domain>` for ready/revision smoke (**required** — missing fails CD) |
| `GHCR_TOKEN` | optional if `GITHUB_TOKEN` insufficient for pull |

SSH host/user/key may be identical across Environments; **application secrets live only in VPS `.env` files**, not in GitHub (except deploy plumbing).

### Variables (per environment)

| Variable | test (recommended) | production (recommended) |
|----------|--------------------|--------------------------|
| `ALLOWED_REF_PREFIX` | `refs/heads/main` | `refs/heads/prod` |
| `REQUIRE_WORKFLOW_DISPATCH` | `false` | `true` (optional) |

Enable **required reviewers** on **production** before first production deploy.

## Test deployment

Automatic on every push/merge to `main` (CD). Manual:

```bash
# Actions: environment=test (any ref), or on VPS:
export MPLUS_ROOT=/opt/mplus
./infra/scripts/deploy.sh test
```

Failed test deploy rolls back **test only**.

## Production deployment (prepared — do not activate yet)

When ready:

1. Protect `production` Environment (reviewers + secrets).
2. Create `prod` from a known-good `main` SHA.
3. Merge `main` → `prod` (or push to `prod`) to build + deploy, **or** `workflow_dispatch` with environment=`production` while checked out on `prod`.

```bash
# Actions: workflow_dispatch → environment=production → approval (ref must be prod)
./infra/scripts/deploy.sh prod
```

No direct production deploy from feature branches — CD policy rejects non-`prod` refs.

## Observability

| Signal | Prod | Test |
|--------|------|------|
| Ready | `https://$APP_PROD_DOMAIN/health/ready` | `https://$APP_TEST_DOMAIN/health/ready` |
| Live | `/health/live` (liveness only) | same |
| Revision | `/api/v1/meta` → `version` == image SHA | same |
| Logs | `docker compose -p mplus-prod logs -f` | `-p mplus-test` |
| Disk | `/opt/mplus/prod/backups`, volumes | `/opt/mplus/test/...` |

Alerts: uptime on both `/health/ready`; disk; container restart loops; memory pressure (test limits should OOM-kill test first).

## Provider credentials

Use **separate** Blizzard/WCL/Raider.IO credentials for test. Do not copy production secrets into `/opt/mplus/test/.env`.

## First-admin bootstrap

After Battle.net login on the environment: `pnpm iam:grant-admin` (see [`../architecture/iam-and-admin.md`](../architecture/iam-and-admin.md)). Retained as a manual once-per-environment step — see [`manual-process-inventory.md`](manual-process-inventory.md).
