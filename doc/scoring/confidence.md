# Confidence

## Per metric

`metricConfidence ≈ 0.6 * providerConfidence + 0.4 * sampleSizeConfidence`

`sampleSizeConfidence = 1 - exp(-sampleSize / halfLife)` (default halfLife = 10).

## Per dimension

1. Weighted average of available metrics only
2. `coverage = availableConfiguredWeight / totalConfiguredWeight`
3. `dimensionConfidence ≈ 0.55 * coverage + 0.45 * avgMetricConfidence`
4. `adjusted = confidence * raw + (1 - confidence) * 50`
5. If `coverage < minCoverageForExtreme`, clamp adjusted to `[extremeCapLow, extremeCapHigh]`

## Overall

Configurable blend (default):

- dimensionConfidence 0.45
- sourceCoverage 0.25
- freshness 0.15
- selectedRunCoverage 0.15

Stored on snapshots as 0–1 (`ScoreSnapshotDTO.confidence`).

## Shrinkage

```
FinalTrust = Confidence * ObservedTrust + (1 - Confidence) * 50
```

Low-confidence profiles drift toward neutral rather than zero.
