# Production operations — dual environment VPS

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
# fill secrets (separate for prod vs test!)
chmod 600 /opt/mplus/prod/.env /opt/mplus/test/.env /opt/mplus/shared/caddy/.env
```

4. DNS: `APP_PROD_DOMAIN` and `APP_TEST_DOMAIN` A/AAAA → VPS.
5. Start edge, then each app:

```bash
export MPLUS_ROOT=/opt/mplus
docker compose -p mplus-edge -f infra/docker/docker-compose.edge.yml \
  --env-file /opt/mplus/shared/caddy/.env up -d
./infra/scripts/deploy.sh test
./infra/scripts/deploy.sh prod
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
| `VPS_PUBLIC_URL` | `https://<that-env-domain>` for health smoke |
| `GHCR_TOKEN` | optional if `GITHUB_TOKEN` insufficient for pull |

SSH host/user/key may be identical across Environments; **application secrets live only in VPS `.env` files**, not in GitHub (except deploy plumbing).

### Variables (per environment)

| Variable | test (recommended) | production (recommended) |
|----------|--------------------|--------------------------|
| `ALLOWED_REF_PREFIX` | `refs/heads/integration/wave4.3` | (empty or release tag prefix) |
| `REQUIRE_WORKFLOW_DISPATCH` | `false` | `true` |

Enable required reviewers on **production**.

## Test deployment

```bash
# From Actions: environment=test, optional image_tag=<sha>
# Or on VPS:
export MPLUS_ROOT=/opt/mplus
# set IMAGE_TAG in /opt/mplus/test/.env
./infra/scripts/deploy.sh test
```

Failed test deploy rolls back **test only**.

## Production deployment

```bash
# Actions: workflow_dispatch → environment=production → approval → image_tag=<sha>
./infra/scripts/deploy.sh prod
```

## Observability

| Signal | Prod | Test |
|--------|------|------|
| Public live | `https://$APP_PROD_DOMAIN/health/live` | `https://$APP_TEST_DOMAIN/health/live` |
| Ready | `/health/ready` on each domain | same |
| Logs | `docker compose -p mplus-prod logs -f` | `-p mplus-test` |
| Disk | `/opt/mplus/prod/backups`, volumes | `/opt/mplus/test/...` |

Alerts: uptime on both `/health/ready`; disk; container restart loops; memory pressure (test limits should OOM-kill test first).

## Provider credentials

Use **separate** Blizzard/WCL/Raider.IO credentials for test. Do not copy production secrets into `/opt/mplus/test/.env`.
