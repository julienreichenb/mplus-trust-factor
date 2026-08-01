# ADR-0006 - Scoring V1 / V2 cutover

- **Date:** 2026-08-01
- **Status:** accepted-for-planning
- **Owners:** Scoring V2 architecture (Prompt 01)
- **Checkpoint commit:** see `git rev-parse HEAD` on `agent/scoring-v2-architecture-audit`
- **Code baseline:** `bfc2c2dfc18416549b185f594de82cf965c92041`

## Context

Public Trust Score today is model v6 with V1 evidence selection. V2 changes evidence breadth and dimension inputs. Cutover must not invent scores from missing evidence, must remain reproducible, and must not activate models via env flips (`doc/operations/model-lifecycle.md`).

Normative rollout: [`docs/scoring-v2/14_MIGRATION_ROLLOUT_AND_FEATURE_FLAGS.md`](../../../docs/scoring-v2/14_MIGRATION_ROLLOUT_AND_FEATURE_FLAGS.md).

## Decision

1. **Staged flags** (all default false / fail closed):

   ```text
   SCORING_V2_ENABLED
   SCORING_V2_SELECTION_ENABLED
   SCORING_V2_EVIDENCE_FETCH_ENABLED
   SCORING_V2_DIMENSIONS_ENABLED
   SCORING_V2_PUBLICATION_ENABLED
   SCORING_V2_{PERFORMANCE,SURVIVAL,UTILITY,EXPERIENCE}_ENABLED
   SCORING_V2_RELATIVE_DAMAGE_MODE=off|shadow|active
   SCORING_V2_UTILITY_OPPORTUNITY_MODE=off|shadow|active
   SCORING_V2_REFERENCE_COMPARISON_MODE=off|collect|shadow|active
   CALIBRATION_V2_ENABLED
   ```

2. **Startup validation for impossible flag combinations** (API and worker readiness; fail closed / refuse boot or refuse V2 work):
   - `SCORING_V2_PUBLICATION_ENABLED` requires `SCORING_V2_ENABLED`, selection, evidence fetch, and dimensions (or equivalent proven prerequisites).
   - Any dimension flag (`SCORING_V2_PERFORMANCE_ENABLED`, etc.) requires `SCORING_V2_DIMENSIONS_ENABLED` and `SCORING_V2_ENABLED`.
   - `SCORING_V2_EVIDENCE_FETCH_ENABLED` requires `SCORING_V2_SELECTION_ENABLED`.
   - `SCORING_V2_*_MODE=active` (relative damage / utility opportunity / reference comparison) is rejected unless Phase gates and parent V2 flags allow it.
   - `CALIBRATION_V2_ENABLED` requires `ADMIN_CALIBRATION_ENABLED`.
   - API and worker must agree on the validated flag matrix in readiness diagnostics.

3. **SHADOW persistence semantics:**
   - V2 may compute and persist rows marked `SHADOW` (snapshots/dimensions/diagnostics) while the public pointer remains V1.
   - Shadow rows are durable for comparison, calibration export, and forensics.
   - Shadow execution **MUST NOT** insert/update/delete `CharacterPublishedScore`.
   - Shadow execution **MUST NOT** flip `ScoreSnapshot` public publication flags used by the live pointer.
   - Enabling shadow does not imply publication eligibility.

4. **Calibration gate:** successful **Calibration V2** report on frozen evidence before any V2 model activation candidate.
5. **Activation:** audited admin/DB model lifecycle only - never env-only activation; calibration API stays DRAFT-create-only.
6. **Test cutover** (Stage 6) may rebuild test scores after ADR-0001 reset gates; **production** only after explicit approval (Stage 7+).
7. **Phase 3 population comparisons** stay `off`/`collect`/`shadow` until critical-mass gates (doc `13`); no public population recommendations in calibration digests before that.
8. **V1 retirement** (Prompt 15) only after historical readability or intentional test reset.

## Alternatives rejected

| Option | Why rejected |
|--------|--------------|
| Big-bang public cutover | No calibration proof; evidence regression risk |
| Env-var model activation | Conflicts with model-lifecycle policy |
| Enable Phase 3 with Phase 1 | Population gates unmet; fairness risk |
| Shadow that reuses public pointer tables without isolation | Risk of accidental publication |

## Consequences

- Dual-run comparison reports must expose **evidence differences** (V1 one-run vs V2 16-slot), not only score deltas.
- Provider calls shared where compatible during shadow to control cost.
- UI comparison behind admin before public pointer flip.
- Startup/readiness becomes a hard gate for misconfigured flag sets.

## Migration / cutover implications

Follow stages 0-8 in doc `14`. Promote via existing `pnpm promote:test` only when instructed. Shadow stages must ship with automated proof that `CharacterPublishedScore` is untouched.

## Rollback

Disable publication/dimension flags; keep V1 pointer; retain V2 shadow rows for forensics; activate prior `ScoreModel` via admin.

## Required version bumps

Active `ScoreModel` version for V2; public snapshot schema additive explain fields; shadow persistence schema labels.

## Evidence / tests

Flag matrix readiness diagnostics (API/worker agree); impossible combinations fail startup/readiness; shadow path integration test proves zero mutations to `CharacterPublishedScore`; shadow never publishes; cutover checklist including calibration report presence; no Phase 3 active without gates.
