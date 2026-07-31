# Calibration / backtest harness (Agents 10 / 10B)

Reproducible cohort evaluation without activating score models or calling live providers.

Runtime code: `packages/scoring/src/calibration/`.

Report schema: **`1.1.0`**. Input bundle schema: **`1.0.0`**.

## Modes

| Mode | Default | Behaviour |
|------|---------|-----------|
| `persisted-snapshot-only` | **yes** | Score from provided immutable snapshots. Snapshot provenance is validated; scores stay attributed to the snapshot's model. |
| `draft-model-evaluate` | opt-in | Recalculate from **replayable** observations + explicit `scoringContext`. Never activates. |
| `active-versus-draft` | opt-in | Recalculate **both** active and draft models on identical observations/context/`calculatedAt`. |
| `refresh-then-evaluate` | **unsupported** | Rejected with `UNSUPPORTED_MODE`. No provider refresh port ships in this package. |

## Portable input bundle

```ts
interface CalibrationInputBundleV1 {
  schemaVersion: "1.0.0";
  manifest: CohortManifest;
  evidenceByMemberId: Record<string, CalibrationMemberEvidence>;
  activeModel?: CalibrationModelRef;
  evaluationModel?: CalibrationModelRef;
  generatedAt: string;
  source: "fixture" | "persisted-export";
  mode?: CalibrationBacktestMode;
}
```

Validate with `validateCalibrationInputBundle`. Run with `runCalibrationHarnessFromBundle` or async `runCalibrationHarnessFromExport`.

Evidence for draft / active-versus-draft **must** include:

- non-empty `observations`
- explicit `scoringContext` (`role`, `freshness`, `selectedRunCoverage`, plus class/spec/authenticity as applicable)
- optional `calculatedAt` / `inputFingerprint`

The harness **does not invent** freshness or coverage defaults during draft evaluation.

## Cohort manifest (`schemaVersion: 1.0.0`)

Required per member: `region`, `realm`, `character`, `role`, `classSlug`, `specSlug`, `expectedLabel`, `meta`, `rationale`, `suspectedBoost`, `source`; optional `snapshotIds[]`, `seasonSlug`.

Validate with `validateCohortManifest`.

Synthetic fixtures: `buildSyntheticFixtureCohort()` / `buildSyntheticFixtureBundle()` use **canonical v6 metric keys**.

## Outputs (`schemaVersion: 1.1.0`)

`buildCalibrationArtifacts(report)` produces JSON, CSV, Markdown, and public-safe (identity-redacted) variants.

Includes: overall/dimension scores, grades, confidence, **explicit evidence coverage** (selected-run / model / utility — distinct from dimension-availability), boost flags, active vs evaluation model refs, **scoreModelKey/Version provenance**, expected vs actual label, tie-aware Spearman (label strength vs score → +1 on agreement), grade distribution (no forced quotas), role/class/spec/meta slices, missing-data / U / low-confidence slices, Utility cost, **engine weight ablation**, exploratory bootstrap CIs, **activeDraftComparison**, structured `validationFailures`.

## Agent 08 integration boundary

**Do not** add Prisma to `@mplus/scoring`. Preferred flow:

```text
async DB/export adapter (Agent 08)
  → builds validated CalibrationInputBundleV1
  → runCalibrationHarnessFromExport / runCalibrationHarnessFromBundle
  → pure synchronous calibration core
```

```ts
import {
  runCalibrationHarnessFromExport,
  runAdminCalibrationBacktest,
  type CalibrationBundleExportPort,
} from "@mplus/scoring";

const port: CalibrationBundleExportPort = {
  async exportBundle() {
    // Preload ScoreSnapshot + observations + ScoringContext from PostgreSQL.
    // Never enqueue provider refresh from the backtest path.
    return portableBundleJson;
  },
};

const result = await runCalibrationHarnessFromExport({
  port,
  options: { mode: "active-versus-draft", calculatedAt: fixedIso },
  publicSafe: true,
});
```

Legacy sync adapter `runAdminCalibrationBacktest({ manifest, deps.evidence })` remains for tests/fixtures.

### Adapter guarantees

- `modelActivated` is always `false`
- `providerCallsMade` is always `false` for shipped modes
- Malformed manifests/bundles return validation errors
- Draft evaluation rejects `status: "ACTIVE"` / `isActive: true`
- Invalid evidence is recorded in `validationFailures` and excluded from score denominators

## CLI

```bash
pnpm --filter @mplus/scoring run build
pnpm --filter @mplus/scoring run calibration:harness -- --fixture --mode persisted-snapshot-only --out ./tmp/calibration-harness
pnpm --filter @mplus/scoring run calibration:harness -- --bundle ./path/to/bundle.json --mode active-versus-draft --out ./tmp/calibration-harness --public-safe
```

`--bundle` never falls back to synthetic fixtures. `--fixture` is explicit. `refresh-then-evaluate` exits non-zero with `UNSUPPORTED_MODE`.

## Statistics notes

- Spearman uses average ranks for ties; constant vectors → `null`
- Outlier thresholds are exploratory heuristics
- Bootstrap iterations are bounded (1–5000); seed is deterministic
- Coverage statistics prefer `selectedRunCoverage` / `modelCoverageRatio`; dimension-availability is named separately

## Boost flags

`BoostFlagSource` / `PublicBoostFlag` consume manifest `suspectedBoost` and/or persisted public-safe flags. Boost suspicion does not alter numeric scores.

## Constraints (honoured)

- No conclusion about final calibration
- No score-model activation
- No live cohort until user provides/approves characters
- No live provider requests from this harness
- No production weight/threshold changes
