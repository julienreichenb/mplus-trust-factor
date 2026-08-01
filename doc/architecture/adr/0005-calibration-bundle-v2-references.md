# ADR-0005 - Calibration Input Bundle V2 references

- **Date:** 2026-08-01
- **Status:** accepted-for-planning
- **Owners:** Scoring V2 architecture (Prompt 01)
- **Checkpoint commit:** see `git rev-parse HEAD` on `agent/scoring-v2-architecture-audit`
- **Code baseline:** `bfc2c2dfc18416549b185f594de82cf965c92041`

## Context

Calibration Phase 1-2 is **merged** (`feat(calibration): add admin calibration platform (#48)`). It provides durable cohorts, revision freeze on run, SHA-256 bundles, `calibration-run` queue, immutable reports, active-versus-draft, DRAFT-only model creation, and provider isolation.

Current bundle is `CalibrationInputBundleV1` (`schemaVersion: "1.0.0"`): snapshot/observations oriented via live `ScoreSnapshot` export at enqueue (`AdminCalibrationService.createRun`). Scoring V2 needs a full replay graph freeze (doc [`12_CALIBRATION_INTEGRATION.md`](../../../docs/scoring-v2/12_CALIBRATION_INTEGRATION.md)).

## Decision

1. **Preserve** the calibration platform lifecycle and tables; **do not** build a second calibration system.
2. Add **`CalibrationInputBundleV2`** alongside V1 with **explicit schema dispatch** (`inputBundleSchemaVersion`). No silent conversion of old rows.
3. V2 root bundle freezes:
   - cohort revision + expert labels (labels never from scores);
   - season binding;
   - Evidence Manifest V2 document/hash per member (final 16-slot selection after acquisition/validation);
   - normalized per-run fact-set documents/hashes;
   - active and draft `ScoreModel` configs;
   - difficulty policies, ability/mechanic catalog versions, confidence algorithm versions;
   - evidence cutoff + deterministic seed.
4. If embedded JSON would exceed **4 MiB**, store **artifact references** (ADR-0002). Each reference freezes at least:
   - `contentHash`
   - `schemaVersion`
   - `codecVersion`
   - `contentType`
   - `sizeBytes`
5. DB row keeps the root manifest plus references; **calibration preflight fails closed** on missing refs, hash mismatch, incompatible schema/codec/contentType, or size disagreement.
6. **Calibration references protect artifacts from garbage collection** (reference-aware retention in ADR-0002): an artifact cited by a calibration run/report MUST NOT be deleted while that run/report remains retained.
7. **Replace the attach path** for new V2 runs: stop depending on mutable live snapshots without frozen V2 hashes. V1 attach path remains for historical/compat runs.
8. Active-versus-draft MUST replay on **identical** V2 evidence hashes (provider-free, hash-only).
9. Reports add coverage / evidence completeness / V2 diagnostics; digests **continue to omit** population-based weight recommendations until Phase 3 gates (doc `13`).
10. `CALIBRATION_V2_ENABLED` (default false) gates V2 freeze/enqueue; platform flag `ADMIN_CALIBRATION_ENABLED` remains the outer switch.

## Alternatives rejected

| Option | Why rejected |
|--------|--------------|
| New calibration product | Duplicates queue, RBAC, UI, immutability |
| Only bump V1 fields in place | Breaks old report readability; hides semantic change |
| Keep snapshot-only forever | Cannot prove V2 reproducibility |
| Hash-only refs without schema/codec/type/size | Silent decode incompatibilities; weak GC safety |

## Consequences

- Prompt 10 serializes on Prisma/contracts/queues with 04/05/11.
- Preflight V2 gains hash/coverage/catalog and artifact-metadata checks.
- Agent 11 cohort labels remain valid inputs; evidence join CLIs are not the freeze mechanism.
- Artifact GC and retention jobs must query calibration run/report reference sets.

## Migration / cutover implications

1. Ship V2 types + dispatch.  
2. Export facts from shadow pipeline.  
3. Replay Agent 11 cohort.  
4. Compare V1 vs V2 reports.  
5. Deprecate V1 evidence attach after acceptance; keep old reports and their artifact refs.

## Rollback

Disable `CALIBRATION_V2_ENABLED`; V1 bundles/reports remain readable; referenced artifacts stay retained.

## Required version bumps

`inputBundleSchemaVersion` `2.0.0`; report schema additive fields; digest algorithm version if diagnostics change; artifact reference schema version.

## Evidence / tests

Missing/incompatible artifact ref fails preflight; hash mismatch / wrong sizeBytes blocks run; deterministic rerun; no providers/refresh; identical active/draft evidence; GC refuses artifacts still referenced by calibration; source model immutable; DRAFT-only create; queue isolation; small-slice limitations; label not from score.
