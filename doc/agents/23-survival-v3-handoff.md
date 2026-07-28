# Agent 23 — Survival v3 handoff

## Branch / worktree

- Worktree: `23-survival-v3`
- Branch: `agent/wave4-survival-v3`
- Do **not** merge into `integration/wave4` or `main` from this agent.

## Commit

`021cd9ef8404949a1260c3d25ffdfa2cdb8e490e` (feature)

## Summary

Survival dimension v3 on top of Agent 21 frozen foundation:

- `computeSurvivalDimension` + per-run explanations in `@mplus/scoring` (`packages/scoring/src/survival/`)
- Internal weights: deaths 35% / avoidable 30% / personal defensives 20% / self-heal+potion 15%
- Capability + missing-data renormalization; missing ≠ zero
- Defensive spam capped to estimated available uses (catalog CD × duration)
- Effective self-heal credited; overheal exposed separately and not scored
- Avoidable damage normalized by max HP × duration; optional cohort blend when provided
- Mechanic catalog expanded (`scoring-mechanic-catalog-v1-survival-agent23`)
- Ability catalog bumped (`ability-catalog-v1-survival-agent23`) with seasonal potion seed
- Max health plumbed from WCL CombatantInfo `maxHitPoints` when present
- Worker bridge `buildSurvivalObservations` emits `survival.v3.*` observations
- Refresh pipeline attaches Survival v3 observations (does **not** activate `default@3`)

## Required global model configuration (for Agent 27)

Do **not** change global dimension weights / RAID removal / fusion here. For `default@3`, wire:

```ts
metricWeights.SURVIVAL = resolveSurvivalMetricWeights(activeContributors)
// nominal when all available:
[
  { metricKey: "survival.v3.deaths", weight: 0.35 },
  { metricKey: "survival.v3.avoidable_damage", weight: 0.30 },
  { metricKey: "survival.v3.personal_defensives", weight: 0.20 },
  { metricKey: "survival.v3.self_heal_and_potion", weight: 0.15 },
]
```

Suggested normalization (values already 0–100 identity scores):

```ts
normalization: {
  "survival.v3.deaths": { type: "identity" },
  "survival.v3.avoidable_damage": { type: "identity" },
  "survival.v3.personal_defensives": { type: "identity" },
  "survival.v3.self_heal_and_potion": { type: "identity" },
}
```

Provisional global SkillScore mix (document only — Agent 27 owns composition):

```text
SkillScore = 35% Performance + 30% Survival + 25% Utility + 10% Experience
```

Formula version: `survival-v3-formula-v1`  
Helpers: `resolveSurvivalMetricWeights`, `SURVIVAL_V3_METRIC_KEYS`, `SURVIVAL_V3_WEIGHTS`.

Leave legacy `survival.death_rate` / `survival.avoidable_damage` / `survival.defensive_usage` / `survival.consumable_usage` on `default@2` until cutover.

## Catalog coverage gaps (Wallidrixe)

| Dungeon | Coverage |
|---|---|
| algethar-academy, skyreach, seat-of-the-triumvirate, pit-of-saron, magisters-terrace | Expanded recycled avoidable IDs (still incomplete vs live ability surface) |
| maisara-caverns, nexus-point-xenas, windrunner-spire | Placeholder ability IDs `400101–400103` only — harvest live WCL IDs |
| Max health | PARTIAL — depends on CombatantInfo exposing `maxHitPoints` |
| Potion spell IDs | Verify Midnight live IDs beyond Algari / seasonal seed |
| Non-Warlock ability rules | Out of seed scope — expand per class before multi-class calibration |

Unknown damage remains **never** avoidable.

## Tests executed

- `pnpm test -- packages/scoring/src/survival/aggregate.test.ts packages/mechanics/src/wave4-foundation.test.ts apps/worker/src/orchestration/survival-metrics.test.ts`
- Related analyze-scoring-runs / mechanics suites as needed

## Files owned

- `packages/scoring/src/survival/*`
- `packages/scoring/src/index.ts` (Survival exports)
- `packages/scoring/src/selection/raw-fact-persist.ts` (self-heal / potion / max_health envelopes)
- `packages/mechanics/src/{defensive-capacity.ts,catalogs/*,index.ts,wave4-foundation.test.ts}`
- `packages/providers/warcraftlogs/src/{types,analysis/event-fetcher,analysis/combat-facts,smoke/eight-run-facts}.ts`
- `apps/worker/src/orchestration/{analyze-scoring-runs,survival-metrics,refresh-pipeline}.ts`
- `doc/wave4/data-coverage-wallidrixe.md`
- `doc/agents/23-survival-v3-handoff.md`
