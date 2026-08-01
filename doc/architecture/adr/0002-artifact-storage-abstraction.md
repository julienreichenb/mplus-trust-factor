# ADR-0002 - Artifact storage abstraction for raw WCL and calibration exports

- **Date:** 2026-08-01
- **Status:** accepted-for-planning
- **Owners:** Scoring V2 architecture (Prompt 01)
- **Checkpoint commit:** see `git rev-parse HEAD` on `agent/scoring-v2-architecture-audit`
- **Code baseline:** `bfc2c2dfc18416549b185f594de82cf965c92041`

## Context

V1 persists large event arrays inside `RunAnalysis.summary` JSONB via `createDurableSharedEvidenceStore`. Calibration V1 embeds full snapshot DTOs in `CalibrationRun.inputBundle` with a hard **4 MiB** limit (`CALIBRATION_INPUT_BUNDLE_MAX_BYTES`). V2 requires content-addressed raw pages and fact documents without unbounded JSONB.

Existing primitives: `ExternalRequest`, `ExternalPayload`, `RawArtifact`, `recordProviderResult` in `apps/worker/src/orchestration/provider-recording.ts`. Related historical ADR: [`doc/adr/0005-raw-artifact-storage.md`](../../adr/0005-raw-artifact-storage.md).

## Decision

1. Introduce a **content-addressed artifact store abstraction** (interface: put/get/exists by hash; codec: compression + content type; metadata: schema/codec/contentType/size).
2. **Reuse** `RawArtifact` / provider recording as the ledger; do **not** create a second request ledger for V2.
3. PostgreSQL holds **bounded** metadata and normalized fact JSON; **raw event pages** live in the artifact backend.
4. Calibration Input Bundle V2 stores a **root manifest** (<=4 MiB) plus **artifact references** (ADR-0005); verify refs before run (fail closed).
5. **Initial test backend:** filesystem content-addressed storage (path keyed by content hash under `RAW_ARTIFACTS_DIR` or successor).
6. **DB-backed bytes** are restricted to **small bounded fixtures** only (tests/dev fixtures under an explicit size cap). They are not the production or default test path for WCL event pages or calibration export packages.
7. **Write integrity:**
   - atomic writes (write temp + rename, or equivalent);
   - read-back hash verification after put (fail closed on mismatch);
   - reference-aware retention (do not GC artifacts still referenced by published scores, analysis batches, or calibration runs/reports).
8. Production object storage remains a later swap behind the same interface (open question in doc `18`).

## Alternatives rejected

| Option | Why rejected |
|--------|--------------|
| Keep events in `RunAnalysis.summary` | Violates doc `06`; breaks retention and replay size |
| Embed full V2 fact graphs in calibration JSONB | Exceeds 4 MiB; couples DB row size to cohort scale |
| Separate calibration-only blob store | Duplicates hash/retention logic |
| Default DB-backed bytes for large payloads | Inflates PostgreSQL; defeats artifact abstraction |

## Consequences

- Prompt 04 owns the interface + Prisma links from `EvidenceDataset` / fact sets / calibration export packages.
- Shared evidence reconstruction moves from string-key JSON inspection to hash + schema version.
- Retention must check published score and calibration run references before delete.
- Filesystem backend must be configured and writable in test before V2 evidence fetch is enabled.

## Migration / cutover implications

Shadow path writes artifacts while V1 summary may still exist; cutover stops embedding events in summary (Prompt 15). Existing `RawArtifact` URI scheme remains the ledger entry point.

## Rollback

Flags disable V2 fetch; V1 summary path remains until retirement.

## Required version bumps

Dataset / fact-set schema versions; artifact codec version.

## Evidence / tests

Atomic put + read-back hash mismatch fails closed; missing artifact blocks analysis and calibration; reference-aware GC refuses deletes with live refs; size accounting in cost ledger; fixture DB-bytes path stays under the bounded cap.
