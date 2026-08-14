# Scoring V2 — run orchestration and cache lineage

**Status:** production live adapter + Redis singleflight + dual-path ownership + guarded canary CLI landed; **live canary not run**.  
**Experience:** out of scope for this path.

## Call graph (production)

```
refresh-pipeline.ts
  └─ maybeStartScoringV2ShadowFromRefresh   (refresh-bridge.ts)
       ├─ [default SKIP] legacy startEvidenceV2ShadowPipeline
       │     (providerOwner = DIGEST_ORCHESTRATOR — no duplicate WCL)
       └─ orchestrateScoringV2Runs
            ├─ Redis source-fight singleflight (capability package scope)
            ├─ findComplete capability package (pg://)  → cache hit
            ├─ else liveAcquireCapabilityPackage (gated)
            │     resolveAuthoritativeFightMetadata
            │     → acquireCapabilityEvidencePackage (once / fight)
            │     → persistCapabilityPackageToPostgres + reload verify
            ├─ resolveRankingParseForParticipant (persisted RANKING_PARSE only)
            ├─ buildParticipantScoringDigestsFromPackage
            └─ Performance / Utility / Survival via digest adapters
```

V1 refresh remains authoritative. Digest orchestration failures never fail V1 publish.  
`SCORING_V2_PUBLICATION_ENABLED` must stay false — eligibility is diagnostic only; the public score pointer is never mutated.

## Provider ownership

| Mode | Owner | Legacy slot fan-out |
|------|-------|---------------------|
| Shadow flags on (default) | `DIGEST_ORCHESTRATOR` | **Skipped** (`providerCallsAllowed=false`) |
| `forceLegacyProviderOwner` | `LEGACY_SLOT_PIPELINE` | Runs; digest skipped |
| Shadow flags off | `NONE` | No-op |

Diagnostics expose `providerOwner` and exact `providerCalls` from the digest orchestrator only.

## Live permission gates

All required (credentials alone never grant):

1. `PROVIDER_MODE=live`
2. `WCL_ENABLED=true`
3. `ALLOW_LIVE_PROVIDER_CALLS=true`
4. Orchestration `liveProviderPermission === "ALLOWED"`
5. `SCORING_V2_PUBLICATION_ENABLED=false`
6. WCL client id/secret present

## Distributed lock identity and lifecycle

Key: `mplus:{env}:sf-cap-pkg:{report}:{fight}:{rev}:{actorSetHash}:{abilityFilterHash}:{catalog}:{plan}:{graphql}`

Lifecycle:

1. PostgreSQL compatible package check (before lock)
2. Acquire Redis lease (`acquireSourceSingleflight`)
3. PostgreSQL check again after becoming owner
4. Only owner may call WCL; waiters poll/reload — never call WCL
5. Heartbeat lease during long pagination
6. `complete` → ready value, or `release` on failure; finally cleans up
7. Expired lease ≠ absence — always re-check DB

## Flags

| Gate | Effect |
|------|--------|
| `SCORING_V2_ENABLED` ∧ `SELECTION` ∧ `EVIDENCE_FETCH` | Shadow entry |
| `SCORING_V2_PUBLICATION_ENABLED` | Must remain **false** |
| `ALLOW_LIVE_PROVIDER_CALLS` | Digest live permission |

## Ranking / parse provenance

Persisted `RankingParseEvidenceV2` only. Missing → Performance `UNAVAILABLE` (never zero). Utility/Survival independent.

## Cost accounting and admission

- Measured points when rate-limit delta available; otherwise **conservative estimate** (`CONSERVATIVE_POINTS_PER_CAPABILITY_FIGHT = 45`) — never invent 0 for work that ran.
- Read `limitPerHour` dynamically from snapshot.
- Thresholds: WARN / DEFER / STOP from env (`WCL_RATE_*_PERCENT`).
- STOP / DEFER → no cold acquisition; provider-free replay always allowed.
- Emergency reserve floor (default 20%).

## Operator surface

Public commands and self-healing lifecycle are documented in
[25_OPERATOR_SURFACE_AND_PIPELINE.md](./25_OPERATOR_SURFACE_AND_PIPELINE.md).

Supported entry points:

- pnpm scoring-v2:canary — full shadow pipeline (discover → repair → hydrate → score → replay)
- pnpm scoring-v2:replay — provider-free reconstruction
- pnpm scoring-v2:doctor — provider-free diagnostics

Contextual step commands are internalized. Zone ID comes from the effective
scoring season persisted catalog (optional CLI `--zone-id` diagnostic override only).

## Modules

| Concern | Path |
|---------|------|
| Refresh entry | `refresh-bridge.ts` (auto package integrity before score) |
| Consolidated pipeline | `pipeline/consolidated-shadow-pipeline.ts` |
| Public CLI | `public-cli.ts` |
| Active M+ season | `orchestration/active-mplus-season/` — see [`23_ACTIVE_MPLUS_SEASON_AUTHORITY.md`](./23_ACTIVE_MPLUS_SEASON_AUTHORITY.md) |
| Live adapter | `run-orchestration/live-capability-adapter.ts` |
| Self-healing packages | `run-orchestration/self-healing-evidence.ts` |
| Redis singleflight | `run-orchestration/source-fight-lease.ts` |
| Cost admission | `run-orchestration/cost-admission.ts` |
| Internal stage modules | `canary/*` (not public operator surface) |
| Migration | `20260805180000_participant_scoring_digest` + package supersedes |

## Operator sequence

See [`25_OPERATOR_SURFACE_AND_PIPELINE.md`](./25_OPERATOR_SURFACE_AND_PIPELINE.md).

Report artifacts:

- `artifacts/scoring-v2-canary/consolidated-pipeline-report.json`
- `artifacts/scoring-v2-canary/live-canary-report.json` (internal stage)
- `artifacts/scoring-v2-canary/replay-report.json`
