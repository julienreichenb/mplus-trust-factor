# ADR-0001 - Hard reset versus dual-write for Scoring V2 persistence

- **Date:** 2026-08-01
- **Status:** accepted-for-planning
- **Owners:** Scoring V2 architecture (Prompt 01)
- **Checkpoint commit:** see `git rev-parse HEAD` on `agent/scoring-v2-architecture-audit`
- **Code baseline:** `bfc2c2dfc18416549b185f594de82cf965c92041`

## Context

Scoring V2 needs first-class Evidence Manifest, slot, dataset, and fact-set entities. V1 overloads `RunAnalysis.summary` with event arrays and uses incompatible one-run / multi-run selectors. The product is still **test-oriented** (`APP_ENV=test` promotion path); experimental score rows are not a production archive of record.

Normative guidance: [`docs/scoring-v2/06_DATA_MODEL_PERSISTENCE_RETENTION.md`](../../../docs/scoring-v2/06_DATA_MODEL_PERSISTENCE_RETENTION.md), [`14_MIGRATION_ROLLOUT_AND_FEATURE_FLAGS.md`](../../../docs/scoring-v2/14_MIGRATION_ROLLOUT_AND_FEATURE_FLAGS.md).

## Decision

1. **Schema:** Prefer a **coherent V2 schema** over permanent dual tables for the same concept. In **test**, a **destructive reset** of scoring/evidence rows is allowed when gated (backup, `APP_ENV=test`, typed confirmation, no production hostname, calibration label export).
2. **Runtime scoring:** Use **progressive dual-run / shadow** (V1 public pointer unchanged while V2 computes `SHADOW`) until cutover gates pass - do not hard-cut public scores in one step.
3. **Calibration platform tables** (`CalibrationCohort*`, `CalibrationRun`, `CalibrationReport`) are **preserved**. Bundle schema is **versioned** (V1 retained readable; V2 added), not wiped casually. Export expert labels before any test DB reset.
4. **Historical V1 snapshots** remain readable after cutover until an explicit retention review (Prompt 15).

## Alternatives rejected

| Option | Why rejected / deferred |
|--------|-------------------------|
| Permanent dual-write of V1+V2 evidence models | Long-term complexity; competing selectors |
| Immediate public hard cutover | No shadow comparison; calibration risk |
| Never reset test data | Forces compatibility shims that fight invariants |

## Consequences

- Prompt 04 may ship migrations that drop or rebuild evidence-related structures in test after gates.
- Feature flags default off; public pointer stays V1 until Stage 6+ approval.
- Calibration V1 reports survive; V2 runs are new rows.

## Migration / cutover implications

Follow doc `14` stages 0->8. Destructive reset checklist is mandatory before wipe.

## Rollback

Keep previous DB backup; re-point flags off; restore V1 refresh path. Do not delete calibration reports.

## Required version bumps

New evidence/manifest/fact schema versions; score model algorithm versions when dimensions change (later prompts).

## Evidence / tests

Reset procedure tests (env guards); shadow publication never mutates `CharacterPublishedScore` while `SCORING_V2_PUBLICATION_ENABLED=false`.
