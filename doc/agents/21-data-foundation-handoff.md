# Agent 21 — Scoring v3 data foundation handoff

## Branch / worktree

- Worktree: `21-wave4-foundation`
- Branch: `agent/wave4-data-foundation`
- Do **not** merge into `integration/wave4` or `main` from this agent.

## Commit

- Feature: `97d346b9d7440f6239255a13c3bd11f6815db9fb`
- Branch tip: `f72fb8fab259992e8d2d672c785418c41417cded`

## Summary

Gate A data foundation for Scoring v3 without changing the active score model:

- Typed `ScoringRunSelection`, Survival/Utility/Performance raw fact DTOs + provenance in `@mplus/contracts`
- Versioned `AbilityRule` + `ScoringMechanicRule` schemas, loaders, validation, bounded Warlock Demo seed catalogs in `@mplus/mechanics`
- Active-season dungeon set (`MIDNIGHT_S1_SEASON`) with placeholder-season refusal
- Deterministic per-dungeon selection (`selectScoringRuns`) that never demotes an unlogged highest run
- Catalog-driven raw fact extraction with pet/player attribution (`petOwner`)
- Persistable MetricObservation envelopes carrying formula/catalog versions + `observedAt`
- Extended sanitized WCL deep smoke emits eight-run `scoringV3Foundation` rows + pagination/cost
- Coverage matrix: `doc/wave4/data-coverage-wallidrixe.md`

## Tests executed

- `pnpm test -- packages/mechanics/src/wave4-foundation.test.ts packages/scoring/src/selection/select-scoring-runs.test.ts packages/providers/warcraftlogs/src/wave4-foundation.test.ts packages/providers/warcraftlogs/src/warcraftlogs.test.ts packages/mechanics/src/mechanics.test.ts`
- Package builds for contracts / mechanics / scoring / warcraftlogs

## Live smoke

- `pnpm wcl:smoke -- --region EU --realm archimonde --name Wallidrixe --deep` — **operator-only** when `ALLOW_LIVE_PROVIDER_CALLS=true` and WCL credentials are present (not CI).

## Provider cost / bounds

- Event fetch remains capped: 10 pages / 2000 events per category
- Deep smoke may analyze up to 8 selected fights; worker production path still latest+highest (`MAX_ANALYSIS_FIGHTS=2`)

## Blockers for Agents 22–26

1. **Max health** missing from combat facts — Survival normalization blocked
2. **Key difficulty percentile** needs season cutoffs / distribution (Agent 22)
3. **Mechanic catalog coverage** sparse — avoidable damage PARTIAL until Agent 23 expands rules
4. **Offensive dispel capability** not seeded for Warlock — Agent 24
5. **Worker analysis budget** still 2 fights — eight-run persistence not wired into refresh pipeline
6. Parse↔selected-fight tying remains best-effort when rankings omit fight IDs

## Contract freeze recommendation

Freeze selection + raw-fact + catalog schemas listed in `doc/wave4/data-coverage-wallidrixe.md`. Do **not** freeze score weights/`default@3` until Agent 27 calibration.

## Files changed (owned)

- `packages/contracts/src/scoring-v3-data.ts`
- `packages/mechanics/src/{ability-types,scoring-mechanic-types,season-dungeons,catalog-loader,raw-facts,catalogs/*,wave4-foundation.test}.ts`
- `packages/scoring/src/selection/*`
- `packages/providers/warcraftlogs/src/{smoke-live,smoke/eight-run-facts,discovery/run-matching,operations/queries,client/graphql-client,types,wave4-foundation.test}.ts`
- `apps/worker/src/orchestration/run-fusion.ts` (Midnight dungeon aliases only)
- `doc/wave4/data-coverage-wallidrixe.md`
- `doc/agents/21-data-foundation-handoff.md`
