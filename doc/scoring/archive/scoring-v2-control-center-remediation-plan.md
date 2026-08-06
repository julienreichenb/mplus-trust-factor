# Scoring V2 Control Center — Adversarial Remediation Plan

| Field | Value |
|-------|--------|
| Source review | [`doc/scoring/scoring-v2-control-center-adversarial-review.md`](scoring-v2-control-center-adversarial-review.md) |
| Review commit | `bbeb938157ae0a836593722d1382b80f1e254bb7` (review branch); findings apply to `feat/admin-scoring-v2-control-center` |
| Plan date | 2026-08-03 |
| Status | Implementation in progress |

This plan does **not** alter the original adversarial verdict. It records root causes, fixes, invariants, and tests for each finding.

Reproduction notes (Phase 0, pre-code-change):

| ID | Proven by |
|----|-----------|
| B1 | `refresh-pipeline.ts` acquires permits; `renewLanePermit` has **zero** call sites outside unit tests; default TTL 45s |
| H1 | `createRedisConnection()` catch sets `admissionRedis = null` then skips `if (admissionRedis)` permit block |
| B2 | `createMapArtifactResolverV2` returns `{ bytes, contentHash: requestedHash }` without digesting bytes |
| B3 | `evidence-join.ts` `const now = input.now ?? new Date()`; worker always re-enters RUNNING |
| H2 | `getConcurrencySettings` hardcodes `synchronized: true` |
| H3 | Freeze loads `scoreModel.findFirst({ status: "ACTIVE" })` and live `cohort.members` |
| H6 | `queues.ts` `updateMany({ workloadClass })` after enqueue even when `enqueued: false` |

---

## B1 — Renewable Redis lane permits

### Root cause
Acquire stores a job-id → lease-expiry mapping with a fixed 45s TTL. Reap on acquire frees expired leases. Pipeline never renews, so long refreshes lose ownership while still running.

### Affected path
`acquireLanePermit` → refresh pipeline hold → (no renew) → TTL expiry → peer acquire → oversubscription.

### Proposed fix
1. Extend Lua acquire to store `{ token, expiry }` (ownership token = random UUID per acquire).
2. Renew/release require matching token; mismatch → refuse.
3. Pipeline starts a heartbeat timer (interval ≪ TTL, e.g. TTL/3) while lane held.
4. On renew failure / ownership loss: stop provider stages, mark job failed/deferred with typed `LANE_PERMIT_LOST` / `LANE_REDIS_UNAVAILABLE`, release other admission resources, do **not** publish success.
5. Graceful shutdown releases with token; crash relies on TTL.

### New invariants
- No provider-heavy stage without a currently owned, renewable permit.
- Token mismatch cannot renew or release another worker’s permit.
- Release is idempotent for the owning token.
- Capacity count never exceeds configured limit while renewals succeed.

### Test strategy
- Unit: ownership mismatch, renew failure, deleted permit, multiple renewals, idempotent release (fake Redis + fake timers for interval only).
- Integration (real Redis): job > TTL with renewals; two clients share limit; no oversubscription under renew; shutdown release.

### Migration / compatibility
No DB migration. Redis key value format changes from expiry-string to `token:expiry` (or JSON). Old keys expire within 45s; rolling deploy safe.

---

## H1 — Redis failure must fail closed

### Root cause
Connection failure nulls Redis and skips lane enforcement while BullMQ workers still claim concurrency 8.

### Affected path
`refresh-pipeline.ts` try/catch around `createRedisConnection`.

### Proposed fix
- Connection or acquire failure → typed retryable `RefreshAdmissionError` / infrastructure error (`LANE_REDIS_UNAVAILABLE`).
- Do not mark COMPLETED; do not enter Blizzard/WCL/RIO phases.
- Bounded log/metric with reason code only (no URL/credentials).
- No env bypass.

### New invariants
Every refresh that reaches provider phases holds a verified lane permit.

### Test strategy
Mock connection refused, command timeout, Lua failure, disconnect after acquire; assert zero provider calls before permit.

### Migration / compatibility
None. Behaviour change: jobs that previously ran without Redis will now defer/fail until Redis recovers (desired).

---

## B2 — Bind logical hashes to durable bytes

### Root cause
Logical EvidenceManifest `contentHash` keys the resolver map; resolver echoes the requested hash; durable `JSON.stringify` bytes are not independently digested.

### Affected path
Freeze packaging → `createMapArtifactResolverV2` → preflight/replay.

### Proposed fix
1. Extend `CalibrationContentRefV2` (or companion integrity block) with:
   - `logicalContentHash` (domain identity)
   - `byteDigest` (`sha256:` + hex of exact stored bytes)
   - `digestAlgorithm: "sha256"`
2. Resolver computes `sha256(bytes)` and fails closed on mismatch; never trusts declared digest alone.
3. For manifests: verify canonical serialization reproduces logical hash; verify stored bytes reproduce `byteDigest`; revalidate parsed document against logical hash.
4. Apply to fact sets, dimension exports, model/config blobs, catalogs/policies, artifact package entries.
5. Bundle root hash covers both logical identities and byte digests (via refs in members/policies/package).

### New invariants
Substitution, truncation, reordering, or wrong-ID lookup fails before replay. Unsupported digest algorithms fail closed.

### Test strategy
Adversarial unit tests listed in the remediation prompt; update freeze assemble tests.

### Migration / compatibility
Additive schema fields on V2 refs; old bundles without `byteDigest` fail closed under new preflight (`requireByteIntegrity: true` for new freezes). Old readers remain readable if a compatibility mode exists — new freeze always writes digests. Document fail-closed for missing digests on new admin freezes.

---

## B3 — Deterministic and idempotent exports

### Root cause
Worker stamps `generatedAt = now` on every run; no COMPLETED short-circuit; retries rewrite archives.

### Affected path
Export create → worker `runScoringV2EvidenceExportJob` → `runEvidenceJoin`.

### Proposed fix
1. On create: persist `generatedAt`, `evidenceCutoffAt` (and later freeze snapshot) on the export row.
2. Worker: if `COMPLETED` with archive present → no-op return.
3. Worker retries reuse persisted timestamps; never recompute `now` for identity.
4. Canonical JSON + stable ZIP entry order + fixed ZIP timestamps (already store-method) + deterministic markdown.
5. Finalization: optimistic lock (`UPDATE … WHERE status IN ('QUEUED','RUNNING','RETRYABLE') AND attempt = :n`) or unique constraint on terminal artifact-set hash; only one terminal set per export.
6. Concurrent workers: CAS on status transition; loser exits without writing divergent archives.

### New invariants
Same `exportId` → byte-identical archive hash across duplicate deliveries. Separate admin requests may differ.

### Test strategy
Duplicate BullMQ delivery, race finalization, crash before/after upload, deterministic ZIP/markdown hashes.

### Migration / compatibility
New columns: `generated_at`, `evidence_cutoff_at`, `attempt`, `lease_owner`, `lease_expires_at`, `heartbeat_at`, `artifact_set_hash`, optional `freeze_snapshot` JSON. Additive migration.

---

## H2 — Evidence-based synchronization state

### Root cause
API hardcodes `synchronized: true`.

### Proposed fix
Replace boolean with typed enum: `SYNCHRONIZED | PARTIALLY_OBSERVED | STALE | UNSYNCHRONIZED | UNKNOWN`.

Workers write heartbeat/config-observation records (Redis or DB) including settings version + observed concurrency values + timestamp.

API claims `SYNCHRONIZED` only when all observed replicas match current settings version within freshness window and Redis lane state is readable.

### New invariants
UI never shows success styling for `UNKNOWN` / `PARTIALLY_OBSERVED`.

### Test strategy
No heartbeat, stale worker, version skew, all sync, Redis down, disappeared worker, setting change lag.

### Migration / compatibility
Contract field change: `synchronized: boolean` → `syncState` enum (+ keep deprecated boolean derived only if needed). Prefer breaking additive: add `syncState`, derive `synchronized = syncState === 'SYNCHRONIZED'` for one release, then remove boolean in a follow-up if required. For this remediation: replace with enum and update UI.

---

## H3 — Freeze export-time snapshot

### Root cause
Freeze re-queries live ACTIVE model and live cohort members.

### Proposed fix
At export completion, persist immutable `freezeSnapshot` JSON (or content-addressed artifact) containing cohort revision, members/labels, season, active model id/version/full config/fingerprint, optional evaluation model, catalogs/policies/algorithms, evidence cutoff.

Freeze reads **only** this snapshot + content-addressed evidence artifacts by hash. Reject if snapshot missing/corrupt or referenced digests fail.

### New invariants
Post-export mutation of ACTIVE model, cohort members, labels, season flags, catalogs cannot change freeze inputs.

### Test strategy
Mutate each of those between export and freeze; assert freeze still uses snapshot or blocks if snapshot missing.

### Migration / compatibility
Additive `freeze_snapshot` / `freeze_snapshot_content_hash` columns on export row.

---

## H4 — Adversarial HTTP route coverage

### Root cause
Only legacy manifests/explainability route tests exist.

### Proposed fix
Real Fastify inject tests for all nine control-center routes covering authz, validation, conflicts, integrity, sanitized errors, no provider/enqueue.

### Test strategy
As specified in remediation prompt; use real middleware.

---

## H5 — Real Redis distributed tests

### Root cause
In-memory Lua port only.

### Proposed fix
Integration suite with isolated Redis (namespaced keys, cleanup), two clients, races, TTL, renew, fail-closed, lane isolation.

Follow `REDIS_URL` from isolated test runner / local redis; never deployed Redis.

---

## H6 — Workload class reuse consistency

### Root cause
Producer overwrites DB `workloadClass` on reused jobs while queue/payload stay original.

### Proposed fix
**Authoritative value = persisted `IngestionJob.workloadClass` at job creation.**

Reuse policy:
- Existing in-flight job stays in original lane.
- New requester reuses without rewriting `workloadClass`.
- Record cross-intent reuse in metadata/logs.
- Do not migrate lanes on incidental reuse.
- On DB/payload/queue disagreement: fail closed or repair via explicit reconciliation (detect + log + prefer DB, requeue only via atomic explicit op).

### Test strategy
OPERATION↔CALIBRATION reuse, mismatches, legacy payload, duplicate queue presence, races.

---

## M1 — History pagination

Paginate unified history items (or return `exportTotal` + clamp). Stable `createdAt desc, id desc`. Bounds ≤50. Multi-page tests.

## M2 — Logical vs CAS hashes

Persist `frozenBundleContentHash` (logical) and `frozenBundleByteDigest` (CAS). API/UI label correctly. Downloads verify byte digest.

## M3 — Abandoned RUNNING exports

Lease + heartbeat on export jobs; sweeper marks stale RUNNING → `RETRYABLE` or `FAILED` with reason; recovery idempotent.

## M4 — Archive bounds

Hard caps: max members, artifacts, per-artifact bytes, aggregate uncompressed, ZIP bytes. Fail before buffering unbounded memory.

## M5 — OpenAPI schemas

Tighten required fields from contracts; typed errors; ZIP media type; regenerate snapshot.

## M6 — Download handling

Authenticated fetch → blob → object URL; revoke; 401/403 routing; disable double-click.

## L1 — Tabs

Full WAI-ARIA tablist pattern + keyboard nav.

## L2 — Replay assertion

Assert concrete scores/hashes; mutation negative tests; wire provider call counter = 0.

---

## Export lifecycle state machine

States: `QUEUED → RUNNING → COMPLETED | FAILED` (+ `RETRYABLE`, `CANCELLED` optional).

Persist: attempt, lease owner/expiry, heartbeat, deterministic timestamps, error reason, artifact-set hash, completedAt.

Atomic transitions; no progress regression; no terminal→running without explicit retry; one terminal artifact set.

---

## Deployment ordering

1. Migrate DB (additive columns/enums).
2. Deploy workers (fail-closed Redis; renew; export idempotency; workload reuse fix).
3. Deploy API (snapshot freeze; sync state; tightened OpenAPI).
4. Deploy web (download/tabs/sync UI).

Compatible: old API + new DB (ignores new columns); new API + old worker (freeze may block until worker writes snapshots — fail closed). New worker + legacy payloads: default OPERATION.

No destructive migration. No reset.

---

## Checkpoint commits (planned)

1. `docs(scoring-v2): plan adversarial remediation` ← this document  
2. `fix(worker): enforce renewable distributed lane permits`  
3. `fix(calibration): bind frozen artifacts to verified bytes`  
4. `fix(scoring-v2): make evidence export deterministic`  
5. `fix(scoring-v2): freeze export-time configuration snapshot`  
6. `fix(worker): reconcile refresh workload classification`  
7. `fix(api): harden scoring v2 control center routes`  
8. `fix(web): correct control center status and downloads`  
9. `test(scoring-v2): cover distributed and adversarial cases`
