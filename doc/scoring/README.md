# Scoring docs

Canonical scoring documentation (single system — formerly “Scoring V2”):

1. [`SCORING_ARCHITECTURE.md`](SCORING_ARCHITECTURE.md) — pipeline, persistence, cold/warm
2. [`WCL_ACQUISITION.md`](WCL_ACQUISITION.md) — season/dungeon discovery, selection, cache identity
3. [`SCORING_DIMENSIONS.md`](SCORING_DIMENSIONS.md) — digests, Performance/Utility/Survival, confidence
4. [`SCORING_OPERATIONS.md`](SCORING_OPERATIONS.md) — refresh, canary/replay/doctor, flags

Related product docs:

- [`../product/scoring-model-v6.md`](../product/scoring-model-v6.md)
- [`../product/ranking-confidence-and-missing-data.md`](../product/ranking-confidence-and-missing-data.md)
- [`../architecture/scoring-publication.md`](../architecture/scoring-publication.md)
- [`../operations/model-lifecycle.md`](../operations/model-lifecycle.md)
- [`calibration-harness.md`](calibration-harness.md)
- [`abilities/`](abilities/) — `@mplus/abilities` catalog and coverage

Historical V1/V2 coexistence, supersession, and repair runbooks under `v2/` and `scoring-v2-*` filenames are **obsolete** and should not be followed for new work. Prefer the four files above; archive leftovers in a follow-up.
