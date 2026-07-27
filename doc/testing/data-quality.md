# Data quality invariants

Executable checks live in `@mplus/test-utils` (`validateScoreSnapshot`, `assert*` helpers).

## Invariants

| Code | Rule |
|------|------|
| `REGION_MISSING` | Region on every character/run identity |
| `SCORE_OUT_OF_RANGE` | Scores in 0–100 |
| `CONFIDENCE_OUT_OF_RANGE` | Confidence in 0–1 |
| `GRADE_MISMATCH` | Grade matches active thresholds |
| `WEIGHTS_NOT_NORMALIZED` | Dimension weights sum to 1 |
| `MODEL_REFERENCE_MISSING` | Snapshot references model key + version |
| `DUPLICATE_RUN_FINGERPRINT` | No duplicate canonical run fingerprint in batch |
| `DUPLICATE_ANALYSIS` | Same report revision not analyzed twice per version |
| `FABRICATED_ZERO` | Missing metrics not stored as fake zero |
| `ADDON_FIELD_LEAK` | No premium/admin/raw fields in addon export |

## Usage

```typescript
import { validateScoreSnapshot } from "@mplus/test-utils";

const report = validateScoreSnapshot(snapshot, modelConfig);
if (!report.ok) {
  console.error(report.violations);
}
```

## Tests

`tests/data-quality/invariants.test.ts` and `packages/scoring/src/scoring.invariants.test.ts`.

## Future

Worker ingestion pipelines should call the same helpers before persisting snapshots (Agent 5/10).
