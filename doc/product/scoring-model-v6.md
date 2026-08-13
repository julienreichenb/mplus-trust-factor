# Scoring model v6

Runtime authority: `packages/scoring/src/model/defaults.ts` (`createDefaultModelV6`), seeded ACTIVE as `default@6` in `packages/database` seed.

## Public skill dimensions and weights

| Dimension | Weight |
|-----------|--------|
| Performance | 0.35 |
| Survival | 0.30 |
| Utility | 0.25 |
| Experience | 0.10 |
| Mythic Raid | **0** (filtered from public skill DTOs) |

Contract enums may still list `RAID` and `AUTHENTICITY` for schema compatibility. **Public skill surface = four dimensions.**

## v6 behaviour

- Utility metric: single `utility.observed_contribution` (weight 1) — 0–100 toolkit exploitation by Ability Catalog family.
- `overallFormula: "WEIGHTED_DIMENSIONS"` → public overall score equals weighted public skill dimensions.
- Authenticity / global confidence are **metadata** under v6 (`authenticityAppliedToOverall: false`). They must not be described as shrinking or re-blending the overall Trust Score.

## Boost suspicion

When authenticity evidence is adequate and authenticity score is low, the API may emit a public red flag (`boost_suspected` / `BOOST_SUSPECTED`).

Policy:

- clear, prominent, probabilistic suspicion;
- include evidence and uncertainty;
- language must remain suspicion, never proven accusation (`doc/security/red-flag-language.md`);
- **does not** change the numeric overall score or cap the grade under v6 until the detector is calibrated and a future model explicitly changes that.

## Common evidence sample

**Implemented today:** one selected scoring run per active-season dungeon (typically **8** dungeons; falls back to season dungeon count).

Programme targets (Agents 07+ may implement stricter caps):

- at most 8 baseline detailed runs in the normal path;
- exceptional ceiling may be configurable up to 12;
- Performance, Survival and Utility reuse shared detailed evidence when possible;
- Survival analysis may inspect up to 3 runs per dungeon in its probe config.

Document code behaviour when it diverges from programme targets; do not invent constants that are not in the tree.

## Related

- Confidence / U / ranking: [`ranking-confidence-and-missing-data.md`](ranking-confidence-and-missing-data.md)
- Publication / snapshots: [`../architecture/scoring-publication.md`](../architecture/scoring-publication.md)
- Model activation: [`../operations/model-lifecycle.md`](../operations/model-lifecycle.md)
