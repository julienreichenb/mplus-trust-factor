# Scoring V2 — implementation status

| Workstream | Branch / worktree | Owner | Dependencies | Current commit | Test state | Blockers | Schema/contracts touched | Merge order | Next checkpoint |
|---|---|---|---|---|---|---|---|---|---|
| 02 Evidence contracts | `feat/scoring-v2-evidence-contract` (merged) | WS02 | — | `#51` | green | — | `evidence-v2.ts`, selector | 02 | done |
| 03 WCL planner | `feat/scoring-v2-wcl-planner` (merged) | WS03 | 02 | `#52` | green | — | planner package | 03 | done |
| 04 Persistence | `feat/scoring-v2-persistence` (merged) | WS04 | 02 | `#53` | green | — | Prisma V2 tables, artifact-store | 04 | done |
| 05 Async pipeline | `feat/scoring-v2-pipeline` (merged) | WS05 | 02–04 | `#54` | green | publication disabled | V2 job contracts, flags, queues | 05 | done |
| 06–09 Dimensions | merged | WS06–09 | 02–05 | `#55`–`#58` | green | — | calculator packages | 06–09 | done |
| 10 Calibration + dimension finalization | `feat/scoring-v2-calibration` | WS10 | 02–09 | tip of branch | unit green | real WCL extractors deferred; **active/draft model replay blocked** until calculator config injection; flags remain off | scoring dimensions/v2, calibration bundle V2, contracts constant, DimensionComputation logical unique migration | 10 | shadow calibration checkpoint |

## WS10 delivered

```text
@mplus/scoring exports Performance V2 / Experience V3 / Survival V2 / Utility V2
  └─ normalizeShadowDimensionRecord (lifecycle SHADOW; availability in metrics)
       └─ finalizeShadowDimensions (provider-free; per-dim isolation; fact-hash fail-closed)
            └─ worker finalize.ts → persistShadowDimensionComputations (idempotent + isolated)
                 └─ releaseFinalizationClaim on failure (FINALIZING → READY_TO_FINALIZE)
Calibration Bundle V2 (schema 2.0.0) + dispatch beside V1
  └─ preflight (hash/artifact/frozen-identity fail-closed) + provider-free export replay
       └─ report V2 extension (deltas/slices/small-slice limitations)
       └─ active-versus-draft model eval: FAIL CLOSED (arch blocker — see below)
```

## Flags (all default false)

`SCORING_V2_ENABLED`, `SCORING_V2_SELECTION_ENABLED`, `SCORING_V2_EVIDENCE_FETCH_ENABLED`,
`SCORING_V2_DIMENSIONS_ENABLED`, `SCORING_V2_PUBLICATION_ENABLED`, per-dimension toggles,
mode enums, `CALIBRATION_V2_ENABLED`. Incompatible combinations fail `loadEnv`.
Admin `createRun` remains V1 snapshot bundles while `CALIBRATION_V2_ENABLED` is false.

## DimensionComputation uniqueness

Logical identity is `(characterId, seasonId, manifestId, scoreModelId, dimension)`.
`inputFingerprint` is content integrity only. Migration
`20260802180000_dimension_computation_logical_unique` fails closed if duplicate
logical groups exist (no silent delete). Apply via normal migrate deploy — not auto-run.

## Active-versus-draft architectural blocker

`replayCalibrationBundleV2ActiveVersusDraft` throws `CALIBRATION_V2_ACTIVE_DRAFT_ARCH_BLOCKER`.

- V2 calculators hard-code package-local `*_MODEL_CONFIG` constants.
- `CalibrationModelRef.config` is `ScoreModelConfigV1` (overall aggregation), not consumed by
  `computePerformanceV2` / `computeSurvivalV2` / `computeUtilityV2`.
- Only `ExperienceV3ComputeInput.config` accepts `ExperienceV3ModelConfig` (different type).
- Smallest required API change: optional frozen `modelConfig` on each V2 compute input
  (no formula changes), plus bundle-side dimension config documents or a mapping layer.
- Until then, export replay remains available; active/draft model deltas are not fabricated.

## FINALIZING recovery

Minimal reclaim: on finalize failure after claim, `releaseFinalizationClaim` transitions
`FINALIZING → READY_TO_FINALIZE` so redelivery can CAS-claim again. Idempotent dimension
writes make redelivery safe. Concurrent double-finalization remains prevented by claim CAS.

## Deferred (explicit)

- Real Warcraft Logs event-page → Survival/Utility/Performance fact extractors
- Replacement of acquisition `shadow_placeholder` fact producers
- Experience history adapters from persisted Blizzard rows at finalize time
- Admin UI redesign / V2 createRun activation
- Active/draft model-side dimension evaluation (requires calculator config injection above)
- Full queue-state ADR for richer FINALIZING leases/TTLs (optional beyond minimal reclaim)
