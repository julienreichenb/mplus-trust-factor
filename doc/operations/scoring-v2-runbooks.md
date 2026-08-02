# Scoring V2 — alerts and runbooks

Operational responses for cost gates, schema failures, stuck batches, artifacts, version skew, rollback, and destructive test reset. Shadow V2 remains fail-closed: do not enable publication without an explicit cutover prompt.

## Budget defer / stop

**Signals**

- Events: `scoring_v2.admission_deferred`, `scoring_v2.admission_stopped`
- Metrics: `scoring_v2_admission_total{action="deferred|stopped"}`
- WCL helper: `computeWclBudgetSnapshot` → `shouldDefer` / `shouldStop`

**Response**

1. Confirm Redis admission snapshot freshness on the worker (`/health/ready` detail / admission logs).
2. If `STOP`: halt new V2 fan-out; wait for hourly reset (`resetAt`).
3. If `DEFER`: leave batches in deferred admission; do not manually force fan-out.
4. Check for cache/artifact reuse regressions (unexpected `dataset_fetched` spike).
5. Do not raise point budgets without product approval.

## Schema unsupported

**Signals**

- Provider errors with `SCHEMA_UNSUPPORTED`
- Invalid-candidate / truncation spikes
- Dataset outcome `truncated` growth

**Response**

1. Identify dataset key / GraphQL field from sanitized logs (no report codes).
2. Freeze live probes; reproduce with fixtures.
3. Add adapter guard or mark candidate invalid — never fabricate empty OK.
4. Re-run golden replay after fixture/version bump.

## Stuck batches

**Signals**

- Queue age/depth elevated (`scoring_v2_queue_age_ms`, `queue_depth_snapshot`)
- Batches in `ANALYZING` / `READY_TO_FINALIZE` / `FINALIZING` beyond SLA
- Missing `scoring_v2.batch_finalized`

**Response**

1. Check worker liveness and Redis connectivity.
2. Inspect slot terminal states (FAILED / CANCELLED / SUPERSEDED) via admin Scoring V2 diagnostics.
3. For `FINALIZING` stuck after crash: redelivery should reclaim via CAS; do not double-finalize manually.
4. Cancel superseded generations; do not re-spend WCL for terminal slots.

## Partial artifacts

**Signals**

- Artifact write failures / `scoring_v2_artifact_orphans_total`
- Fact-set missing while raw blob present (or reverse)
- Finalize release → redelivery loops on dimension persist

**Response**

1. Verify `RAW_ARTIFACTS_DIR` writable (API/worker readiness `artifactBackend`).
2. Prefer content-addressed re-write (dedupe by hash); delete only orphans with no DB refs.
3. Never publish partial manifests.
4. Use [scoring-v2-persistence-reset.md](./scoring-v2-persistence-reset.md) only on disposable test DBs.

## Version skew

**Signals**

- `/health/ready` / `/api/v1/meta` `revision` ≠ running `IMAGE_TAG`
- Job `schemaVersion` mismatch (`2.0.0` expected)
- API vs worker contract mismatch in readiness `contracts`

**Response**

1. Stop rollout; compare web/api/worker image digests.
2. Roll forward to a consistent SHA or [rollback](./rollback.md) all three app services together.
3. Drain V2 queues before mixing job schema versions.

## Rollback

Follow [rollback.md](./rollback.md). Scoring V2 flags stay default-off; rolling back images does not require DB down-migrations. Redis loss is acceptable — scores live in Postgres.

## Destructive test reset

Follow [scoring-v2-persistence-reset.md](./scoring-v2-persistence-reset.md):

- Confirmation token `RESET_SCORING_V2_TEST_DATA`
- Environment guards / named test DB allowlist
- Never run against production

## Security notes

- Logs must use fingerprints for character ids/names and masked report codes (`@mplus/observability`).
- Never paste raw WCL report codes, OAuth tokens, or BattleTags into tickets.

## Deferred blocker — Calibration V2 active/draft

`CALIBRATION_V2_ACTIVE_DRAFT_ARCH_BLOCKER`

Keep `CALIBRATION_V2_ENABLED` **disabled** until calculator model-config injection supports real active-versus-draft replay. Export replay remains available; do not enable calibration V2 or fabricate active/draft deltas.

## Live fact extraction status (WS12.5)

See [scoring-v2-live-facts-status.md](../scoring/scoring-v2-live-facts-status.md) for CP1–CP4 delivery, fixture shadow gate (Prompt 13 GO / production NO-GO), and flag enablement gates.

## Deferred — cost-source metrics

Classification of WCL cost as frozen / provider-estimated / unknown is deferred to avoid changing existing `scoring_v2_wcl_points_total` label contracts. Track via dataset persistence `costSource` until a dedicated metric series is introduced.
