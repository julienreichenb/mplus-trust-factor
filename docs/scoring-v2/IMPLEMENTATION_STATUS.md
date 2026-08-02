# Scoring V2 — implementation status

| Workstream | Branch / worktree | Owner | Dependencies | Current commit | Test state | Blockers | Schema/contracts touched | Merge order | Next checkpoint |
|---|---|---|---|---|---|---|---|---|---|
| 02 Evidence contracts | `feat/scoring-v2-evidence-contract` (merged) | WS02 | — | `#51` | green | — | `evidence-v2.ts`, selector | 02 | done |
| 03 WCL planner | `feat/scoring-v2-wcl-planner` (merged) | WS03 | — | `#52` | green | — | planner package | 03 | done |
| 04 Persistence | `feat/scoring-v2-persistence` (merged) | WS04 | 02 | `#53` | green | — | Prisma V2 tables, artifact-store | 04 | done |
| 05 Async pipeline | `feat/scoring-v2-pipeline` (merged) | WS05 | 02–04 | `#54` | green | publication disabled | V2 job contracts, flags, queues | 05 | done |
| 06–09 Dimensions | merged | WS06–09 | 02–05 | `#55`–`#58` | green | — | calculator packages | 06–09 | done |
| 10 Calibration + dimension finalization | `feat/scoring-v2-calibration` (merged) + WS10.5 model-config | WS10 | 02–09 | tip | unit + disposable E2E green | real WCL extractors deferred; flags remain off | scoring dimensions/v2, calibration bundle V2, model-config injection | 10 | done (shadow + active/draft replay) |
| 11 Admin + public explainability | `feat/scoring-v2-explainability` | WS11 | 02–10 | tip of branch | unit + route inject green | public attach remains null while lifecycle SHADOW; flags remain off; no deploy | `explainability-v2` contracts, scoring builders, admin GET diagnostics, public profile field + UI | 11 | explainability checkpoint |

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
       └─ active-versus-draft model eval via replayCalibrationBundleV2ActiveVersusDraft
            (strict deep config validation + fingerprint verify at replay boundary)
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

## Active-versus-draft (WS10.5)

`replayCalibrationBundleV2ActiveVersusDraft` evaluates ACTIVE and DRAFT dimension
configs against identical frozen facts.

- Dimension calculators accept optional validated `modelConfig` overrides.
- Persisted `ScoreModel.config.scoringV2` maps to four versioned dimension configs
  (Json — no Prisma migration). Active-versus-draft fails closed when missing.
- Utility and Experience nested fields are deep-validated (no raw clone).
- Replay boundary always re-parses configs and verifies fingerprints before scoring.
- `CALIBRATION_V2_ENABLED` remains default-off; no model activation.
- Agent 11 active/draft calibration may proceed only after review passes; production
  activation remains a separate cutover decision.

## FINALIZING recovery

Minimal reclaim: on finalize failure after claim, `releaseFinalizationClaim` transitions
`FINALIZING → READY_TO_FINALIZE` so redelivery can CAS-claim again. Idempotent dimension
writes make redelivery safe. Concurrent double-finalization remains prevented by claim CAS.

## WS11 delivered

```text
@mplus/contracts explainability-v2 DTOs + sanitizeExplainabilityJson / buildPublicFromAdmin
  └─ @mplus/scoring buildExplainabilityV2Admin + toPublicExplainabilityV2 (SHADOW → public null)
       └─ GET /api/v1/admin/scoring-v2/manifests (paginated)
       └─ GET /api/v1/admin/scoring-v2/characters/:id/explainability (RBAC score.candidate.read)
            └─ CharacterProfileResponse.explainabilityV2 (additive; null while SHADOW)
                 └─ Admin /admin/scoring-v2 diagnostics UI + public ExplainabilityV2Panel
```

Public never includes report codes; admin may. GET paths are DB-only (no provider calls).
Flags remain default-off; no publication enablement in this workstream.

## Deferred (explicit)

- Real Warcraft Logs event-page → Survival/Utility/Performance fact extractors
- Replacement of acquisition `shadow_placeholder` fact producers
- Experience history adapters from persisted Blizzard rows at finalize time
- Admin UI redesign / V2 createRun activation (`CALIBRATION_V2_ENABLED` remains false)
- Full queue-state ADR for richer FINALIZING leases/TTLs (optional beyond minimal reclaim)
- Public explainability population once `SCORING_V2_PUBLICATION_ENABLED` + non-SHADOW lifecycle
