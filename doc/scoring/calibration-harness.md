# Calibration / backtest harness (Agent 10)

Reproducible cohort evaluation without activating score models or calling live providers.

Runtime code: `packages/scoring/src/calibration/`.

## Modes

| Mode | Default | Behaviour |
|------|---------|-----------|
| `persisted-snapshot-only` | **yes** | Score from provided immutable snapshots / fixture snapshots. No providers. |
| `draft-model-evaluate` | opt-in | Recalculate from persisted/fixture observations with a **DRAFT** model config. Never activates. |
| `refresh-then-evaluate` | **disabled** | Requires `allowRefreshThenEvaluate=true` and a provider port. This package ships **no** provider port; the mode always errors. |

## Cohort manifest (`schemaVersion: 1.0.0`)

Required per member:

- `region`, `realm`, `character`
- `role` (`DPS` \| `TANK` \| `HEALER`), `classSlug`, `specSlug`
- `expectedLabel` (`excellent` \| `good` \| `average` \| `weak` \| `overrated`)
- `meta` (boolean)
- `rationale`
- `suspectedBoost` (boolean)
- `source` (`user-selected` \| `stratified-auto`)
- optional `snapshotIds[]`, `seasonSlug`

Validate with `validateCohortManifest`.

**Live cohorts are out of scope until the user provides/approves characters.** Use `buildSyntheticFixtureCohort()` for deterministic local/CI runs.

## Outputs (`schemaVersion: 1.0.0`)

`buildCalibrationArtifacts(report)` produces:

- JSON report (full)
- CSV (per-character)
- Markdown (human-readable)
- Public-safe JSON/Markdown (`anonymizeReport`)

Includes: overall/dimension scores, grades, confidence, coverage/refresh state, boost flags (generic public-safe interface), active vs evaluation model refs, expected vs actual label, rank confusion, grade distribution (no forced quotas), role/class/spec/meta slices, missing-data slices, Utility baseline/fallback cost, weight ablation, exploratory bootstrap CIs.

## Agent 08 admin adapter

Do **not** edit Admin Models UI in this agent. Wire the API as follows:

```ts
import {
  runAdminCalibrationBacktest,
  createFixtureEvidencePort,
  buildSyntheticFixtureCohort,
  type CalibrationEvidencePort,
} from "@mplus/scoring";

// Production: implement CalibrationEvidencePort against persisted ScoreSnapshot + observations.
// Must not enqueue provider refresh from the backtest path.

const result = runAdminCalibrationBacktest({
  scoreModelId: model.id,
  manifest: cohortManifestJson,
  options: {
    mode: "persisted-snapshot-only", // or draft-model-evaluate with DRAFT ref
    evaluationModel: draftRef,       // status DRAFT, isActive false
    activeModel: activeRef,
    calculatedAt: fixedIsoForReplay, // optional but recommended
  },
  deps: { evidence: dbEvidencePort },
  publicSafe: true,
});

// result.summary ≈ existing BacktestResultDTO (+ richer fields)
// result.artifacts.json|csv|markdown for download / storage
```

### Adapter guarantees

- `modelActivated` is always `false`
- `providerCallsMade` is always `false` for shipped modes
- Malformed manifests return `validationErrors` without throwing
- Draft evaluation rejects `status: "ACTIVE"` / `isActive: true`

### Suggested API evolution (Agent 08)

Keep `/api/v1/admin/score-models/:id/backtest` response backward compatible:

- Continue returning `scoreModelId`, `sampleSize`, `gradeDistribution`, `meanScore`, `generatedAt`, `note`
- Optionally attach `calibrationSchemaVersion`, `outliers`, `roleSlices`, `artifactsUri`

Replace the fixture placeholder in `AdminService.backtestScoreModel` by calling `runAdminCalibrationBacktest` with a DB-backed `CalibrationEvidencePort`.

## CLI

```bash
pnpm --filter @mplus/scoring run build
pnpm --filter @mplus/scoring run calibration:harness -- --mode persisted-snapshot-only --out ./tmp/calibration-harness
```

(From source with a TS runner: `pnpm exec tsx packages/scoring/src/calibration/cli.ts` if `tsx` is available.)

Writes `report.json`, `report.csv`, `report.md`, public-safe variants, and the fixture cohort manifest.

## Boost flags

`BoostFlagSource` / `PublicBoostFlag` consume only:

- manifest `suspectedBoost`, and/or
- persisted **public-safe** flags

No dependency on the unmerged `feat/boost-shadow-phase1` branch.

## Constraints (honoured)

- No conclusion about final calibration
- No score-model activation
- No live cohort until user approval
- No live provider requests from this harness
