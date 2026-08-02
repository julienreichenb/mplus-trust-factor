# Scoring V2 persistence — migration and test reset

Normative model: [`../architecture/database.md`](../architecture/database.md),
ADR [`../adr/0006-scoring-v2-persistence.md`](../adr/0006-scoring-v2-persistence.md),
spec [`.cursor-orchestration/mplus-scoring-v2-agent-kit/docs/scoring-v2/06_DATA_MODEL_PERSISTENCE_RETENTION.md`](../../.cursor-orchestration/mplus-scoring-v2-agent-kit/docs/scoring-v2/06_DATA_MODEL_PERSISTENCE_RETENTION.md).

## Empty database migration validation

```bash
# Against a disposable Postgres (never shared mplus_trust / prod):
export DATABASE_URL=postgresql://…/mplus_itest_manual01
pnpm db:migrate
pnpm db:seed
```

Expected: migration `20260802120000_scoring_v2_persistence` applies cleanly on an
empty database and on an upgraded test schema (V1 rows retained).

## Upgrade path (current test schema)

1. Backup: `pg_dump` the target test database.
2. `pnpm db:migrate` — additive V2 tables; `raw_artifacts.content_hash` becomes unique
   (duplicates collapsed to the oldest row).
3. Deploy code that uses `@mplus/artifact-store` / repositories.
4. Do **not** enable V2 scoring flags in this workstream.

## Calibration label export / import

Before any destructive reset:

```bash
pnpm db:calibration-labels:export -- --out=./calibration-labels.json
# … reset …
pnpm db:calibration-labels:import -- --in=./calibration-labels.json
```

Exports cohort membership expected labels (`calibration-labels/v1`). Does not
export frozen calibration run bundles.

## Guarded test reset (Option A)

```bash
# Dry-run (default)
pnpm db:reset:scoring-v2 -- --confirm=RESET_SCORING_V2_TEST_DATA

# Execute truncate (still blocked for prod / mplus_trust / *prod* names)
pnpm db:reset:scoring-v2 -- --confirm=RESET_SCORING_V2_TEST_DATA --execute

# Explicit local *_test DB (non-disposable naming)
pnpm db:reset:scoring-v2 -- --confirm=RESET_SCORING_V2_TEST_DATA --allow-named-test-db --execute
```

Guards:

- `APP_ENV` must be `test` or `development` (never `production` / `staging`)
- confirmation token `RESET_SCORING_V2_TEST_DATA`
- database name must be disposable `mplus_itest_*` (or named `*_test` with flag)
- names containing `prod` or the shared `mplus_trust` DB are refused

### Tables truncated

See `SCORING_V2_RESET_TRUNCATE_TABLES` in
`packages/database/src/reset/v2-test-reset-guard.ts`
(evidence/score/run/provider payloads, refresh jobs, raw artifacts).

### Tables retained

Identity/IAM, region/realm/season/dungeon catalogs, characters, score models,
metric/red-flag definitions, mechanic rules, calibration cohorts/members.

## Rollback / backup

1. Always `pg_dump` before `--execute`.
2. To roll back a failed migration: restore the dump; do not invent reverse SQL
   for production.
3. Artifact files under `RAW_ARTIFACTS_DIR` are not restored by SQL — back up that
   directory alongside the dump when retaining evidence blobs.

## Out of scope

- No production destructive command.
- No provider wiring, scoring activation, or live data reset without explicit approval.
