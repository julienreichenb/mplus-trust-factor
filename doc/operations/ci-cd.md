# CI / CD

Canonical promotion policy: [`release-promotion-flow.md`](release-promotion-flow.md).

## Required flow

```text
feature PR → main
  → fast CI (quality + migration guard; no Docker images; no deploy)

when ready:
  pnpm promote:test   # fast-forward main → test

push to test
  → verify SHA ∈ main
  → release quality gate
  → build + push immutable SHA images (GHCR)
  → secret bake scan
  → deploy test stack
  → /health/ready + /api/v1/meta revision check

future: push to prod
  → verify SHA ∈ test
  → verify four SHA images already in GHCR (no rebuild)
  → deploy production
```

## CI (`.github/workflows/ci.yml`)

Triggers: pull requests targeting **`main`**; optional `workflow_dispatch`.

**Does not** run on push to `main`. **Does not** build Docker images.

| Required check (exact name) | Purpose |
|-----------------------------|---------|
| `Lint · typecheck · test · build` | Frozen install, Prisma generate, format, shellcheck, dual-env dry-run, nginx, lint, build, typecheck, migrate, seed, tests, English, abilities, audit |
| `Invalid migration must fail` | Migration safety guard |

Fixture provider mode; `ALLOW_LIVE_PROVIDER_CALLS=false`. Fail-closed for required validation.

Local Postgres uses host **5433**; GitHub Actions Postgres uses **5432** via `DATABASE_URL`.

## CD (`.github/workflows/cd.yml`)

| Topic | Behaviour |
|-------|-----------|
| Push `test` | Ancestry(main) → quality → build SHA images → scan → deploy **test** |
| Push `prod` | Ancestry(test) → verify existing GHCR images → deploy **production** (no rebuild) |
| Push `main` | **No CD** |
| `workflow_dispatch` | Same rules; **production only when ref is `refs/heads/prod`**; `skip_deploy` for build/verify only |
| Missing deploy secrets | **Fail** the deploy job (no green no-op) |
| Missing production images | **Fail** closed (no rebuild on prod) |
| Health gate | `/health/ready` then `/api/v1/meta` `version` == image SHA |
| Concurrency | Per-environment group; production deploys are never cancelled mid-flight |
| Model activation | **Not** CD — DB/admin only (see [`model-lifecycle.md`](model-lifecycle.md)) |

### GitHub Environment variables (configure in UI)

| Variable | `test` | `production` |
|----------|--------|--------------|
| `ALLOWED_REF_PREFIX` | `refs/heads/test` | `refs/heads/prod` |
| `REQUIRE_WORKFLOW_DISPATCH` | `false` | `true` (optional extra gate) |

Enable **required reviewers** on the `production` Environment before first use.

### Secrets (per Environment)

See [`production.md`](production.md). Required for deploy: `VPS_SSH_HOST`, `VPS_SSH_USER`, `VPS_SSH_KEY`, `VPS_PUBLIC_URL`.

## Production policy (prepared, not activated)

- Source branch: **`prod`** (commit already promoted through `test`).
- No feature-branch production deploys.
- Do not create or push `prod` until test is clean and Environment protection is on.
- Rollback uses the previous immutable SHA only: `./infra/scripts/rollback.sh prod <sha>`.

## Manual process inventory

See [`manual-process-inventory.md`](manual-process-inventory.md).
