# Agent 11 — server-side read-only evidence join runbook

Run on the **test VPS** only. Do not copy `DATABASE_URL` to a developer laptop.
Do not expose PostgreSQL publicly. Do not commit credentials.

## Topology (canonical test Compose)

From `infra/scripts/env-lib.sh` + `infra/docker/docker-compose.app.yml` +
`infra/docker/docker-compose.test.yml`:

| Item | Value |
|------|--------|
| Compose project | `mplus-test` |
| App network (Postgres) | `mplus-test_app` (Docker bridge; **no host ports**) |
| Edge network | `mplus-proxy` (Caddy only — **not** used for DB access) |
| Postgres service DNS | `postgres` |
| Example DB name | `mplus_trust_test` |
| Deployed env file | `/opt/mplus/test/.env` (chmod 600; never copy off-box) |

`DATABASE_URL` in `/opt/mplus/test/.env` uses hostname **`postgres`**. That name resolves
**only** inside Docker networks attached to the test stack. A process on the VPS host **cannot**
reach it via that URL without publishing ports (forbidden) or joining the app network.

## Goals

Join Blizzard-enriched
`apps/api/runtime-assets/calibration/agent11-2026-08-01/resolved.v1.json`
to remote-test Character / ScoreSnapshot rows.

**Preflight-only** — do **not** freeze `bundle.v1.json` yet. Myzouth stays deferred.

## Hard constraints

| Forbidden | Required |
|-----------|----------|
| Deploy / service restart | Temporary worktree **outside** `/opt/mplus/test` |
| Mutate `/opt/mplus/test` checkout | `CALIBRATION_EVIDENCE_ENV=test` (exact) |
| Migrations / Character writes | Process-scoped `CALIBRATION_EVIDENCE_DATABASE_URL` only |
| Job enqueue / provider calls | `ALLOW_LIVE_PROVIDER_CALLS=false` |
| Publish Postgres on a public/host interface | Ephemeral container on `mplus-test_app` (or discovered `*_app`) |
| Model activation | Probe: SQLSTATE **25006** on `UPDATE regions … WHERE FALSE`; evidence tx: `transaction_read_only=on` |
| Credentials in tracked files / reports | Sanitized target only: hostname, port, database |

## Fail-closed CLI guards

`pnpm calibration:evidence-join` refuses to query until:

1. `CALIBRATION_EVIDENCE_ENV=test` (missing/other → refuse)
2. Sanitized target printed: `hostname=… port=… database=…` (no user/password/query)
3. Production-looking hostname/database refused
4. Local compose `localhost:5433` refused
5. **Dedicated probe transaction:**
   - `SET TRANSACTION READ ONLY`
   - `SHOW transaction_read_only` must be `on`
   - zero-row `UPDATE "regions" SET "code" = "code" WHERE FALSE`
   - must fail with PostgreSQL **SQLSTATE 25006** (`read_only_sql_transaction`)
   - permission denied or other SQLSTATEs are **not** accepted
   - probe transaction is rolled back/discarded
6. **Separate evidence transaction:**
   - `SET TRANSACTION READ ONLY` again
   - `SHOW transaction_read_only` must be `on` again
   - every evidence query uses that transaction client (never the root Prisma client)

Note: `CREATE TEMP TABLE` is **not** valid proof — PostgreSQL may allow temporary-table
operations inside READ ONLY transactions.

## Exact command (Docker-network path)

### 1. Temporary worktree (do not touch `/opt/mplus/test`)

```bash
# Adjust the git mirror path on the VPS if different
cd /opt/mplus/src
git fetch origin agent/11-scoring-calibration-study

WT="/tmp/mplus-agent11-calibration-$(date -u +%Y%m%dT%H%M%SZ)"
git worktree add "$WT" origin/agent/11-scoring-calibration-study
cd "$WT"
```

### 2. Run the helper (preferred)

The helper discovers the postgres container network for project `mplus-test`, attaches an
ephemeral `node:22-bookworm` container to that network, and runs the preflight join.

```bash
bash tools/scripts/calibration-evidence-join-vps.sh "$WT"
```

Equivalent expanded form (same topology):

```bash
set -a
source /opt/mplus/test/.env
set +a

export CALIBRATION_EVIDENCE_ENV=test
export CALIBRATION_EVIDENCE_DATABASE_URL="$DATABASE_URL"
export ALLOW_LIVE_PROVIDER_CALLS=false

PG_CID="$(docker compose -p mplus-test ps -q postgres | head -n1)"
APP_NET="$(docker inspect -f '{{range $k, $_ := .NetworkSettings.Networks}}{{println $k}}{{end}}' "$PG_CID" | awk '/_app$/ {print; exit}')"
# Expect: mplus-test_app

docker run --rm \
  --network "$APP_NET" \
  -v "$WT:/workspace" \
  -w /workspace \
  -e CALIBRATION_EVIDENCE_ENV=test \
  -e ALLOW_LIVE_PROVIDER_CALLS=false \
  -e "CALIBRATION_EVIDENCE_DATABASE_URL=$CALIBRATION_EVIDENCE_DATABASE_URL" \
  node:22-bookworm \
  bash -lc 'corepack enable && corepack prepare pnpm@10.14.0 --activate && pnpm install --frozen-lockfile && pnpm calibration:evidence-join -- --preflight-only'
```

Expected console lines before queries:

```text
CALIBRATION_EVIDENCE_ENV=test
evidenceDbTarget: hostname=postgres port=5432 database=mplus_trust_test
read_only_probe: transaction_read_only=on sqlState=25006
transaction_read_only=on
```

(Database name may differ if the operator renamed `POSTGRES_DB`; production-looking names fail closed.)

### 3. Copy artifacts back (no secrets)

```bash
scp -r user@test-vps:"$WT/tmp/calibration/agent11-2026-08-01/evidence-join.*" ./tmp/calibration/agent11-2026-08-01/
```

| File | Contents |
|------|----------|
| `evidence-join.summary.json` | Counts + Myzouth + season/model + Phase B estimate |
| `evidence-join.preflight.json` | Full per-member join (private) |
| `evidence-join.preflight.md` | Human-readable preflight |

Do **not** copy `/opt/mplus/test/.env`.

### 4. Cleanup

```bash
cd /opt/mplus/src
git worktree remove "$WT" --force
```

## First-pass counts to record

From `evidence-join.summary.json` `counts` (+ Myzouth / season blocks):

- identities found / missing in test DB
- complete vs incomplete Blizzard bootstrap rows
- compatible v6 / stale / no snapshot
- members requiring score refresh (estimate only — **not approved**)
- Myzouth Character ID (expect `4e2e51ee-9e77-44a0-ba82-4d24a68b4486`) + deferred status
- season/model compatibility
- `probeSqlState: "25006"`
- `transactionReadOnly: "on"`
- sanitized `evidenceDbTarget`

## Myzouth follow-up

After bootstrap-recovery is merged **and** deployed to test, re-run **only** this evidence join
(same script). Verify ID preservation + bootstrap + snapshot (or keep deferred). Do not freeze
the bundle until that pass completes.
