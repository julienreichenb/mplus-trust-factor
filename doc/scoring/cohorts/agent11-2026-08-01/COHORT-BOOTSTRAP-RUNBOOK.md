# Agent 11 — cohort bootstrap runbook (test only)

Bootstraps missing Agent 11 identities into the **test** database through the
**normal resolve → refresh-character** pipeline. Separate from the read-only
evidence join CLI (`pnpm calibration:evidence-join`).

## Preconditions

| Required | Forbidden |
|----------|-----------|
| `CALIBRATION_BOOTSTRAP_ENV=test` | Production DB / production-looking hostname or database name |
| `--environment test` | Enabling `SCORING_V2_*` / `CALIBRATION_V2_*` |
| Explicit `--cohort-file` (or repo default for local only) | Direct Character / snapshot / evidence writes outside the normal service |
| Writable `--output-dir` (e.g. `/tmp/...`) | Model activation / V2 publication |
| Review dry-run plan before `--execute` | Mutating `/opt/mplus/test` checkout |

`--execute` additionally requires `ALLOW_LIVE_PROVIDER_CALLS=true` (workers/providers
may run after enqueue). Dry-run must **not** call providers, enqueue jobs, or write
to the database.

## Inputs

Mount or copy cohort artifacts into the runner (do **not** require `/app/doc/**`):

- `--cohort-file /inputs/resolved.v1.json` (Agent 11 resolved cohort)
- optional `--policy-file /inputs/midnight-season-1.meta.v1.json`
- `--output-dir /tmp/mplus-agent11-bootstrap`

## Procedure

### 1. Dry-run (plan only)

```bash
CALIBRATION_BOOTSTRAP_ENV=test \
CALIBRATION_BOOTSTRAP_DATABASE_URL="$DATABASE_URL" \
ALLOW_LIVE_PROVIDER_CALLS=false \
pnpm calibration:cohort-bootstrap -- \
  --cohort-file /inputs/resolved.v1.json \
  --environment test \
  --dry-run \
  --output-dir /tmp/mplus-agent11-bootstrap
```

Review:

- `cohort-bootstrap.plan.json`
- `cohort-bootstrap.summary.json` / `.md`

Expect ~37 `MISSING` enqueue candidates (after exclusions). Myzouth stays
`EXCLUDED` unless `--include-member user-s-eu-burning-legion-myzouth-dps`.

### 2. Execute (enqueue normal pipeline)

```bash
CALIBRATION_BOOTSTRAP_ENV=test \
CALIBRATION_BOOTSTRAP_DATABASE_URL="$DATABASE_URL" \
ALLOW_LIVE_PROVIDER_CALLS=true \
pnpm calibration:cohort-bootstrap -- \
  --cohort-file /inputs/resolved.v1.json \
  --environment test \
  --execute \
  --limit 37 \
  --concurrency 2 \
  --output-dir /tmp/mplus-agent11-bootstrap
```

### 3. Monitor queued `refresh-character` jobs

Use admin refresh-job views / worker logs. Do not invent successful jobs.

### 4. Resume / idempotent rerun

```bash
# ...same env guards...
pnpm calibration:cohort-bootstrap -- \
  --cohort-file /inputs/resolved.v1.json \
  --environment test \
  --execute \
  --resume-manifest /tmp/mplus-agent11-bootstrap/cohort-bootstrap.manifest.json \
  --output-dir /tmp/mplus-agent11-bootstrap-resume
```

Retryable failures re-enqueue only with `--retry-failures`.

### 5. After jobs settle

1. Re-run evidence join (`EVIDENCE-JOIN-RUNBOOK.md`)
2. Freeze calibration bundle when counts allow
3. Generate report

## Artifacts

| File | Role |
|------|------|
| `cohort-bootstrap.plan.json` | Deterministic per-identity plan + reasons |
| `cohort-bootstrap.manifest.json` | Resumable state, job IDs, attempt counts |
| `cohort-bootstrap.summary.json` | Machine-readable counts |
| `cohort-bootstrap.summary.md` | Operator-readable summary |

Sanitized DB target only (hostname/port/database). No credentials, raw provider
payloads, or unrestricted stack traces.

## Runtime packaging

Prefer an ephemeral container/user with mounted inputs and a writable output dir
under `/tmp`. Run as the normal non-root image user — do not `docker exec -u 0`.

Compiled entry (API image after build):

```bash
node apps/api/dist/services/calibration/cohort-bootstrap-cli.js -- ...
```

Or via workspace script (worktree / CI with pnpm):

```bash
pnpm calibration:cohort-bootstrap -- --cohort-file ... --environment test --dry-run
```
