# Scoring V2 Shadow Canary — status

Operational status for the live Shadow Canary on `feat/scoring-v2-live-canary`.
Git history is the archive.

## Completed runtime wiring

- Production transport uses **persistent DB/CAS** (`EvidenceDatasetPage` + RawArtifact) before WCL; in-memory L1 is optional only.
- Redis **source singleflight** + global HTTP ≤3 + per-character ≤2 (outer slot hold; HTTP permit at transport only).
- After shared evidence: permanent **WclRunSourceDigest** (+ participant rows).
- BullMQ worker `scoring-v2-shadow-canary`: discover → plan → slot fan-out → finalize.
- Admin launch enqueues a real job; finalize marks canary **COMPLETED** with bounded diagnostics.
- `adminShadowCanary` batch meta bypasses process-env SCORING_V2 gates while publication stays blocked.
- Relaunch after COMPLETED/FAILED creates a **new** canary row (source reuse via digest fingerprints).

## Live defects fixed during this pass (local commits)

| Commit | Defect |
|--------|--------|
| `0e3efd7` | Discovery GraphQL used wrong variable (`realm` vs `realmSlug`) |
| `4d77a01` | Nested per-character WCL permits deadlocked concurrent slots; RateDefer reclaim + slot retries |
| `d62b68b` | All candidates rejected as `TIMED_STATE_UNKNOWN` — derive timed from WCL `keystoneBonus` |
| `22eeed2` | Slot WCL fight fetch missing `ProviderFetchContext.targetCharacter` → instant `FALLBACK_EXHAUSTED` |
| `d7a6531` | Target identity used non-existent `Character.name` instead of `displayName` |

## Live Wallidrixe proof (EU / archimonde / Wallidrixe)

Official admin/API/BullMQ path. Identity: warlock / demonology / DPS / catalog `12.0.0/midnight-season-1`.

### Run 1 — `49e8378d-4dc0-4cef-8fc7-0a21824b777d`

| Field | Value |
|-------|--------|
| Terminal state | **COMPLETED** (~70s) |
| Batch | `d7086e52-f34c-4a19-9550-3d332fd9719d` FINALIZED |
| Discovery | 38 candidates → 35 planned; private/hidden **0**; untimed **1**; timed-unknown **20**; providerCalls **14** |
| Active pool | 8 dungeons (blizzard_metadata) |
| Slot matrix | **PARTIAL 13** / **UNAVAILABLE 3** |
| Missing-slot reasons | `algethar-academy:0/1` → `MISSING_NO_CANDIDATE`; `skyreach:1` → `MISSING_NO_CANDIDATE` |
| Digests | **13** rows, **35553** digest bytes; content fingerprints unique |
| `EvidenceDatasetPage` | **0** rows (pages not present despite digests) |
| Roster | 1 stub row per digest (`target` / `unknown` / UNRESOLVED) — **not** a five-player roster |
| Persistent cache (worker events) | shared-evidence `dataset_cache_hit` **13**; fight-details `dataset_fetched` **13** |
| RANKING_PARSE / Performance | Dimension rows SHADOW; finalize status **UNAVAILABLE** (`fact_set_hash_mismatch` / missing fact sets) |
| Survival / Utility / Experience | Same: SHADOW / score **null** / confidence **0** / UNAVAILABLE |
| Per-run cooldown | No `SCORING_V2_RATE_DEFER` observed on successful run (concurrency=1 after fix) |
| `CharacterPublishedScore` | **not mutated** (`publishedMutated: false`) |

### Run 2 — `78df04ce-1440-4cce-af73-2d563549d753`

| Field | Value |
|-------|--------|
| Terminal state | **COMPLETED** (~60s) |
| Discovery providerCalls | **14** (full rediscovery; expected — not digest-gated) |
| Slot matrix | **PARTIAL 13** / **UNAVAILABLE 3** (same missing reasons) |
| Digests | **13** (same count; **no** digest duplication) |
| Source fingerprints vs run 1 | **13/13 overlap** |
| Shared-evidence reuse | worker `dataset_cache_hit` **13** (shared-evidence); fight-details still fetched **13** |
| SHADOW dimensions | again UNAVAILABLE (`fact_set_hash_mismatch`) |
| `CharacterPublishedScore` | **not mutated** |
| Full source recollection | **No** — digest fingerprints stable; shared-evidence served from cache hits; digests not recreated as duplicates |

### Cross-character reuse (narrow)

**Blocked.** Persisted participants are stubs (`name=target`, `realm=unknown`, all `UNRESOLVED`). No safely resolved non-Wallidrixe participant exists to attach a second character without a roster/masterData fix. Broad 16-slot second-character canary was **not** launched.

## Admin diagnostics gap (authorized correction)

Live run 1/2 exposed only discovery `providerCalls` on canary diagnostics. Worker
events (`dataset_fetched` / `dataset_cache_hit`) were used as the reuse proof.

**Code correction (this pass):** slot `providerAccounting` is now persisted on
batch meta and aggregated into `ScoringV2ShadowCanary.diagnostics.providerAccounting`
at finalize (providerCalls, cacheHits, avoidedRequests, singleflightReuse,
pointsConsumed, pages, bytes; plus discovery vs acquisition call split). Admin
`get` also returns per-slot `providerAccounting`.

Run 1/2 rows predate this fix — their diagnostics JSON will not backfill those
fields. Subsequent official canaries will expose them.

## Remaining blockers

1. Shared-evidence **masterData** yields stub roster (`target`/`unknown`) — blocks five-player roster + cross-character mapping.
2. **`EvidenceDatasetPage` not populated** in live canary DB (digest-only persistence observed).
3. Shadow dimensions finalize with **`fact_set_hash_mismatch`** → scores stay null / UNAVAILABLE.
4. RANKING_PARSE / Performance fight-bound evidence still insufficient for scored SHADOW output.
5. `EvidenceDatasetPage` population remains 0 on live digests — page/byte counters from pages stay 0 until page persistence is fixed (digest bytes still measured).

## Flags / publication

All `SCORING_V2_*` and `CALIBRATION_V2_*` flags remain default-off.
`CharacterPublishedScore` must not be mutated by the canary path (verified on both live runs).
V1 public score remains untouched.

## Validation notes

Focused tests: `provider-accounting`, `acquisition.typed-facts`, `finalize-recovery`,
`class-spec-identity`, `persistent-shared-evidence-store` — passed.
Worker + API `tsc --noEmit` and root `pnpm typecheck` after diagnostics fix.
Not pushed.

## Local commits this pass (live defects + diagnostics)

| Commit | Note |
|--------|------|
| `0e3efd7` … `d7a6531` | live path defects (see table above) |
| `8e55666` | persist/expose `providerAccounting` on canary diagnostics |
