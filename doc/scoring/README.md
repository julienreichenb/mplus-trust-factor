# Scoring docs

Canonical product scoring documentation:

- [`../product/scoring-model-v6.md`](../product/scoring-model-v6.md)
- [`../product/ranking-confidence-and-missing-data.md`](../product/ranking-confidence-and-missing-data.md)
- [`../architecture/scoring-publication.md`](../architecture/scoring-publication.md)
- [`../operations/model-lifecycle.md`](../operations/model-lifecycle.md)
- [`v2/`](v2/) — Scoring V2 normative specs, interface, and implementation status
- [`scoring-v2-live-facts-status.md`](scoring-v2-live-facts-status.md) — V2 live-facts delivery gates
- [`calibration-harness.md`](calibration-harness.md) — reproducible backtest/calibration harness
- [`boost-detection-shadow.md`](boost-detection-shadow.md) — shadow authenticity feature names
- [`boost-shadow-phase2-backtest.md`](boost-shadow-phase2-backtest.md) — boost Phase 2 offline/backtest harness
- [`abilities/`](abilities/) — `@mplus/abilities` catalog and coverage
- [`cohorts/agent11-2026-08-01/`](cohorts/agent11-2026-08-01/) — calibration cohort inputs; runtime asset: [`../../apps/api/runtime-assets/calibration/agent11-2026-08-01/resolved.v1.json`](../../apps/api/runtime-assets/calibration/agent11-2026-08-01/resolved.v1.json)
- [`meta-policies/midnight-season-1.meta.v1.json`](meta-policies/midnight-season-1.meta.v1.json) — Midnight Season 1 meta specialization policy

Runtime defaults: `packages/scoring/src/model/defaults.ts` (`createDefaultModelV6`).  
Active model is a database row (seeded `default@6`); env vars are lookup/bootstrap aids, not normal activation.
