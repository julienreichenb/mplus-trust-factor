# Agent 25 — Experience v3 handoff

## Commit

`b1ad7af2292e7376463850b91abb300f14d08c41`

## Branch / worktree

- Worktree: `25-experience-v3`
- Branch: `agent/wave4-experience-v3`
- Do **not** merge into `integration/wave4` or `main` from this agent.

## Summary

Experience v3 public-character implementation + account-graph feasibility:

- Feasibility decision: public profiles ship as **CHARACTER_HISTORY**; account-wide alts are **BLOCKED** without verified linkage
- Pure formula module `@mplus/scoring` `experience/` (peak 45% / breadth 25% / historical 20% / longevity 10%)
- Season normalization + age decay with non-zero floor (`0.35`)
- Labels `CHARACTER_HISTORY` vs `VERIFIED_ACCOUNT_HISTORY`
- Missing `account_linked_alts` is unavailable, not a low score
- Raider.IO field set expanded to `mythic_plus_scores_by_season:current:previous` + `seasons[]` on profile DTO
- Worker emits Experience v3 observations (and bridges into existing v2 keys where safe)
- **Did not** change global dimension weights, remove RAID, seed `default@3`, or touch other dimension formulas

## Required global model configuration (Agent 27)

Create scoring model `default@3` (do not silently rewrite historical `default@2` snapshots).

### Global SkillScore weights (Wave 4 proposal)

```text
SkillScore = 35% Performance
           + 30% Survival
           + 25% Utility
           + 10% Experience
```

- Remove RAID from the active product mix (or weight `mythicRaid: 0` and omit RAID metrics).
- Renormalize only at the global dimension level when a dimension is genuinely unavailable.
- Keep Confidence separate; continue UNRATED below the configured threshold.

### EXPERIENCE metricWeights for `default@3`

| metricKey | weight |
|---|---:|
| `experience.current_peak` | 0.45 |
| `experience.current_breadth` | 0.25 |
| `experience.historical_peak` | 0.20 |
| `experience.longevity` | 0.10 |

Factory helper already available: `resolveExperienceV3MetricWeights()` in `@mplus/scoring`.

### Normalization hints

| metricKey | type | notes |
|---|---|---|
| `experience.current_peak` | percentile / identity | Already 0–100 season-normalized |
| `experience.current_breadth` | identity | Diminishing-returns dungeon coverage 0–100 |
| `experience.historical_peak` | identity | Age-decayed season-normalized peak 0–100 |
| `experience.longevity` | identity | Active-season share toward target (default 6) |

### Deprecated / transitional EXPERIENCE keys (v2)

Keep emitting during transition if desired, but prefer the v3 keys above once `default@3` is active:

- `experience.mythic_rating` → superseded by `experience.current_peak`
- `experience.dungeon_breadth` → bridged from `experience.current_breadth`
- `experience.historical_seasons` → bridged from `experience.historical_peak`
- `experience.volume_recency`, `experience.top_level_repeat`, `experience.role_continuity` → not part of v3 baseline

### Calibration follow-ups for Agent 27

1. Per-season cutoffs/ceilings so historical seasons stop using the shared heuristic ceiling.
2. Cohort check that CHARACTER_HISTORY scores are not depressed solely by BLOCKED alts.
3. Optional verified-account bias audit once OAuth linkage exists.
4. Persist `ExperienceSummaryDTO` on profile explanation payloads for UX (`mode`, `label`, `accountGraph`).

## Tests executed

```text
pnpm exec vitest run packages/scoring/src/experience packages/scoring/src/wallidrixe.regression.test.ts packages/providers/raiderio apps/worker/src/orchestration/experience-metrics.test.ts
```

## Live smoke

Operator-only when credentials present:

```text
pnpm wcl:smoke -- --region EU --realm archimonde --name Wallidrixe --deep
```

Public Experience path does not require user OAuth.

## Files owned

- `packages/scoring/src/experience/*`
- `packages/contracts/src/scoring-v3-data.ts` (Experience DTOs)
- `packages/contracts/src/raiderio.ts` (`seasons[]`)
- `packages/providers/raiderio/src/{fields,normalize}.ts` (+ tests)
- `apps/worker/src/orchestration/experience-metrics.ts` (+ test, refresh-pipeline wire)
- `doc/wave4/experience-feasibility.md`
- `doc/wave4/data-coverage-wallidrixe.md` (Experience rows)
- `doc/agents/25-experience-handoff.md`

## Blockers / product decisions

1. Battle.net user OAuth + claim UX required before enabling `VERIFIED_ACCOUNT_HISTORY` in production.
2. Historical normalization quality remains PARTIAL until per-season cutoffs/ceilings are calibrated.
3. Do not scrape Raider.IO HTML or invent alt edges from WCL rosters.
