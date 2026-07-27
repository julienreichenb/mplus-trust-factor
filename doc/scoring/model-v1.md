# Scoring model v1

Deterministic Trust Factor engine owned by Agent 4 (`@mplus/scoring`).

## Formulas

```
SkillScore = Σ (dimensionWeight_i * adjustedDimension_i)

ObservedTrust = SkillScore * (0.60 + 0.40 * Authenticity / 100)

FinalTrust = Confidence * ObservedTrust + (1 - Confidence) * 50
```

Dimension weights (default): Performance 0.32, Survival 0.27, Utility 0.23, ExperienceConsistency 0.13, MythicRaid 0.05.

Grades: S≥90, A≥80, B≥65, C≥50, D<50.

## Configurability

All weights, thresholds, authenticity feature weights, confidence blend, historical decay, and normalization specs live in `ScoreModelConfigV1` (`createDefaultModelV1()`). Nothing critical is hardcoded outside the model object.

Slim public DTO `ScoreModelConfig` in `@mplus/contracts` remains the snapshot metadata shape. Rich config is package-local; see `doc/contracts/change-requests/04-score-model-config-v1.md`.

## API

- `validateScoreModelConfig`
- `calculateMetricScores`
- `calculateDimensionScores`
- `calculateAuthenticity`
- `calculateFinalTrust` / `gradeScore`
- `explainScore`
- `calculateScore` / `calculateScoreEngine`

## Constraints

- Pure TypeScript; no network or database clients
- Clock only via explicit `calculatedAt`
- Input fingerprint from immutable observations + context + model key/version
