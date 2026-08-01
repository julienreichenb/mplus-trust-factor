# ADR-0003 - Scoring V2 queue topology

- **Date:** 2026-08-01
- **Status:** accepted-for-planning
- **Owners:** Scoring V2 architecture (Prompt 01)
- **Checkpoint commit:** see `git rev-parse HEAD` on `agent/scoring-v2-architecture-audit`
- **Code baseline:** `bfc2c2dfc18416549b185f594de82cf965c92041`

## Context

Today `refresh-character` runs a large inline DAG (`runRefreshPipeline`). `analyze-run` exists for admin/backfill but refresh often analyzes inline. `finalize-score` is named in `QUEUE_NAMES` without a worker. `calibration-run` is isolated and must stay off the IngestionJob / refresh admission path.

Normative DAG: [`docs/scoring-v2/05_PIPELINE_ORCHESTRATION_AND_PARALLELISM.md`](../../../docs/scoring-v2/05_PIPELINE_ORCHESTRATION_AND_PARALLELISM.md). Evidence selection ownership: ADR-0004.

## Decision

### Two freeze points (plan then manifest)

1. **Discovery / refresh orchestration** freezes an immutable **`EvidenceAcquisitionPlan`** (ordered candidates per slot, including descending fallbacks). It does **not** freeze the final `EvidenceManifestV2`.
2. **Parallel slot acquisition** jobs walk each slot's ordered candidates (primary then descending fallbacks), acquire provider data, and persist outcomes.
3. **`EvidenceManifestV2` is frozen only after** slot resolution and fact-set validation succeed for the batch policy (including explicit missing-slot / coverage state).
4. Final slot identity is `reportCode + fightId + reportRevision` (revision known before final freeze).

### Queue roles

| Queue | Role |
|-------|------|
| `refresh-character` | Orchestrator: identity, discovery, hydrate metadata, **freeze EvidenceAcquisitionPlan**, plan/reserve cost, enqueue acquisition jobs |
| `analyze-evidence-slot` (or successor acquisition name) | **New** - provider-aware per-slot acquisition over ordered fallback candidates; persists selected/rejected candidates, fallback reasons, missing slots |
| `finalize-analysis-batch` | **New** (evolve unused `finalize-score`) - fan-in, fact-set validation, **freeze EvidenceManifestV2**, dimension aggregate, coverage/coherence |
| `recalculate-score` | Provider-free replay from existing fact sets / models (**hash-only**) |
| `calibration-run` | **Preserve** - provider-free backtests (**hash-only**); never refresh admission |
| Existing addon / discovery / bulk | Unchanged ownership |

### Job payload rules

1. **Provider-aware acquisition jobs MUST NOT require content hashes that do not exist yet.** Payloads carry plan/slot/candidate IDs, expected plan hash, and acquisition parameters - not final fact-set hashes.
2. **Replay / recalculate / calibration jobs remain provider-free and hash-only** (expected manifest hash, fact-set hashes, model refs).
3. Do **not** place calibration on refresh IngestionJob lifecycle.
4. Version job payloads (`AcquireEvidenceSlotJobV2`, `FinalizeEvidenceBatchJobV2`, etc.).
5. Evolve or replace `analyze-run` after slot acquisition lands; avoid dual semantics indefinitely.
6. Refresh admission / ETA / concurrency flags remain the fairness substrate.

### Persistence required from the pipeline

Persist for each plan/batch: selected candidates, rejected candidates, fallback reasons, missing slots, and final coverage state (feeds explainability and calibration reports).

## Alternatives rejected

| Option | Why rejected |
|--------|--------------|
| Keep monolithic refresh forever | Cannot meet slot parallelism or partial-failure isolation |
| Freeze final manifest at discovery | Manifest identity needs reportRevision + validated facts |
| Run calibration on `recalculate-score` | Couples admin backtests to character refresh semantics |
| Fan-out inside one BullMQ job without child queues | Weak idempotency and rate control |
| Require fact hashes on acquisition enqueue | Hashes do not exist until acquisition completes |

## Consequences

- Prompt 05 owns `packages/contracts/src/jobs.ts`, `queues.ts`, `processors.ts`, refresh orchestration edits - **serialize** with Prompt 10.
- Publication remains fail-closed until batch terminal + coverage gates + frozen manifest.
- Acquisition failures degrade coverage / missing slots; they do not invent evidence.

## Migration / cutover implications

Flags: selection/plan -> evidence fetch/acquisition -> dimensions -> publication (doc `14`). Slot workers no-op when flags off. Shadow freezes plans and (when fetch enabled) manifests without flipping `CharacterPublishedScore`.

## Rollback

Disable V2 pipeline flags; resume V1 inline refresh path.

## Required version bumps

Job schema versions; acquisition-plan and analysis-batch contract versions.

## Evidence / tests

Idempotent dedupe keys; acquisition jobs run without pre-existing fact hashes; finalize rejects incomplete validation; recalculate/calibration never call providers; calibration isolation tests remain green; persisted rejection/fallback/missing-slot records round-trip.
