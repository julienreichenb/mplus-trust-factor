# Agent 24 — Utility v3 and Ability Catalog handoff

- ID: 24
- Scope: Utility dimension extraction, observations, formula, confidence, explanations, Warlock Demo catalog coverage
- Branch: `agent/wave4-utility-v3`
- Worktree: `24-utility-v3`
- Date: 2026-07-28

## Summary

Implemented Utility v3 on the frozen Agent 21 foundation without changing global dimension weights, RAID removal, `default@3` composition, Agent 26 UI, or other dimension formulas.

- Spec-level **capability matrix** + interrupt resolution from class/spec/talents/pet (`resolveUtilityCapability`, `resolveInterruptAbility`)
- Catalog-driven extraction: kick casts vs WCL Interrupts success, distinct CC targets, group-support cast vs confirmed party usage, defensive/offensive dispel classification
- Warlock Demonology seed coverage for Wallidrixe: Spell Lock, Banish/Fear/Shadowfury/Mortal Coil/Axe Toss, Demonic Gateway, Singe Magic; **no offensive dispel** (contributor stays via defensive only)
- Utility formula module (`packages/scoring/src/utility/*`): 40/25/20/15 weights with capability renormalization; interrupt = 70% activity + 30% success; equal-weight dungeon mean; missing detail ≠ zero
- Per-run evidence + catalog spell coverage in explanations and observation context
- `utilityDimensionToMetricObservations` for Agent 27 wiring

Frozen contracts untouched: `ScoringRunSelection`, `UtilityRawFacts` shape, `AbilityRule` / `ScoringMechanicRule` schemas, public selected-runs DTO.

## Required global model configuration (for Agent 27)

Do **not** silently flip production to these weights until calibration. Compose `default@3` UTILITY as:

| Metric key | Provisional weight | Notes |
|---|---:|---|
| `utility.v3.interrupts` | 0.40 | Drop + renormalize when `capability.interrupts === false` |
| `utility.v3.crowd_control` | 0.25 | Unique hostile targets; reapplications do not inflate |
| `utility.v3.group_support` | 0.20 | Cast/summon may be `cast_only` (Gateway) |
| `utility.v3.dispels` | 0.15 | Defensive and/or offensive; Demo = defensive only |

Helper: `resolveUtilityMetricWeights(capability)` already renormalizes.

Suggested global SkillScore (unchanged proposal — Agent 27 owns final):

```text
SkillScore = 35% Performance + 30% Survival + 25% Utility + 10% Experience
```

Formula version stamp: `utility-v3-1` (`UTILITY_V3_FORMULA_VERSION`).

Interrupt sub-blend (dimension-internal, not model metric keys):

```text
interruptScore = 0.70 × kickActivity + 0.30 × kickSuccess
availableKickWindows ≈ runDurationMs / effectiveKickCooldownMs
```

Normalization: contributor scores are 0–100; missing contributors omitted (never zero-filled).

## Commit

_(filled after commit)_

## Tests executed

```text
pnpm --filter @mplus/mechanics test
pnpm --filter @mplus/scoring test -- src/utility src/selection
pnpm --filter @mplus/mechanics build
pnpm --filter @mplus/scoring build
```

## Files changed (owned)

- `packages/mechanics/src/utility-capability.ts`
- `packages/mechanics/src/raw-facts.ts`
- `packages/mechanics/src/catalogs/ability-rules.seed.ts`
- `packages/mechanics/src/index.ts`
- `packages/mechanics/src/wave4-foundation.test.ts`
- `packages/scoring/src/utility/*`
- `packages/scoring/src/selection/raw-fact-persist.ts`
- `packages/scoring/src/index.ts`
- `doc/agents/24-utility-v3-handoff.md`
- `doc/wave4/data-coverage-wallidrixe.md` (Utility status updates)

## Remaining for Agent 27

1. Wire `computeUtilityDimension` + `utilityDimensionToMetricObservations` into the refresh/score path.
2. Replace v1/v2 UTILITY metric keys (`utility.interrupts`, `utility.externals`, `utility.class_specific`, …) in `default@3` only.
3. Calibrate soft caps / activity denominators against live Wallidrixe eight-run smoke.
4. Optionally persist group-support confirmed-usage evidence outside frozen `UtilityRawFacts` (already on `ExtractedUtilityCounts` + observation context).
