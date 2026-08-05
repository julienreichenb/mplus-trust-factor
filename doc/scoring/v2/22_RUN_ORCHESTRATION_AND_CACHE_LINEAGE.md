# Scoring V2 — run orchestration and cache lineage

**Status:** shadow refresh wired; provider-free validated; live canary not run.  
**Experience:** out of scope for this path.

## Call graph (production)

```
refresh-pipeline.ts
  └─ maybeStartScoringV2ShadowFromRefresh   (refresh-bridge.ts)
       ├─ startEvidenceV2ShadowPipeline     (legacy slot fan-out; best-effort)
       └─ orchestrateScoringV2Runs          (digest path; injectable ports)
            ├─ findComplete capability package (pg://)  → cache hit
            ├─ else live acquire ONLY if ALLOW_LIVE_PROVIDER_CALLS + live hook
            ├─ resolveRankingParseForParticipant (persisted RANKING_PARSE only)
            ├─ buildParticipantScoringDigestsFromPackage
            └─ Performance / Utility / Survival calculators via digest adapters
```

V1 refresh remains authoritative. Digest orchestration failures never fail V1 publish.
`SCORING_V2_PUBLICATION_ENABLED` must stay false — eligibility is diagnostic only; the public score pointer is never mutated.

## Flags and provider gates

| Gate | Effect |
|------|--------|
| `SCORING_V2_ENABLED` ∧ `SELECTION` ∧ `EVIDENCE_FETCH` | Shadow orchestration entry (`isScoringV2ShadowOrchestrationEnabled`) |
| `SCORING_V2_PUBLICATION_ENABLED` | Must remain **false**; `assertPublicationBlocked` refuses otherwise |
| `ALLOW_LIVE_PROVIDER_CALLS` | Separate live WCL gate for digest path (`FORBIDDEN` → structured `PROVIDER_EVIDENCE_CACHE_MISS`) |
| Fixture / test ports | Provider-free; no WCL client |

Ordinary refreshes do **not** accidentally enable live WCL on the digest path.

## Ranking / parse provenance

Authoritative source: persisted `RankingParseEvidenceV2` (`wcl-ranking-parse-v1` / dataset key `ranking_parse`), bound to `reportCode + fightId + revision (+ actor)`.

Hydration: `ranking-hydrate.ts` → `ParticipantScoringDigestV1.performance` with explicit `rankingProvenance`.  
Never derived from raw event streams. Rebuild digests from package + persisted ranking → **0 WCL**.

Missing ranking → Performance `completeness: UNAVAILABLE` → calculator fails closed. Utility / Survival remain independently valid.

## Incomplete manifest policy (shadow diagnostics)

A manifest with fewer than 16 selected slots may be persisted, expose missing slots, process available evidence, build available digests, and compute dimension diagnostics when supported. It is marked `incomplete`.

Missing / incomplete evidence is **never** converted to a zero score.

## Publication eligibility (decision only)

Eligible when all hold:

1. 16 required slots selected (`incomplete === false`)
2. Exactly 16 character digests for the requested character
3. Zero provider cache misses and zero fight failures
4. Performance, Utility, Survival each satisfy completeness (no blocked dimension)
5. Score-model id present

`evaluatePublicationEligibility` records the gate; `publicationEnabled` stays false; `publicScorePointerMutated` stays false.

## Transaction and retry boundaries

- No DB transaction spans provider calls.
- One failed fight does not corrupt completed fights (`fightFailures[]`).
- Incomplete packages are never treated as compatible cache hits.
- Retry reuses complete packages / digests; only missing or incompatible work is acquired/rebuilt.
- Provider errors become structured orchestration results (cache miss or fight failure).

## Three-layer cache

1. **Provider evidence** — `buildCapabilityPackageCompatibilityKey` / `CapabilityEvidencePackageRecord` (`complete=true` required)
2. **Participant digest** — `buildParticipantDigestCompatibilityKey` / `ParticipantScoringDigest`
3. **Score result** — digest hashes + score model/version (`buildDigestScoreLineage`)

## Modules

| Concern | Path |
|---------|------|
| Refresh entry | `apps/worker/src/orchestration/scoring-v2/refresh-bridge.ts` |
| Orchestrator | `apps/worker/src/orchestration/scoring-v2/run-orchestration/` |
| Production ports | `run-orchestration/production-ports.ts` |
| Publication eligibility | `run-orchestration/publication-eligibility.ts` |
| Ranking hydrate | `run-orchestration/ranking-hydrate.ts` |
| Digest contract | `packages/contracts/src/participant-scoring-digest-v1.ts` |
| Migration | `20260805180000_participant_scoring_digest` |

### Migration rollback impact

Forward-only additive tables (`capability_evidence_package_records`, `participant_scoring_digests`). Rollback = drop those tables/indexes; existing artifact and scoring rows are unaffected. Downgrade migration not required for this workstream. Apply only on local/integration DBs — not staging/production in this task.

## Selection policy

Unchanged: `compareEvidenceCandidatesV2` (keyLevel → timed → runScore → completeness → completedAt → reportCode → fightId). Persistence never ranks.

## Live canary (not run)

**Remaining blockers before a controlled one-character live canary:**

1. Wire explicit `liveAcquireCapabilityPackage` hook (GraphQL client + fight window + `acquireCapabilityEvidencePackage` + pg:// persist) — currently refused unless injected.
2. Confirm Redis source-fight singleflight for multi-worker (in-process lock is default today).
3. Dual-path risk: legacy slot pipeline may still acquire WCL independently — gate or disable one path for canary.
4. Confirm persisted `RANKING_PARSE` rows exist for the canary character’s selected fights (else Performance stays blocked).
5. Keep `SCORING_V2_PUBLICATION_ENABLED=false`.
6. Human approval for `ALLOW_LIVE_PROVIDER_CALLS=true` on a single character only.

Proposed command (after blockers cleared):

```bash
# PowerShell example — one character, shadow only, publication off
$env:SCORING_V2_ENABLED="true"
$env:SCORING_V2_SELECTION_ENABLED="true"
$env:SCORING_V2_EVIDENCE_FETCH_ENABLED="true"
$env:SCORING_V2_PUBLICATION_ENABLED="false"
$env:ALLOW_LIVE_PROVIDER_CALLS="true"
# Then trigger the existing admin/worker one-character shadow refresh for that character.
```

**Expected WCL budget (upper bound):** ≤1 shared capability acquisition per unique missing source fight (package accounting.providerCalls), plus at most 1 ranking-parse lookup per fight if not already persisted. Complete cache replay → **0** provider calls. Digests: 5 per fight; character digests: 16 for scoring.

Do not enable live WCL until explicit approval.
