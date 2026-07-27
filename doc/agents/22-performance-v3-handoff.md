# Agent 22 — Performance v3 handoff

## Branch / worktree

- Worktree: `22-performance-v3`
- Branch: `agent/wave4-performance-v3`
- Do **not** merge into `integration/wave4` or `main` from this agent.

## Commit

`01f574bfb31b4bf8790c409d2c089cc8ab96e50e`

## Summary

Performance v3 over the eight selected highest-key current-season runs:

- Per dungeon: `0.65 × executionPercentile + 0.35 × keyDifficultyPercentile`
- Equal dungeon weighting; missing detail omitted (never zero)
- WCL parses tied to selected `reportCode`+`fightId` (bracket-aware when valid); no character-wide best substitution
- Key difficulty from regional anchors → season-cutoff calibration → documented bounded fallback
- Coverage/freshness affect **confidence only**
- v2 peak/median path retained for snapshot compatibility; worker drives PERFORMANCE from `performance.v3.run_performance`
- Historical seasons do **not** enter current Performance v3

## Required global model configuration (Agent 27)

Do **not** change global dimension weights here. For `default@3`, Agent 27 should:

```ts
metricWeights.PERFORMANCE = [
  { metricKey: "performance.v3.run_performance", weight: 1.0 },
];

normalization["performance.v3.run_performance"] = { type: "percentile" };
// Optional explanatory (not drivers):
// performance.v3.parse_percentile — raw selected-run execution
// performance.v3.key_difficulty_inputs — key level / difficulty provenance
```

Suggested global mix (unchanged by this agent; confirm in calibration):

```text
SkillScore = 35% Performance + 30% Survival + 25% Utility + 10% Experience
```

Preserve `default@1` / `default@2` snapshots. Worker already patches `metricWeights.PERFORMANCE` to the v3 single metric when selected runs are present.

## Formula / versions

| Constant | Value |
|---|---|
| `PERFORMANCE_V3_FORMULA_VERSION` | `performance-v3-selected-runs-v1` |
| Execution weight | 0.65 |
| Key difficulty weight | 0.35 |
| Bounded fallback anchors | `BOUNDED_KEY_DIFFICULTY_ANCHORS` in `packages/scoring/src/performance/key-difficulty.ts` |

## Wallidrixe before / after (fixture)

Character: `EU/archimonde/Wallidrixe` (eight Midnight S1 dungeons). Live smoke remains operator-only.

| | Before (v2 driver) | After (v3 driver) |
|---|---|---|
| Driver metrics | `performance.current_season_peak` + `consistency` | `performance.v3.run_performance` |
| Per dungeon | Best % / Median % aggregates | Selected-run execution + key difficulty + `runPerformance` |
| Historical blend | Optional 15% historical best average | **Excluded** from current Performance |
| Proof | Peak/consistency mean of parses | Strong +18-band parse outranks 98% on +10 (see tests) |

Regression test: `packages/scoring/src/performance/v3.test.ts` (“Wallidrixe before/after payloads”).

## Tests executed

```bash
pnpm test -- packages/scoring/src/performance packages/scoring/src/selection/select-scoring-runs.test.ts packages/providers/warcraftlogs/src/warcraftlogs.test.ts
```

## Files owned

- `packages/scoring/src/performance/{v3,key-difficulty,parse-binding,types}*`
- `packages/scoring/src/selection/raw-fact-persist.ts` (performance field status)
- `apps/worker/src/orchestration/{wcl-performance-metrics,analyze-scoring-runs,refresh-pipeline}.ts`
- `apps/api/src/lib/scoring-run-selection.ts` (fill `keyDifficultyPercentile`)
- `packages/contracts/src/{api,runs}.ts` (additive DTO fields)
- `packages/providers/warcraftlogs` (rankPercent preference + source parse fields)
- `doc/wave4/data-coverage-wallidrixe.md`
- `doc/agents/22-performance-v3-handoff.md`

## Out of scope (frozen / other agents)

- Global dimension weights / RAID removal / final `default@3` composition (Agent 27)
- Agent 26 UI layout
- Survival / Utility / Experience formulas
- Cross-provider fusion semantics
