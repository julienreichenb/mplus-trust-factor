# Scoring V2 — implementation status

| Workstream | Branch / worktree | Owner | Dependencies | Current commit | Test state | Blockers | Schema/contracts touched | Merge order | Next checkpoint |
|---|---|---|---|---|---|---|---|---|---|
| 02 Evidence contracts | `feat/scoring-v2-evidence-contract` (merged) | WS02 | — | `#51` | green | — | `evidence-v2.ts`, selector | 02 | done |
| 03 WCL planner | `feat/scoring-v2-wcl-planner` (merged) | WS03 | 02 | `#52` | green | — | planner package | 03 | done |
| 04 Persistence | `feat/scoring-v2-persistence` (merged) | WS04 | 02 | `#53` | green | — | Prisma V2 tables, artifact-store | 04 | done |
| 05 Async pipeline | `feat/scoring-v2-pipeline` | WS05 | 02–04 | tip of branch | unit + integration green | publication remains disabled; dimension calculators not wired; Redis/shutdown deferred to WS12 | V2 job contracts, `SCORING_V2_*` flags, queues/processors | 05 | shadow orchestration checkpoint |

## Prompt 05 delivered topology

```text
refresh-character (V1, unchanged public path)
  └─ maybeStartScoringV2ShadowFromRefresh (flags off → no-op)
       ├─ buildEvidenceAcquisitionPlanV2
       ├─ rate-budget preview (defer whole plan)
       └─ fan-out analyze-evidence-slot (×N)
            └─ acquire with ordered fallbacks + artifacts
                 └─ fan-in finalize-analysis-batch (provider-free)
                      ├─ finalizeEvidenceManifestV2
                      ├─ EvidenceRepository.createFrozenManifest
                      ├─ DimensionComputation placeholders (if dimensions flag)
                      └─ NO CharacterPublishedScore mutation
calibration-run — isolated (unchanged)
```

## Flags (all default false)

`SCORING_V2_ENABLED`, `SCORING_V2_SELECTION_ENABLED`, `SCORING_V2_EVIDENCE_FETCH_ENABLED`,
`SCORING_V2_DIMENSIONS_ENABLED`, `SCORING_V2_PUBLICATION_ENABLED`, per-dimension toggles,
mode enums, `CALIBRATION_V2_ENABLED`. Incompatible combinations fail `loadEnv`.

## Verification (pre-push)

### Integration

```text
pnpm test:integration -- apps/worker/src/orchestration/scoring-v2/pipeline.integration.test.ts
→ 1 passed (batch create, terminal slots, fan-in CAS, frozen manifest, redelivery, no CharacterPublishedScore mutation)
```

### Worker `tsc` baseline comparison

**Cold command** (no prior package `dist/` builds):

```bash
pnpm --filter @mplus/worker build
```

| Ref | Result |
|-----|--------|
| `origin/main` @ `bfecdd1` | Fails with many `TS2307 Cannot find module '@mplus/*'` (project references not built). Example: `src/container.ts` cannot find `@mplus/config`, `@mplus/database`, `@mplus/observability`, `@mplus/contracts`, `@mplus/scoring`. ~39 `error TS` lines observed. |
| WS05 tip | Same cold failure class when deps are unbuilt (identical baseline gap). |

**Warm command** (after building referenced packages + `prisma generate`):

```bash
pnpm --filter @mplus/database exec prisma generate
pnpm -r --filter @mplus/config --filter @mplus/contracts --filter @mplus/domain \
  --filter @mplus/observability --filter @mplus/abilities --filter @mplus/mechanics \
  --filter @mplus/artifact-store --filter @mplus/database \
  --filter @mplus/provider-blizzard --filter @mplus/provider-raiderio \
  --filter @mplus/provider-warcraftlogs --filter @mplus/scoring \
  --filter @mplus/test-utils run build
pnpm --filter @mplus/worker build
```

| Ref | Result |
|-----|--------|
| `origin/main` @ `bfecdd1` | **exit 0** |
| WS05 tip | **exit 0** (WS05-only `InputJsonValue` cast in `evidence-v2-batch-repository` fixed via `as unknown as Prisma.InputJsonValue`) |

Conclusion: cold worker build failure is a **pre-existing main baseline** (unbuilt project references), not introduced by WS05. After warm prep, WS05 adds no build errors.
