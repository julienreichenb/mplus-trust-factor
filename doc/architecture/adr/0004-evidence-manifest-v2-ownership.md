# ADR-0004 - Evidence Manifest V2 ownership

- **Date:** 2026-08-01
- **Status:** accepted-for-planning
- **Owners:** Scoring V2 architecture (Prompt 01)
- **Checkpoint commit:** see `git rev-parse HEAD` on `agent/scoring-v2-architecture-audit`
- **Code baseline:** `bfc2c2dfc18416549b185f594de82cf965c92041`

## Context

V1 selection is split: `selectScoringRuns` (1/dungeon), `selectSurvivalAnalysisRuns` (<=3, WCL-preferring), `SharedRunSelection` (1/dungeon). That violates the shared-run invariant. V2 requires a dimension-neutral **2 x active dungeons** target (16 slots for an 8-dungeon season).

Normative contract: [`docs/scoring-v2/03_WCL_EVIDENCE_SELECTION_CONTRACT.md`](../../../docs/scoring-v2/03_WCL_EVIDENCE_SELECTION_CONTRACT.md). Queue freeze points: ADR-0003.

## Decision

### Distinguish plan from final manifest

1. **`EvidenceAcquisitionPlan`** (immutable): ordered candidate list per slot, produced by the pure selector after discovery. Frozen at refresh discovery time. Includes primary and **descending fallback** candidates. Does not yet bind final reportRevision for every selected slot if revision is only known after hydration/acquisition.
2. **`EvidenceManifestV2`** (immutable): final selected runs after parallel slot acquisition, slot resolution, and fact-set validation. Frozen only then. Final slot identity is **`reportCode + fightId + reportRevision`**.

### Ownership

1. **Pure selector ownership:** `packages/scoring` (evidence-plan / selection V2 modules). Deterministic ordering and eligibility; **no** provider I/O; **no** dimension scoring; **no** parse/score/deaths as selection quality beyond documented technical validity.
2. **Contract types:** versioned schemas in `packages/contracts` (or scoring-exported contracts re-exported) owned by Prompt 02; Prisma mapping owned by Prompt 04 **after** contract freeze.
3. **Candidate supply:** `packages/providers/warcraftlogs` returns discovery/hydration candidates only (Prompt 03). Provider MUST NOT freeze the final manifest or choose dimension-specific runs.
4. **Refresh discovery:** freezes the **`EvidenceAcquisitionPlan`** (ordered candidates), not the final manifest.
5. **Acquisition:** parallel slot jobs apply descending fallback candidates; persist selected candidates, rejected candidates, fallback reasons, missing slots, and coverage.
6. **Final freeze:** worker finalize path writes immutable `EvidenceManifestV2` + slots with `contentHash` only after fact-set validation (Prompt 05 after 04).
7. **Consumers:** Performance, Survival, Utility read slots from the frozen **manifest** only - independent selectors are deprecated after cutover.
8. **Calibration** references final manifest document/hash per member (ADR-0005); it does not re-select runs and remains hash-only / provider-free.

## Alternatives rejected

| Option | Why rejected |
|--------|--------------|
| Keep selection inside `LiveWarcraftLogsProvider` | Couples retrieval to scoring policy; hard to test |
| Per-dimension manifests | Breaks shared-evidence invariant |
| Soft "preference" for Survival WCL runs in V2 ordering | Forbidden by doc `03` selection rules |
| Freeze final manifest at discovery | Skips fallback acquisition and reportRevision binding |
| Treat plan and manifest as one document | Prevents honest missing-slot / fallback audit trails |

## Consequences

- Prompt 02 and 03 may run in parallel only with agreed candidate identity (`reportCode + fightId`, plus revision when known) and pure function signatures for plan construction.
- Survival/Utility production paths must stop calling `selectSurvivalAnalysisRuns` / utility fallback selectors for scoring once V2 selection is enabled.
- Explainability and calibration reports can attribute coverage to plan vs acquisition vs validation failures.

## Migration / cutover implications

Shadow: freeze acquisition plans (and manifests when fetch/validation enabled) without changing public scores. Compare coverage/cost before enabling detailed V2 fetch.

## Rollback

`SCORING_V2_SELECTION_ENABLED=false` restores V1 selectors.

## Required version bumps

`selectorVersion`, acquisition-plan `schemaVersion`, manifest `schemaVersion`, refresh contract hash inputs.

## Evidence / tests

Property tests for deterministic plan ordering; 16-slot fixture suites; fallback descent behavior; final identity includes reportRevision; cross-dimension identical final slot IDs; persisted rejected/fallback/missing records; no score/parse in comparator.
