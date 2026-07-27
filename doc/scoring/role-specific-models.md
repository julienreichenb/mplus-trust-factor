# Role-specific models

Role behavior is driven by `ScoreModelConfigV1.roleMetricExclusions` and optional `roles` / `excludeRoles` on metric weight defs — not scattered formula branches.

## DPS

- Standard performance weight on damage percentile/context
- Survival and utility remain significant

## Tank

- Exclude raw HPS-style metrics (`performance.raw_hps`, `utility.raw_hps` when present)
- Performance uses damage + stability/mitigation facts supplied as normalized observations
- Survival interprets expected tank damage; avoidable damage only when mechanic rules match
- Empty mechanic catalog ⇒ unknown damage stays unclassified (not avoidable)

## Healer

- HPS alone is secondary; upstream should prefer contextual healing metrics
- Dispels, externals, and class utility carry meaningful utility weight
- Avoid penalizing low HPS in low-damage groups by supplying context-normalized values, not raw HPS

Variant models `survival-focused` and `utility-focused` reweight dimensions for admin/experimentation.
