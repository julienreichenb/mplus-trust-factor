# Agent 40 — Dual-environment CI/CD handoff

**Branch:** `agent/wave4.3-cicd-vps`

## Architecture summary

One Linux VPS hosts **production** and **test** as fully isolated Compose projects (`mplus-prod`, `mplus-test`) behind a single shared Caddy edge (`mplus-edge`) on ports 80/443. Each environment has its own Postgres, Redis, volumes, `.env`, migrations, backups, deploy locks, and release manifests. Different immutable SHA tags may run simultaneously.

## Directory layout

```text
/opt/mplus/repo
/opt/mplus/shared/caddy/.env
/opt/mplus/prod/{.env,backups,releases}
/opt/mplus/test/{.env,backups,releases}
```

## Domains / routing

- `APP_PROD_DOMAIN` → `mplus-prod-api` + `mplus-prod-web`
- `APP_TEST_DOMAIN` → `mplus-test-api` + `mplus-test-web`

## Deploy

```bash
./infra/scripts/deploy.sh test
./infra/scripts/deploy.sh prod
```

## Validation

```bash
pnpm ops:validate-dual-env
bash infra/scripts/restore-test-local.sh test
```

Results (local):

- dual-env compose config + deploy dry-runs → PASS
- app stacks publish no host ports; edge publishes 80/443 only → PASS
- distinct IMAGE_TAG dry-runs for prod vs test → PASS
- restore-test-local.sh test (+ test→prod restore refuse) → PASS

## Commit hashes

- `b56ea72` — feat(cicd): add dual-env CI/CD and VPS deployment foundation
- `a157a39` — docs(ops): document dual-environment VPS topology and runbooks
