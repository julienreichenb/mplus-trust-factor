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

## Canary CLI (do not run live in automation)

Zone ID is **not** a CLI argument in production. Both phases read `WCL_MPLUS_ZONE_ID`
(zone **47** = Midnight Season 1). The operator CLI uses **production** PostgreSQL
repositories (`createWorkerContainer` + `createProductionRunOrchestrationPorts`):
character via `findByIdentity`, season/dungeon pool via persisted `Season` /
`SeasonDungeon` (validated via ActiveMythicPlusSeasonAuthority), manifests
via `EvidenceManifest`. In-memory ports and sentinel UUIDs are test-only.

Authoritative Midnight Season 1 dungeon slugs:

`algethar-academy`, `magisters-terrace`, `maisara-caverns`, `nexus-point-xenas`,
`pit-of-saron`, `seat-of-the-triumvirate`, `skyreach`, `windrunner-spire`.

Obsolete TWW pools (e.g. `ara-kara-city-of-echoes`, …) cause `SEASON_CATALOG_MISMATCH`
before any manifest is created. Stale manifests from another pool are not reused
(`STALE_POOL_REJECTED` / `MANIFEST_NOT_FOUND`).

### Phase A — provider-free preflight

```powershell
pnpm scoring-v2:canary:preflight -- `
  --region EU `
  --realm archimonde `
  --character Wallidrixe
```

### Catalog diagnostic / local repair (never staging/production)

```powershell
pnpm scoring-v2:canary:diagnose-catalog
# Local DB only, after reviewing diagnostic:
pnpm scoring-v2:canary:repair-catalog -- --region EU --confirm-local-repair
# Prefer season authority sync when Blizzard credentials are available:
pnpm season:sync-authority -- --region EU
```

Zero WCL calls. JSON under `artifacts/scoring-v2-canary/`. Reports real `characterId`,
`seasonResolution`, `manifestStatus`, package/digest/ranking cache, cost blockers.
Publication eligibility remains false. When `MANIFEST_NOT_FOUND`, package/ranking
fields are `NOT_EVALUATED` (not projected misses); publication-disabled is a
safety check, not a blocker.

### Phase B — discovery-only (human, explicit arm)

```powershell
$env:PROVIDER_MODE="live"
$env:WCL_ENABLED="true"
$env:ALLOW_LIVE_PROVIDER_CALLS="true"
$env:SCORING_V2_ENABLED="true"
$env:SCORING_V2_SELECTION_ENABLED="true"
$env:SCORING_V2_EVIDENCE_FETCH_ENABLED="true"
$env:SCORING_V2_PUBLICATION_ENABLED="false"
$env:SCORING_V2_CANARY_DISCOVERY_EXECUTE="true"
pnpm scoring-v2:canary:discover -- `
  --region EU `
  --realm archimonde `
  --character Wallidrixe `
  --confirm-discovery
```

Discovers candidates, freezes the V2 evidence manifest, and may persist ranking
parse evidence. **Does not** acquire capability event packages, participant
digests, or scores. Requires both `--confirm-discovery` and
`SCORING_V2_CANARY_DISCOVERY_EXECUTE=true`. `SCORING_V2_CANARY_EXECUTE` does
**not** authorize this phase.

**Rate admission (two-stage):** local gates first (zero WCL). Then one
`RateLimitData` bootstrap (or reuse of a persisted snapshot within
`WCL_CANARY_RATE_SNAPSHOT_TTL_SECONDS`, default 60s). Bootstrap cost is counted
and included in projected discovery utilization. OK/WARN allow discovery;
DEFER/STOP refuse before report/fight discovery. Optional:
`pnpm scoring-v2:canary:rate-snapshot` performs only the quota-status request.

Then re-run Phase A preflight to inspect package misses / projected capability cost.

### Phase C — explicit live capability (human only)

```powershell
$env:PROVIDER_MODE="live"
$env:WCL_ENABLED="true"
$env:ALLOW_LIVE_PROVIDER_CALLS="true"
$env:SCORING_V2_ENABLED="true"
$env:SCORING_V2_SELECTION_ENABLED="true"
$env:SCORING_V2_EVIDENCE_FETCH_ENABLED="true"
$env:SCORING_V2_PUBLICATION_ENABLED="false"
# After human approval of preflight + discovery + budget:
$env:SCORING_V2_CANARY_EXECUTE="true"
pnpm scoring-v2:canary:live -- `
  --region EU `
  --realm archimonde `
  --character Wallidrixe `
  --confirm-live
```

Refuses without `--confirm-live`, with publication on, wildcards/cohorts, or missing shadow/live gates. Execute path stays armed-only via `SCORING_V2_CANARY_EXECUTE`.

**Expected budget (upper bound):** ≤1 capability acquisition per unique missing fight (≈45 points estimated each if unmeasured) + fight-metadata GraphQL (1/fight on miss) + discovery overhead. Full cache → **0** provider calls. Digests: 5/fight; character digests: 16.

## Modules

| Concern | Path |
|---------|------|
| Refresh entry | `refresh-bridge.ts` |
| Active M+ season | `orchestration/active-mplus-season/` — see [`23_ACTIVE_MPLUS_SEASON_AUTHORITY.md`](./23_ACTIVE_MPLUS_SEASON_AUTHORITY.md) |
| Live adapter | `run-orchestration/live-capability-adapter.ts` |
| Redis singleflight | `run-orchestration/source-fight-lease.ts` |
| Cost admission | `run-orchestration/cost-admission.ts` |
| Preflight | `run-orchestration/canary-preflight.ts` |
| Discovery-only | `canary/canary-discover.ts` + `canary-discovery-gates.ts` |
| Rate snapshot bootstrap | `canary/canary-rate-snapshot.ts` (`RateLimitData`, TTL reuse) |
| Canary CLI | `canary/cli.ts` |
| Canary zone | `canary/canary-zone.ts` (`WCL_MPLUS_ZONE_ID`) |
| Canary catalog | `canary/canary-catalog.ts` / `canary-season.ts` |
| Canary deps | `canary/canary-deps.ts` (PRODUCTION only for operators) |
| Catalog diagnose/repair | `canary/canary-diagnose.ts` / `canary-repair-catalog.ts` |
| Migration | `20260805180000_participant_scoring_digest` |

## Remaining blocker before human approval

1. Run Phase A preflight against the real character DB state (`MANIFEST_NOT_FOUND` expected before discovery).
2. Run Phase B discovery-only after catalog repair; confirm frozen manifest + zero capability acquisitions.
3. Re-run Phase A; review package misses and projected WCL utilization vs DEFER/STOP.
4. Explicit `--confirm-live` + `SCORING_V2_CANARY_EXECUTE=true` after approval.
5. Keep publication disabled for the entire canary.

Do not enable live WCL capability acquisition until that approval.
