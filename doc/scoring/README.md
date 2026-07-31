# Scoring docs

Canonical product scoring documentation:

- [`../product/scoring-model-v6.md`](../product/scoring-model-v6.md)
- [`../product/ranking-confidence-and-missing-data.md`](../product/ranking-confidence-and-missing-data.md)
- [`../architecture/scoring-publication.md`](../architecture/scoring-publication.md)
- [`../operations/model-lifecycle.md`](../operations/model-lifecycle.md)
- [`calibration-harness.md`](calibration-harness.md) — Agents 10/10B reproducible backtest/calibration harness, portable bundles, Agent 08 async export boundary

Runtime defaults: `packages/scoring/src/model/defaults.ts` (`createDefaultModelV6`).  
Active model is a database row (seeded `default@6`); env vars are lookup/bootstrap aids, not normal activation.
