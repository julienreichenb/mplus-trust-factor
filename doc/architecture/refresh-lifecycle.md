# Refresh lifecycle

## Programme policy (canonical)

- A published Trust Score is fresh for **7 days** (`SCORE_TTL_SECONDS`, default `604800`).
- Freshness is based on the published snapshot **calculation/publication time** (`ScoreSnapshot.calculatedAt`), not provider TTL.
- A Blizzard Mythic+ rating increase of **50 points or more** since that score also makes it stale.
- Fresh profile/search/account reads are strictly read-only (no refresh job).
- A stale profile returns the **last published** score immediately and may enqueue **exactly one** background refresh.
- Repeated reads while a job exists reuse that job (`REUSE_ACTIVE_JOB`).
- A completed refresh must not be re-armed by another page view while still within the score TTL.
- Provider freshness and score freshness are **distinct**.
- Provider-newer-than-score is a **diagnostic warning only** (does not enqueue).
- Model, catalog, context, adapter, season and contract changes do **not** invalidate an otherwise fresh product score. They are adopted on the next legitimate age/rating/admin refresh.
- Failed refresh keeps the last published snapshot and applies `REFRESH_FAILURE_BACKOFF_SECONDS` (default 1h).
- Manual profile refresh is admin-only. Force refresh (`forceRefresh: true`) requires `profile.refresh.force`; cooldown bypass is separate (`profile.refresh.cooldown_bypass`).

Authority: `packages/config/src/score-refresh-decision.ts`, `apps/api/src/services/character-service.ts`, `packages/config`.

## Decision model

`decideScoreRefresh()` returns one reasoned decision. Callers execute at most one side effect.

| Action | When |
|--------|------|
| `NONE` | Within score TTL (optionally with provider-newer diagnostic) |
| `ENQUEUE` | No score, TTL expired, or Blizzard Mythic+ rating increased by at least 50 |
| `REUSE_ACTIVE_JOB` | QUEUED/ACTIVE job already exists |
| `BACKOFF` | Recent FAILED job within failure backoff (provider/ops failures only) |

`RECALCULATE` remains available to explicit admin/bulk workflows, but profile reads never emit it.

## Public score lifecycle

Provider states remain separate (`CharacterProviderState`).

| State | Coarse profile `refreshStatus` | Notes |
|-------|--------------------------------|-------|
| `NO_SCORE_QUEUED` | `QUEUED` | HTTP 202 when an active job exists / was just enqueued |
| `CALCULATING` | `QUEUED` | Job ACTIVE, no score yet |
| `FRESH` | `FRESH` | Within TTL |
| `GRADE_U` | `FRESH` | Published grade U; eligibility, not missing score |
| `STALE_USABLE` | `STALE` | Last score shown; refresh may be enqueued |
| `REFRESHING` | `REFRESHING` | Last score shown + in-flight job (not STALE) |
| `FAILED_FALLBACK` | `STALE` | Last score shown; backoff |
| `UNAVAILABLE` | `FAILED` | No score after failed/blocked refresh; not a fabricated `QUEUED` |

`QUEUED` / `REFRESHING` require an actual active durable/BullMQ job (or a just-enqueued job). Latest `FAILED` with no active job must render `FAILED` (repairable when bootstrap incomplete via exact resolve `forceRetry`).

Account list uses `AccountTrustScoreStatus`, including `REFRESHING` so polling does not hide a completed score behind a loading-only state.

### Cross-process bootstrap repair / enqueue idempotency

Process-local resolve serialization does not span API replicas. Persistent guarantees:

| Layer | Guarantee |
|-------|-----------|
| Character identity | `@@unique([regionId, realmId, normalizedName])` + upsert → one canonical row; no duplicate shell from concurrent resolve |
| Blizzard ID | App-level collision check → visible `409`; never silent merge |
| Job dedupe key | `IngestionJob.dedupeKey` is `@unique`; stable (non-force) enqueues reuse/collapse on that key |
| Force refresh | Unique `requestedAt` preserves historical `FAILED` rows as separate jobs |
| Active-job collapse | After enqueue, earliest active refresh-character job wins; extras superseded via `supersedeDuplicateRefreshJob` (`REFRESH_SUPERSEDED_DEDUPED`) |
| Queue reconciliation | QUEUED losers: BullMQ `remove` by `queueJobId` then mark FAILED. ACTIVE losers: cooperative cancel (`refresh_superseded_deduped`) — never markFailed while executing |
| Worker terminal guard | Before `markActive` / preflight: refuse already-terminal jobs (incl. SUPERSEDED). After `markActive`: sibling winner check + supersede cancel reason → provider-free refuse |
| Admission cleanup | Collapse releases any admission reservation/slot for losers (idempotent best-effort) |

Duplicate Blizzard profile/keystone calls across replicas are bounded but possible without a distributed lock. Duplicate Character rows or lasting duplicate active refresh jobs are not acceptable.

French UI-facing wording: `REFRESHING` → « Actualisation en cours »; `STALE` → « Données à actualiser ».

## Canonical refresh contract

API profile reads, manual refreshes, account discovery, the worker refresh pipeline, and recalculation must resolve the active refresh contract through one shared helper (`resolveActiveRefreshContract` in `@mplus/worker`).

- Fixture zone defaults are allowed **only** when `PROVIDER_MODE=fixture`.
- `APP_ENV=test` / `NODE_ENV=test` must **not** enable fixture zone defaults when providers are live.
- Prefer passing explicit `zoneId` / `partition` when known.
- **Preflight barrier (worker job start):** before any Blizzard / Raider.IO / WCL call, provider-state mutation, run ingestion, metric write, or WCL budget use, the worker resolves verified season authority + active model + the canonical contract and compares `job.payload.refreshContractHash`. Mismatch → terminal non-retryable `REFRESH_CONTRACT_PREFLIGHT_MISMATCH` (`refresh_contract_preflight_mismatch`), zero provider cost, last published score preserved. Live jobs without a hash fail closed; fixture mode keeps minimum legacy compatibility. The failed contract alone does not stale a current product score or start failure backoff; the next legitimate age/rating/admin refresh enqueues under the current contract.
- **Final publication / TOCTOU barrier:** immediately before score publication, the worker re-resolves the active contract and compares again (`REFRESH_CONTRACT_HASH_MISMATCH`, log barrier `publication_toctou`). This catches contract changes that occur after preflight but before publish. Do not remove or weaken it.
- After a successful refresh: `job.payload.refreshContractHash` must equal the published snapshot hash and `hash(explanation.refreshContract)`. Mismatches fail the job (no silent divergent publish).

## Utility fallback boundary (Agent 07)

Utility fallback / extra WCL evidence collection must run **only inside one legitimate `refresh-character` execution**. It must never enqueue a second top-level character refresh. Agent 07 implements Utility fallback on top of this stable boundary; this hotfix does not change Utility eligibility, confidence, or scoring.

## Config

| Concept | Behaviour |
|---------|-----------|
| Score TTL | `SCORE_TTL_SECONDS` (default 7 days) |
| Rating delta | Blizzard Mythic+ rating increase ≥ 50 since score calculation |
| Provider TTLs | Separate in `packages/config` (Blizzard / WCL / Raider.IO) |
| Dataset `calculated.score_snapshot` | Uses `SCORE_TTL_SECONDS` |
| Failure backoff | `REFRESH_FAILURE_BACKOFF_SECONDS` (default 3600) |
| Manual cooldown | `MANUAL_REFRESH_COOLDOWN_SECONDS` (POST refresh only) |

## Last-known-good

- Public pointer: `CharacterPublishedScore` → immutable `ScoreSnapshot`.
- Soft provider failures merge prior observations (`mergeObservationsWithLastKnownGood`) rather than wiping published skill dims.
- Rejected incomplete candidates stay non-public; published pointer unchanged.

## Force refresh contract (Agent 04)

See [`../contracts/change-requests/03-refresh-lifecycle.md`](../contracts/change-requests/03-refresh-lifecycle.md).
