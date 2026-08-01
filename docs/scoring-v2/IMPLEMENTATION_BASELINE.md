---
status: accepted-for-planning
normative: true
last_reviewed: 2026-08-01
checkpoint_commit: 87ccefc329e64f6cc2b7d00c9d4f6b0c5e263188
code_baseline: bfc2c2dfc18416549b185f594de82cf965c92041
calibration_merged: feat(calibration): add admin calibration platform (#48)
prior_kit_baseline: 0b0d911f9c4f3ec771bd8f2390e972da01595f99
---

# Scoring V2 â€” Implementation baseline

Read-only architecture audit of the repository at code baseline `bfc2c2d` (calibration platform Phase 1â€“2 merged). Checkpoint commit recorded in frontmatter. No runtime, schema, formula, queue, or flag changes were made in this checkpoint.

Classification legend used below:

| Tag | Meaning |
|-----|---------|
| **reusable** | Keep and extend |
| **incompatible** | Present but wrong semantics for V2 |
| **missing** | Required by Scoring V2, not in code |
| **research-only** | Probes/scripts/docs; not production path |
| **calibration-platform** | Shipped admin calibration foundation to preserve |

Normative product specs live in this directory (`00`â€“`21`). This file is the **code-backed** reuse map. It supersedes the kit snapshot in [`19_CURRENT_REPOSITORY_AUDIT.md`](./19_CURRENT_REPOSITORY_AUDIT.md) for planning decisions.

---

## 1. Verdict

1. **Calibration platform is the foundation to adapt**, not rebuild: durable cohorts, revision freeze on run, SHA-256 bundles, dedicated `calibration-run` queue, immutable reports, active-versus-draft, DRAFT-only model creation, no provider/refresh coupling.
2. **Evidence selection is the hard incompatibility**: production still selects **one run per dungeon** (`selectScoringRuns`) and Survival may select **up to three** with WCL preference (`selectSurvivalAnalysisRuns`). V2 requires one immutable **16-slot** (2Ã—active dungeons) Evidence Manifest shared by Performance, Survival, and Utility.
3. **Persistence is overloaded**: shared evidence embeds event arrays in `RunAnalysis.summary`. V2 needs content-addressed artifacts + normalized fact sets; calibration V2 must freeze **hashes**, not live snapshot copies alone.
4. **Test-only posture allows destructive schema reset** under gated `APP_ENV=test` procedures (see ADR-0001). Progressive **shadow dual-run** remains required for scoring correctness comparison before public cutover.
5. **Population / Phase 3 recommendations stay postponed** until critical-mass gates in [`13_REFERENCE_COHORTS_AND_PHASE3_COMPARISONS.md`](./13_REFERENCE_COHORTS_AND_PHASE3_COMPARISONS.md). Calibration digests already omit weight-change recommendations (`buildCalibrationDigestV1`).

---

## 2. Calibration platform (preserve)

### 2.1 What shipped (Phase 1 DB + Phase 1â€“2 admin surface)

| Concern | Path / symbol | Status |
|---------|---------------|--------|
| Prisma models | `CalibrationCohort`, `CalibrationCohortMember`, `CalibrationRun`, `CalibrationReport` in `packages/database/prisma/schema.prisma` | **calibration-platform / reusable** |
| Migration | `packages/database/prisma/migrations/20260801160000_admin_calibration_platform/migration.sql` | **reusable** |
| Contracts | `packages/contracts/src/calibration.ts` â€” `CALIBRATION_INPUT_BUNDLE_MAX_BYTES` (4 MiB), `calibrationRunJobSchema`, run/report DTOs | **reusable** |
| Queue | `QUEUE_NAMES.calibrationRun = "calibration-run"` in `packages/contracts/src/jobs.ts` | **reusable** |
| Freeze | `freezeBundleJson` in `apps/api/src/services/admin-calibration-service.ts` â€” SHA-256 + byte length fail-closed | **reusable** |
| Run create | `AdminCalibrationService.createRun` â€” freezes `cohortRevision`, model configs, `inputBundle*` | **reusable shell; incompatible evidence** |
| Worker | `runCalibrationRunJob` in `apps/worker/src/orchestration/calibration-run.ts`; wired in `apps/worker/src/processors.ts` with `{ prisma, logger, calibrationEnabled }` only | **reusable** |
| Harness | `packages/scoring/src/calibration/*` â€” `runCalibrationHarness`, `buildActiveDraftComparison`, `buildCalibrationDigestV1`, ranking/stats/reports | **reusable** |
| DRAFT models | `AdminCalibrationService.createDraftScoreModel` â€” clones via score repository; **no activate route** on calibration API | **reusable** |
| Flags | `ADMIN_CALIBRATION_ENABLED` (`packages/config`), `VITE_ADMIN_CALIBRATION_ENABLED` (`apps/web`) â€” default false | **reusable** |
| Isolation tests | `apps/worker/src/orchestration/calibration-isolation.test.ts`, `apps/api/src/routes.admin-calibration.test.ts` | **reusable** |
| UI | `AdminCalibrationPage.vue`, `AdminCalibrationReportPage.vue` | **reusable** |

Immutability invariants already encoded:

- `CalibrationRun.cohortRevision` â€” â€œnever updated after enqueueâ€
- `inputBundle` / `inputBundleContentHash` / `inputBundleByteLength` frozen at create
- `CalibrationReport` 1:1 with `contentHash`; onDelete Restrict from run
- Cohort mutations bump `CalibrationCohort.revision`; frozen runs keep prior revision + bundle

### 2.2 Current evidence bundle (V1) â€” replace/version for Scoring V2

**Implemented:** `CalibrationInputBundleV1` / `CALIBRATION_INPUT_BUNDLE_SCHEMA_VERSION = "1.0.0"` in `packages/scoring/src/calibration/types.ts`, validated by `validateCalibrationInputBundle` (`bundle.ts`).

Frozen today:

- cohort manifest + expert labels (never derived from score);
- optional active/evaluation `CalibrationModelRef`;
- per-member **`snapshot` + `observations` + `scoringContext`** (`CalibrationMemberEvidence`);
- `generatedAt`, `source: "fixture" | "persisted-export"`.

**How evidence is attached at enqueue (incompatible with V2 replay graph):**

`AdminCalibrationService.createRun` / `selectSnapshot` reads the latest public `ScoreSnapshot` and metrics from the live DB, then embeds them into `evidenceByMemberId`. That freezes a **V1 snapshot export**, not Evidence Manifest V2 + fact-set hashes.

**Missing vs [`12_CALIBRATION_INTEGRATION.md`](./12_CALIBRATION_INTEGRATION.md):**

| V2 requirement | Status |
|----------------|--------|
| `CalibrationInputBundleV2` / `schemaVersion: "2.0.0"` | **missing** |
| Freeze 16-slot Evidence Manifest document + hash per member | **missing** |
| Freeze normalized per-run fact-set documents + hashes | **missing** |
| Freeze difficulty policies, ability/mechanic catalog versions, confidence algorithm versions | **missing** (only loose `algorithmVersions` Json on run) |
| Root manifest + content-addressed artifact refs when >4 MiB | **missing** (hard 4 MiB fail-closed only) |
| V2 preflight (hash resolve, coverage policy, catalog install, no provider work) | **partial** (bootstrap/snapshot/replay preflight exists) |
| Active/draft replay on **identical Scoring V2 evidence** | **partial** (identical V1 fingerprint today; must bind to V2 hashes) |
| Coverage / evidence completeness / V2 diagnostics in reports | **missing** / generic only |
| Population-based weight recommendations | **correctly postponed** (digest has none) |
| Explicit V1/V2 schema dispatch | **missing** |

### 2.3 Scoring V2 adaptation map (normative for Prompt 10)

Preserve platform lifecycle; **version the bundle**:

```text
V1 path (retain readable):
  cohort + labels â†’ public ScoreSnapshot export â†’ harness â†’ report

V2 path (add):
  cohort + labels
    â†’ Evidence Manifest V2 (16 slots, contentHash)
    â†’ per-slot RunFactSet documents (contentHash)
    â†’ frozen ScoreModel configs + policy/catalog/confidence versions
    â†’ provider-free dimension replay (active and/or draft)
    â†’ report + digest with coverage/completeness slices
```

Rules:

1. **Never mutate** an existing `CalibrationRun.inputBundle*`.
2. Refresh evidence â‡’ new manifest/fact generation â‡’ new cohort revision or explicit evidence revision â‡’ **new** calibration run.
3. Active-versus-draft MUST prove identical member evidence hashes (manifest + fact sets), not merely identical V1 snapshot ids.
4. Calibration MUST NOT call providers or enqueue refresh (`providerCallsMade: false` already asserted).
5. Population / Phase 3 recommendation language stays out of digests until gates in Â§7 of this file and doc `13` are met.

Study tooling (Agent 11) under `apps/api/src/services/calibration/*` and `doc/scoring/cohorts/agent11-2026-08-01/` remains **research / intake** â€” useful for cohort labels, not a substitute for V2 freeze.

---

## 3. WCL discovery, hydration, shared evidence, cost

| Capability | Path / symbol | Tag |
|------------|---------------|-----|
| GraphQL ops | `packages/providers/warcraftlogs/src/operations/queries.ts` | **reusable** |
| Discovery | `run-discovery.ts`, `bounds.ts` (`MAX_DISCOVERY_CANDIDATES=25`, `MAX_HYDRATION_REPORTS=5`) | **reusable**; bounds **incompatible** with V2 (~10/dungeon, ~80 total) |
| Hydration / matching | `report-hydration.ts`, `run-matching.ts`, `LiveWarcraftLogsProvider` | **reusable** |
| Profile aggregates | `points-and-damage-performance.ts` | **reusable** (Performance stabilizer) |
| Shared evidence types | `wcl-run-evidence-types.ts`, `wcl-run-evidence.ts`, `shared-evidence-ingest.ts` | **reusable** fetch/reuse concepts |
| Shared selection | `SharedRunSelection` / `SHARED_RUN_SELECTION_ANALYSIS_VERSION = "wcl-shared-run-selection-v1"` â€” **one run/dungeon** | **incompatible** |
| Durable store | `apps/worker/src/orchestration/shared-evidence-store.ts` â€” events in `RunAnalysis.summary` | **incompatible** persistence |
| Cost | `wcl-batch-cost-accounting.ts`, `rate/rate-budget.ts`, `refresh-cost-ledger.ts` | **reusable** |

Probes under `packages/providers/warcraftlogs/src/probe/*` and `tools/scripts/wcl-*-probe*` are **research-only**.

---

## 4. Blizzard and Raider.IO

| Provider | Capability | Tag |
|----------|------------|-----|
| Blizzard | Identity, equipment, talents, M+ season profile/runs, season authority â€” `LiveBlizzardProvider` | **reusable** |
| Blizzard achievements / prior-season strength for Experience V2 | | **missing** |
| Raider.IO | `getCharacterProfile` with current/previous scores/ranks â€” `MINIMAL_CHARACTER_FIELDS` | **reusable** as optional fill-in |
| Raider.IO as primary Experience source | Forbidden by V2; optional only | Keep constrained |

---

## 5. Run selection (Performance / Survival / Utility)

| Selector | Symbol | Policy | Tag |
|----------|--------|--------|-----|
| Scoring / Performance path | `selectScoringRuns` in `packages/scoring/src/selection/scoring-run-selection.ts` | Exactly **1** run/dungeon; key â†’ score â†’ latest | **incompatible** |
| Survival | `selectSurvivalAnalysisRuns` in `survival-run-selection.ts` | Up to **3**/dungeon; prefers WCL-logged | **incompatible** |
| Shared evidence / Utility | `SharedRunSelection` | **1** run/dungeon | **incompatible** |
| Active dungeon pool | `resolveActiveSeasonDungeonPool` | | **reusable** |

`apps/worker/src/orchestration/refresh-pipeline.ts` invokes both `selectScoringRuns` and `selectSurvivalAnalysisRuns` in one refresh â€” **breaks** the shared-manifest invariant in [`03_WCL_EVIDENCE_SELECTION_CONTRACT.md`](./03_WCL_EVIDENCE_SELECTION_CONTRACT.md).

**Missing:** pure Evidence Manifest V2 selector, 16-slot freeze, dimension-neutral ordering (no parse/score/deaths in selection).

---

## 6. Refresh pipeline and BullMQ topology

Queues in `QUEUE_NAMES` (`packages/contracts/src/jobs.ts`):

| Queue | Worker today | V2 fate |
|-------|--------------|---------|
| `refresh-character` | `runRefreshPipeline` | Keep as orchestrator; shrink inline analysis |
| `analyze-run` | `runAnalyzeRun` (admin/backfill; refresh often inline) | Evolve or replace with slot jobs |
| `recalculate-score` | `runRecalculateScore` | Keep provider-free replay; bind to fact sets |
| `finalize-score` | **Named only â€” no worker** | Replace/repurpose as `finalize-analysis-batch` |
| `calibration-run` | `runCalibrationRunJob` | **Preserve isolation** |
| addon / discovery / bulk | present | Unchanged ownership |

Refresh stages remain a large synchronous DAG in `refresh-pipeline.ts` (`REFRESH_STAGES`). Admission/ETA (`refresh-admission/*`, `REFRESH_*` flags) is **reusable** fairness substrate.

**Missing:** `analyze-evidence-slot`, `finalize-analysis-batch`, versioned V2 job payloads from [`05_PIPELINE_ORCHESTRATION_AND_PARALLELISM.md`](./05_PIPELINE_ORCHESTRATION_AND_PARALLELISM.md).

---

## 7. Persistence and raw payloads

**Reusable:** `ExternalRequest`, `ExternalPayload`, `RawArtifact`, `MythicRun`, `RunSourceReference`, `RunParticipant`, `RunAnalysis`, `MetricObservation`, `ScoreModel`, `ScoreSnapshot`, `DimensionScore`, `ScoreAnalysisBatch`, `ScoreAnalysisBatchRun`, `CharacterPublishedScore`, calibration models; recording via `apps/worker/src/orchestration/provider-recording.ts` (`recordProviderResult`).

**Incompatible / overloaded:** event arrays in `RunAnalysis.summary` for `wcl-run-evidence-v1`.

**Missing (doc `06`):** `EvidenceManifest`, `EvidenceManifestSlot`, `EvidenceDataset`, `RunFactSet`, `WclReportRevision`, dimension computation records with manifest FKs, retention-by-reference for calibration/publish.

---

## 8. Dimension calculations

| Dimension | Entry | Version labels | Tag |
|-----------|-------|----------------|-----|
| Overall | `calculateScore` / `calculateScoreEngine` â€” `packages/scoring/src/calculate.ts`; `createDefaultModelV6` | v6 weights 35/30/25/10 | **reusable** engine |
| Performance | `computePerformanceDimension` â€” `performance/aggregate.ts` | `points-and-damage-v1` | math **reusable**; inputs **incompatible** |
| Survival | `scoreSurvivalV1_1_1Run` / `aggregateSurvivalV1_1_1`; `computeSurvivalDimension` | `survival-standalone-v1.1.1`, `wcl-survival-v1.1.1-parity` | pressure-cluster **reusable**; selector **incompatible** |
| Utility | V3.2 observed contribution; `utility-publication-refresh.ts`; `UTILITY_PUBLICATION_MODE` default **shadow** | `utility-observed-shadow-v1` / `utility-observed-public-v1` | logic **reusable**; opportunity Phase 2 **research** |
| Experience | `computeExperienceV2` â€” `experience/v2/` | `experience-v2.1` | core **reusable**; Blizzard prior-season **missing** |

**Forbidden without explicit later prompt:** changing score formula, weights, or thresholds during V2 evidence workstreams.

---

## 9. Confidence and publication

| Concern | Symbol | Tag |
|---------|--------|-----|
| Grade U from confidence | `presentGrade` â€” `packages/scoring/src/trust.ts` (`minConfidenceForGrade` 0.35) | **reusable** |
| Model coverage â†’ provisional U | `computeModelCoverage` â€” `model-coverage.ts` (0.5) | **reusable**; V2 needs slot coverage states |
| Coherence / LKG | `validateCoherence`, `mergeObservationsWithLastKnownGood` | **reusable** |
| Ranking eligibility | `buildRankingEligibility` | **reusable** |
| Atomic publish pointer | `CharacterPublishedScore` | **reusable** |

**Incompatible:** confidence still blends profile run volume / selected-run proxies rather than manifest slot coverage (`FULL` / `STRONG` / `PARTIAL` / `INSUFFICIENT`).

Canonical product doc: `doc/product/ranking-confidence-and-missing-data.md`.

---

## 10. Feature flags and readiness

**Present:** `PROVIDER_MODE`, provider enables, `UTILITY_PUBLICATION_MODE`, `ADMIN_CALIBRATION_ENABLED`, refresh admission/ETA/concurrency, WCL rate thresholds â€” `packages/config/src/index.ts`.

**Missing:** all `SCORING_V2_*` and `CALIBRATION_V2_ENABLED` flags from [`14_MIGRATION_ROLLOUT_AND_FEATURE_FLAGS.md`](./14_MIGRATION_ROLLOUT_AND_FEATURE_FLAGS.md). Zero matches in application code.

---

## 11. Tests and fixtures (high-signal)

- Selection: `scoring-run-selection.test.ts`, `survival-run-selection.test.ts`, `active-season-dungeons.test.ts`
- Evidence: `shared-evidence.test.ts`, `wcl-batch-cost-accounting.test.ts`, utility-from-shared-evidence tests
- Dimensions / publication: performance/survival/experience tests, `coherence.test.ts`, `ranking-eligibility.test.ts`, `model-coverage.test.ts`, `overall-formula.v6.test.ts`
- Calibration: `calibration-harness.test.ts`, `digest.test.ts`, `routes.admin-calibration.test.ts`, `calibration-isolation.test.ts`
- Fixtures: Blizzard/Raider.IO/WCL fixture providers; `packages/scoring/src/calibration/fixture-cohort.ts`

**Missing:** 16-slot selector suite, fact-set hash fail-closed tests, V2 calibration schema dispatch tests.

---

## 12. Normative conflicts (must not be silently reinterpreted)

| Conflict | V1 code | V2 doc | Resolution path |
|----------|---------|--------|-----------------|
| Runs per dungeon | 1 (scoring) / â‰¤3 (survival) | 2 slots | Evidence Contract V2 (Prompt 02) |
| Shared P/S/U evidence | Independent Survival selector | One frozen manifest | Same |
| Event storage | JSONB in `RunAnalysis.summary` | Artifacts + fact sets | ADR-0002 + Prompt 04 |
| Calibration evidence | Live snapshot embed | Manifest + fact hashes | ADR-0005 + Prompt 10 |
| Queue DAG | Monolithic refresh | Slot fan-out + finalize | ADR-0003 + Prompt 05 |
| Population recommendations | Digests already omit | Gates in doc 13 | Keep postponed |
| Model activation | Admin elsewhere; calibration DRAFT-only | DB/admin, not env flips | Preserve; see `doc/operations/model-lifecycle.md` |

---

## 13. Assumptions requiring live probes

See also [`IMPLEMENTATION_DEPENDENCY_GRAPH.md`](./IMPLEMENTATION_DEPENDENCY_GRAPH.md) Â§6 and doc `18`.

1. Same-key `key %` field stability across roles/specs on live WCL.
2. 2Ã—8 selection coverage on complete, sparse, archived, tank, and healer profiles.
3. Event vs table aggregate cost/size for DamageTaken and casts.
4. Report archive/access behavior on the target WCL plan.
5. `points_and_damage` partition/role binding reliability.
6. Blizzard prior-season + achievements availability for Experience.
7. Calibration V2 bundle sizing for ~40-member cohort with hash references (4 MiB root limit).
8. Account-dedup availability before OAuth (Phase 3 gate).

No live provider calls were authorized or performed in this audit.
