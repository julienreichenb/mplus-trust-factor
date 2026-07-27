# Contract change request — ScoreModelConfig v1 rich fields

- Agent: 04
- Date: 2026-07-27
- Status: proposed (not applied to `@mplus/contracts`)

## Problem

Public `ScoreModelConfig` only carries dimension weights, authenticity blend, neutral score, and grade thresholds. The scoring engine needs submetric weights, normalization specs, authenticity feature weights, confidence blend, historical decay, and role exclusions.

## Proposal

Keep slim `ScoreModelConfig` for snapshot metadata. Persist rich JSON in `ScoreModel.config` (already JSONB). Optionally later extend contracts with:

```ts
interface ScoreModelConfigExtended extends ScoreModelConfig {
  metricWeights: ...;
  normalization: ...;
  // etc.
}
```

## Compatibility

`@mplus/scoring` defines `ScoreModelConfigV1` locally and coerces slim configs via `createDefaultModelV1` overlays. No breaking change required for Agents 5–6 now.

## Requested follow-up

Agent 5 / 10 may adopt `ScoreModelConfigV1` (or move it into contracts) when wiring recalculate jobs and admin model editors.
