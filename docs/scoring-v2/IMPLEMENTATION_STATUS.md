# Scoring V2 — implementation status

| Workstream | Branch / worktree | Owner | Dependencies | Current commit | Test state | Blockers | Schema/contracts touched | Merge order | Next checkpoint |
|---|---|---|---|---|---|---|---|---|---|
| 02 Evidence contracts | `feat/scoring-v2-evidence-contract` (merged) | WS02 | — | `#51` | green | — | `evidence-v2.ts`, selector | 02 | done |
| 03 WCL planner | `feat/scoring-v2-wcl-planner` (merged) | WS03 | 02 | `#52` | green | — | planner package | 03 | done |
| 04 Persistence | `feat/scoring-v2-persistence` (merged) | WS04 | 02 | `#53` | green | — | Prisma V2 tables, artifact-store | 04 | done |
| 05 Async pipeline | `feat/scoring-v2-pipeline` (merged) | WS05 | 02–04 | `#54` | green | publication disabled | V2 job contracts, flags, queues | 05 | done |
| 06–09 Dimensions | merged | WS06–09 | 02–05 | `#55`–`#58` | green | — | calculator packages | 06–09 | done |
| 10 Calibration + dimension finalization | `feat/scoring-v2-calibration` | WS10 | 02–09 | tip of branch | unit green | real WCL extractors deferred; flags remain off | scoring dimensions/v2, calibration bundle V2, contracts constant | 10 | shadow calibration checkpoint |

## WS10 delivered

```text
@mplus/scoring exports Performance V2 / Experience V3 / Survival V2 / Utility V2
  └─ normalizeShadowDimensionRecord (lifecycle SHADOW; availability in metrics)
       └─ finalizeShadowDimensions (provider-free; per-dim isolation)
            └─ worker finalize.ts → persistShadowDimensionComputations (idempotent)
Calibration Bundle V2 (schema 2.0.0) + dispatch beside V1
  └─ preflight (hash/artifact fail-closed) + provider-free replay
       └─ report V2 extension (deltas/slices/small-slice limitations)
```

## Flags (all default false)

`SCORING_V2_ENABLED`, `SCORING_V2_SELECTION_ENABLED`, `SCORING_V2_EVIDENCE_FETCH_ENABLED`,
`SCORING_V2_DIMENSIONS_ENABLED`, `SCORING_V2_PUBLICATION_ENABLED`, per-dimension toggles,
mode enums, `CALIBRATION_V2_ENABLED`. Incompatible combinations fail `loadEnv`.
Admin `createRun` remains V1 snapshot bundles while `CALIBRATION_V2_ENABLED` is false.

## Deferred (explicit)

- Real Warcraft Logs event-page → Survival/Utility/Performance fact extractors
- Replacement of acquisition `shadow_placeholder` fact producers
- Experience history adapters from persisted Blizzard rows at finalize time
- Admin UI redesign / V2 createRun activation
- Prisma migration (not required — root JSONB + artifact refs)
