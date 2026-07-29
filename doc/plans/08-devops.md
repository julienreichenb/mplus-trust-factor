# DevOps / CI/CD plan (Agent 40) — dual environment on one VPS

## Topology

```text
Internet
   |
Caddy (mplus-edge) :80/:443 only
   |-- APP_PROD_DOMAIN → mplus-prod-api:3000 + mplus-prod-web:8080
   |-- APP_TEST_DOMAIN → mplus-test-api:3000 + mplus-test-web:8080
   |
Docker network: mplus-proxy (shared, external)
   |
   |-- project mplus-prod (isolated app network + volumes)
   |     web, api, worker, postgres, redis, migrate(profile)
   |
   |-- project mplus-test (isolated app network + volumes)
         web, api, worker, postgres, redis, migrate(profile)
```

Test never shares Postgres, Redis, volumes, locks, backups, or release state with production.

## VPS directory layout

```text
/opt/mplus/
  repo/                         # git checkout (scripts + compose)
  shared/caddy/.env             # ACME + APP_PROD_DOMAIN + APP_TEST_DOMAIN
  prod/
    .env
    backups/
    releases/
  test/
    .env
    backups/
    releases/
```

Repo stubs for local validation: `infra/deploy/{prod,test,shared/caddy}/.env.example`.

## Compose files

| File | Role |
|------|------|
| `docker-compose.edge.yml` | Shared Caddy; creates `mplus-proxy`; project `mplus-edge` |
| `docker-compose.app.yml` | Reusable app stack (no public ports) |
| `docker-compose.prod.yml` | Prod aliases + higher CPU/mem limits |
| `docker-compose.test.yml` | Test aliases + tighter limits + smaller logs |

Always pass `-p mplus-prod` or `-p mplus-test` explicitly.

## Domains & routing

| Variable | Example | Upstream |
|----------|---------|----------|
| `APP_PROD_DOMAIN` | trust.example.com | `mplus-prod-api` / `mplus-prod-web` |
| `APP_TEST_DOMAIN` | test.trust.example.com | `mplus-test-api` / `mplus-test-web` |

DNS: both A/AAAA → same VPS. TLS via Caddy ACME (`ACME_EMAIL`).

## Deploy commands

```bash
./infra/scripts/deploy.sh test
./infra/scripts/deploy.sh prod
./infra/scripts/deploy.sh test --dry-run
./infra/scripts/rollback.sh test <sha>
./infra/scripts/backup-postgres.sh prod
```

Locks: `/var/lock/mplus-prod-deploy.lock` vs `/var/lock/mplus-test-deploy.lock`.

## GitHub Environments

| GitHub Environment | Script target | Compose project | Recommended policy vars |
|--------------------|---------------|-----------------|-------------------------|
| `test` | `test` | `mplus-test` | `ALLOWED_REF_PREFIX=refs/heads/integration/wave4.3` |
| `production` | `prod` | `mplus-prod` | `REQUIRE_WORKFLOW_DISPATCH=true` + required reviewers |

Push to `integration/wave4.3` builds images and maps to **test** target for CD policy; production is manual `workflow_dispatch` with approval.

## Images

Immutable git SHA tags only. Prod and test may run different SHAs simultaneously. Never deploy `latest`.

## Sizing (single VPS hosting both)

| Profile | vCPU | RAM | Disk |
|---------|------|-----|------|
| MVP dual-env | 4 | 8 GB | 120 GB |
| Comfortable | 4–8 | 16 GB | 200 GB+ |

Test limits are intentionally lower (see compose overrides) so a runaway test stack cannot exhaust the host.

## Migrations / backups

Independent per environment. See `doc/operations/deployment.md` and `backup-restore.md`.
