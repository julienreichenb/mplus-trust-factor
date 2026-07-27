# Authenticity and boost suspicion

Authenticity starts at **100**. Configurable suspicion features subtract; mitigations add. Clamp to 0–100.

## Suspicion features (v1 weights)

progression key jump, compressed best-run window, low volume for score, repeated stronger teammates, top-run roster concentration, weak target performance, high deaths/low contribution, rating/performance divergence, lack of intermediate progression.

## Mitigations

confirmed elite main, probable reroll, strong prior-season same role, strong personal top-run performance, independent group diversity.

## Reroll policy

Confirmed/probable reroll **softens progression-jump features only**. Direct performance evidence (`weakTargetPerformance`, `highDeathsLowContribution`, `ratingPerformanceDivergence`) is never erased by reroll mitigation.

## Tags (probabilistic)

| Condition | Tag / red flag |
|-----------|----------------|
| authenticity < 40 and evidence strength ≥ threshold | `BOOST_SUSPECTED` / `boost_suspected` |
| 40–60 with adequate evidence | `ATYPICAL_PROGRESSION` |
| low evidence | `INSUFFICIENT_DATA` (no boost tag) |
| confirmed/probable reroll signals | `CONFIRMED_REROLL` / `PROBABLE_REROLL` |

**Never** emit categorical purchase accusations (“bought a boost”).

Evidence entries include: feature key, raw value, normalized severity, confidence, contribution.
