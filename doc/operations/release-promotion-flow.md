# Release promotion flow

Canonical branch and release policy for **M+ Trust Factor**.

```text
feature branches / worktrees
    → main          (fast PR CI only — no images, no deploy)
    → test          (promotion pointer — full quality + images + test deploy)
    → prod          (future — deploy exact SHA images already published on test)
```

## Branch meanings

| Branch | Role |
|--------|------|
| `main` | Integrated, reviewable source. Protected by fast mandatory PR CI. **Must not** build release Docker images or deploy any environment. |
| `test` | Immutable promotion pointer to a commit already on `main`. A push to `test` runs complete validation, GHCR publication, test deploy, and post-deploy verification. |
| `prod` | Future production promotion pointer. Must only reference a commit that already existed on `test`. Deploys exact SHA-tagged images — **never rebuilds**. Do not create or push `prod` until Environment reviewers and secrets are ready. |

Feature branches never deploy. Mutable tags such as `latest` are forbidden.

## Promotion rules

1. Merge feature PRs into `main` after fast CI (no Docker job required).
2. Continue merging independent work to `main` without deploying each merge.
3. When ready to update the test environment, promote `main` → `test` with a fast-forward only (no merge commit, no force).
4. CD on `test` fails unless `git merge-base --is-ancestor "$SHA" origin/main`.
5. CD on `prod` fails unless `git merge-base --is-ancestor "$SHA" origin/test` **and** all four GHCR images for that SHA already exist.
6. Score-model activation is **never** part of CD (admin/DB only — see [`model-lifecycle.md`](model-lifecycle.md)).

## Daily commands

```bash
# 1. Merge a feature PR into main after fast CI (GitHub UI / gh pr merge)

# 2. When ready to update test:
pnpm promote:test

# Optional dry-run (no push) — validates fetch + ancestry:
pnpm promote:test -- --dry-run

# 3. Track the test deployment:
gh run list --workflow CD --branch test --event push --limit 3
gh run watch <RUN_ID> --exit-status

# 4. Validate the deployed test application (public URL from VPS_PUBLIC_URL):
#    /health/ready
#    /api/v1/meta  → version == deployed SHA
```

Promotion implementation: `tools/scripts/promote-test.mjs` (`pnpm promote:test`).

- Runs `git fetch origin --prune`
- Resolves exact `origin/main` SHA
- If `origin/test` exists, requires it to be an ancestor of `origin/main` (refuses divergence)
- Pushes without force: `refs/remotes/origin/main:refs/heads/test`
- Works for initial creation of `test` and later fast-forward promotions
- Cross-platform via Node.js (Windows PowerShell, Linux, macOS)

## Observe CI and CD

| Workflow | File | When |
|----------|------|------|
| **CI** | `.github/workflows/ci.yml` | Pull requests targeting `main`; optional `workflow_dispatch` |
| **CD** | `.github/workflows/cd.yml` | Push to `test` or `prod`; optional `workflow_dispatch` |

```bash
gh run list --workflow CI --limit 5
gh run list --workflow CD --branch test --limit 5
gh run view <RUN_ID>
```

### Trigger matrix

| Event | CI | CD |
|-------|----|----|
| PR → `main` | Yes (quality + migration guard; **no** Docker) | No |
| Push to `main` | No | No |
| Push to `test` | No | Yes: ancestry(main) → quality → build/push → scan → deploy test |
| Push to `prod` | No | Yes: ancestry(test) → verify images → deploy prod (no rebuild) |
| `workflow_dispatch` CI | Manual diagnostics | — |
| `workflow_dispatch` CD → test | — | Same as test path; `skip_deploy` builds only |
| `workflow_dispatch` CD → production | — | Only from `refs/heads/prod`; existing images only |

### CD job graph

**Test path** (`needs_build=true`):

```text
policy → verify-promotion → quality → build-and-push → deploy
```

**Production path** (`needs_build=false`):

```text
policy → verify-promotion → verify-images → deploy
```

Concurrency: group `cd-test` / `cd-production`. Newer **test** promotions may cancel an older in-progress test run. Production is never cancelled by test.

## Immutable image policy

Release images are tagged **only** with the git SHA:

- `ghcr.io/<owner>/mplus-api:<sha>`
- `ghcr.io/<owner>/mplus-worker:<sha>`
- `ghcr.io/<owner>/mplus-migrate:<sha>`
- `ghcr.io/<owner>/mplus-web:<sha>`

Built on the **test** promotion path (with Buildx GHA cache, provenance, SBOM, secret-bake scan). Production reuses those exact tags — it must not rebuild.

## Rollback

```bash
./infra/scripts/rollback.sh test <previous-sha>
# future:
./infra/scripts/rollback.sh prod <previous-sha>
```

Rollback retargets immutable SHA images only. Schema rollback is not supported — ship a forward migration. See [`rollback.md`](rollback.md) and [`deployment.md`](deployment.md).

## GitHub repository settings (manual)

These cannot be applied from the workflow files — configure in GitHub → Settings → Branches / Rulesets.

### `main`

- Default branch remains `main`
- Require a pull request before merging
- Block force pushes
- Block deletion
- Require linear history if compatible with the current squash strategy
- **Required status checks** (exact job names):
  - `Lint · typecheck · test · build`
  - `Invalid migration must fail`
- **Remove** any required check for Docker image builds

### `test`

- Block force pushes
- Block deletion
- Require linear history
- Advance only by fast-forward promotion from `main` (`pnpm promote:test`)
- No feature development or manual commits on `test`

### `prod` (later)

- Block direct development
- Block force pushes and deletion
- Require controlled promotion from commits already on `test`
- Configure production GitHub Environment required reviewers before first use

## GitHub Environment settings (manual)

### Environment `test`

| Setting | Value |
|---------|-------|
| `ALLOWED_REF_PREFIX` | `refs/heads/test` (**change from** `refs/heads/main`) |
| `REQUIRE_WORKFLOW_DISPATCH` | `false` (default) |
| Secrets | Keep existing VPS secrets (`VPS_SSH_HOST`, `VPS_SSH_USER`, `VPS_SSH_KEY`, `VPS_PUBLIC_URL`, optional `VPS_SSH_PORT`, `VPS_MPLUS_ROOT`, `VPS_REPO_DIR`, `GHCR_TOKEN`) |

### Environment `production`

| Setting | Value |
|---------|-------|
| `ALLOWED_REF_PREFIX` | `refs/heads/prod` |
| Required reviewers | Enable before activation |
| Secrets | Separate production VPS paths and secrets |

## VPS requirements

Existing test deployment continues to use:

| Item | Value |
|------|-------|
| Env file | `/opt/mplus/test/.env` |
| Compose project | `mplus-test` |
| Image tags | Immutable `IMAGE_TAG=<sha>` |
| Checkout | Exact detached Git SHA (workflow fetches + `git checkout --detach`) |

**No VPS migration is required for the `main` → `test` branch change**, assuming the current test deploy already works. CD still fetches the exact SHA; a persistent branch checkout on the VPS is not required.

### Future simultaneous test + production

Use distinct `VPS_REPO_DIR` values per GitHub Environment to avoid concurrent detached-checkout races on a shared path:

| Environment | Example `VPS_REPO_DIR` |
|-------------|------------------------|
| test | `/opt/mplus/repo-test` |
| production | `/opt/mplus/repo-prod` |

Until production is activated, a single `/opt/mplus/repo` for test remains fine.

## Production activation checklist

1. Protect `prod` branch (no force, no deletion, linear history).
2. Configure `production` GitHub Environment: secrets, `ALLOWED_REF_PREFIX=refs/heads/prod`, required reviewers.
3. Prefer a dedicated `VPS_REPO_DIR` for production.
4. Ensure a candidate SHA has successfully run on **test** (images published).
5. Create `prod` at that SHA (fast-forward / controlled promotion — do not rebuild images).
6. Confirm CD deploys without rebuilding and that `/api/v1/meta` `version` equals the SHA.
7. Do **not** activate a scoring model as part of CD.

## Related docs

- [`ci-cd.md`](ci-cd.md) — workflow summary
- [`test-environment.md`](test-environment.md) — test env behaviour
- [`production.md`](production.md) — VPS layout and Environment secrets
- [`deployment.md`](deployment.md) — deploy script order
- [`rollback.md`](rollback.md) — SHA rollback
- [`model-lifecycle.md`](model-lifecycle.md) — model activation (not CD)
