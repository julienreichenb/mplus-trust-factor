# Scoring V2 — run orchestration and cache lineage

**Status:** production orchestration module landed (provider-free validated).  
**Experience:** out of scope for this path.

## Pipeline gap map (pre-wiring)

| Stage | Production module | Gap before this work |
|-------|-------------------|----------------------|
| Character refresh entry | `refresh-pipeline.ts` → `maybeStartScoringV2ShadowFromRefresh` | Shadow pipeline only |
| WCL discovery | `planCandidateDiscovery` / zone rankings | OK |
| Candidate hydration | fight-details + revision | OK |
| 16-slot selection | `compareEvidenceCandidatesV2` + `buildEvidenceAcquisitionPlanV2` | OK — **authoritative** |
| Evidence acquisition | `acquireCandidateWithFallback` → `WclRunEvidenceBundle` | Capability package not wired |
| Feature extraction | `extractors/v2/*` → `RunFactSet` | Canonical extractors probe-only |
| Score calculation | `finalizeShadowDimensions` ← `RunFactSet` | Digests not consumed |

**Reuse:** selector, `pg://` artifact store, capability acquire/persist library, Offensive/Utility/Survival extractors, Performance/Utility/Survival calculators (no formula changes).

**Seam:** unique source fight → one `CapabilityEvidencePackageV1` → five `ParticipantScoringDigestV1` → calculators via digest adapters.

## Three-layer cache

1. **Provider evidence** — `reportCode|fightId|revision|actorSet|abilityFilter|catalog|plan|graphql|mode` (`buildCapabilityPackageCompatibilityKey`). Indexed by `CapabilityEvidencePackageRecord`.
2. **Participant digest** — `buildParticipantDigestCompatibilityKey` (package hash + digest/extractor/catalog versions). Indexed by `ParticipantScoringDigest`.
3. **Score result** — digest content hashes + score model/version (lineage via `buildDigestScoreLineage`).

Changed extractor → rebuild digests from package (0 WCL).  
Changed score model → recalculate from digests (0 WCL, 0 digest rebuild).

## Modules

| Concern | Path |
|---------|------|
| Digest contract | `packages/contracts/src/participant-scoring-digest-v1.ts` |
| Package/digest indexes | Prisma + `CapabilityEvidencePackageRepository` / `ParticipantScoringDigestRepository` |
| Digest builder | `packages/providers/warcraftlogs/src/extractors/digest/build-participant-scoring-digest.ts` |
| Calculator adapters | `packages/scoring/src/dimensions/v2/digest-adapters.ts` |
| Orchestrator | `apps/worker/src/orchestration/scoring-v2/run-orchestration/` |

## Selection policy

Unchanged: `compareEvidenceCandidatesV2` (keyLevel → timed → runScore → completeness → completedAt → reportCode → fightId). Persistence never ranks.

## Calculator input mapping

| Dimension | Digest fields | Existing calculator input |
|-----------|---------------|---------------------------|
| Performance | `performance.parse*` (+ offensive activations stored; formula unchanged) | `PerformanceRunParseFactV2` |
| Utility | `utility.actions` | `UtilityV2RunFactSet` |
| Survival | damage/deaths/defensives/recovery/externals/pressure | `SurvivalFactDocumentV2` |

## Live canary (not run)

Proposed after provider-free green:

```bash
# Exact command TBD against admin shadow-canary / worker probe once flags reviewed.
# Expected: N unique missing fights × ≤1 shared capability acquisition each.
# Upper bound: acquireCapabilityEvidencePackage accounting.providerCalls per fight.
# Packages: 1 per unique fight; digests: 5 per fight; character digests: 16 for scoring.
```

Do not enable live WCL until explicit approval.
