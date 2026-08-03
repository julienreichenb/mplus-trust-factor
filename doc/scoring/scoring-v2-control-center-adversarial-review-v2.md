# Scoring V2 Control Center — Adversarial Review (v2)

| Field | Value |
|-------|--------|
| Repository | `julienreichenb/mplus-trust-factor` |
| Review branch | `review/admin-scoring-v2-control-center-v2` |
| Implementation target | `feat/admin-scoring-v2-control-center` |
| Implementation HEAD reviewed | `fc25053` (`fc25053359c18a89f41c8ad82ba1fba3b7338c0d`) |
| Base | `origin/main` |
| Diff scope | `origin/main...HEAD` — 80 files, +15579 / −453 |
| Prior review | `doc/scoring/scoring-v2-control-center-adversarial-review.md` (unaltered) |
| Reviewer posture | Independent; remediation appendix / handoff not trusted; tests accepted only after path inspection |
| Review date | 2026-08-03 |

## Verdict

**FAIL — REMEDIATION REQUIRED**

Most prior BLOCKER/HIGH remediations for Redis permits, artifact digests, export idempotency, sync state, route coverage, and real Redis proof hold under direct inspection. Freeze still packages **live** `EvidenceManifest` / `dimensionComputation` / `scoreSnapshot` rows at freeze time rather than export-time content-addressed evidence refs, so post-export evidence mutation can still change the frozen bundle. That violates the stated freeze/self-containment acceptance criteria and blocks PASS.

---

## Claims matrix (re-check)

| Claim | Result | Notes |
|-------|--------|-------|
| Renewable Redis lane permits | **True** | Heartbeat ~15s; ownership token; fail closed on Redis unusable |
| Logical hash + byte digest binding | **True** | Refs carry both; preflight digests bytes before parse; map resolver refuses wrong-key alias |
| Deterministic/idempotent evidence exports | **True** | Timestamps pinned at create; COMPLETED short-circuit; lease claim |
| Redis fail-closed | **True** | `LANE_REDIS_UNAVAILABLE` before providers |
| Synchronization evidence-based | **True** | `syncState` enum; `synchronized` only when `SYNCHRONIZED` |
| Freeze uses export-time immutable snapshot only | **False** | Snapshot covers model/cohort/season/policies; **evidence still loaded live** |
| Adversarial HTTP route coverage | **True** | 29 inject tests; pass in isolation |
| Real Redis distributed proof | **True (partial checklist)** | 7/7 executed against disposable Redis; some Area-5 scenarios still unit-only |
| Authoritative workload-class reuse | **Mostly true** | DB not overwritten on reuse; pipeline still prefers payload over DB |
| Canonical validation green | **Partial** | lint/typecheck/integration/contract/build/english/abilities green; full `pnpm test` hit IAM seed race once |

---

## Previous findings — re-verification

### B1 — Lane permits expire without renewal while jobs still run

- **Previous finding:** TTL 45s; `renewLanePermit` unused in pipeline.
- **Verification performed:** Traced `refresh-pipeline.ts` acquire → `startLanePermitHeartbeat` (`REFRESH_LANE_RENEW_INTERVAL_MS = 15_000`) → `renewLanePermit` Lua ownership check → `onLost` sets `lanePermitLost` → `assertLanePermitHeld` via `assertNotCancelled` at provider and publication checkpoints → `releaseLanePermit` with token. Confirmed fail-closed path when Redis unusable. Inspected race: loss is cooperative (heartbeat flag), not a Redis re-read on every checkpoint.
- **Result:** **RESOLVED** (with residual note below).
- **Evidence:** `lane-permits.ts` (`REFRESH_LANE_RENEW_INTERVAL_MS`, renew/release Lua); `refresh-pipeline.ts` heartbeat wiring + `pre_publication` / `publication_atomic` checks; unit + Redis integration renew/TTL tests.
- **Residual risk:** Between renew failure and the next checkpoint, in-flight provider/scoring work can continue briefly. Permit loss correctly prevents marking success afterward (`markFailed` + throw). Process crash frees capacity via lease TTL.

### B2 — Manifest logical contentHash does not cryptographically bind packaged durable bytes

- **Previous finding:** Resolver echoed request hash; no durable byte binding.
- **Verification performed:** Inspected `buildCalibrationContentRefV2`, preflight byte digest before parse, logical hash check on parsed manifest, `createMapArtifactResolverV2` computing `sha256(bytes)` and refusing key≠digest. Ran reasoning against `artifact-integrity.test.ts` “valid logical + substituted bytes” case.
- **Result:** **RESOLVED**.
- **Evidence:** `packages/scoring/src/calibration/bundle-v2.ts`, `replay-v2.ts`, `artifact-integrity.test.ts`; freeze persist paths set `logicalContentHash` + `byteDigest`.
- **Residual risk:** Bundles produced before digests fail closed under `requireByteIntegrity` — intentional; rolling deploy must not serve old undigested freeze artifacts as trusted.

### B3 — Evidence export worker is not idempotent; `generatedAt` makes archives non-deterministic

- **Previous finding:** `generatedAt = now` on every run; duplicate delivery diverged.
- **Verification performed:** `createExport` pins `generatedAt` / `evidenceCutoffAt` before enqueue; worker short-circuits `COMPLETED`+archive; claim uses lease owner; retries reuse claimed row timestamps; ZIP uses normalized metadata.
- **Result:** **RESOLVED**.
- **Evidence:** `scoring-v2-evidence-export-service.ts` create path; `scoring-v2-evidence-export.ts` claim/finalize; export worker tests for duplicate delivery / lease.
- **Residual risk:** Two different admin requests (different export IDs) intentionally differ. Concurrent workers racing the same ID: lease + finalize guards aim for one terminal artifact set.

### H1 — Redis lane enforcement fails open when Redis connection cannot be created

- **Previous finding:** Connection error skipped permits.
- **Verification performed:** Pipeline sets `admissionRedis = null` on create/unusable, then fails job with `LANE_REDIS_UNAVAILABLE` before provider phases. No process-local semaphore treated as distributed proof.
- **Result:** **RESOLVED**.
- **Evidence:** `refresh-pipeline.ts` ~764–795; `refresh-admission-enforce.test.ts` “Redis failure cannot fail open”.
- **Residual risk:** None material for fail-open; jobs fail/defer instead of running unbounded.

### H2 — Concurrency DTO hardcodes `synchronized: true`

- **Previous finding:** Always synchronized.
- **Verification performed:** `deriveConcurrencySyncState` / `concurrency-observe.ts` produce `UNKNOWN` / `STALE` / `PARTIALLY_OBSERVED` / `UNSYNCHRONIZED` / `SYNCHRONIZED`; `synchronized === (syncState === "SYNCHRONIZED")`. UI chip mapping denies success tone for non-`SYNCHRONIZED`.
- **Result:** **RESOLVED**.
- **Evidence:** `concurrency-observe.ts` + tests; `scoring-v2-runtime-settings.ts`; `statusChip.ts` / `uiConsistency.test.ts`.
- **Residual risk:** Observation write is best-effort after permit acquire (warn on failure); missing heartbeats correctly yield non-success states, not false sync.

### H3 — Freeze binds to mutable current ACTIVE model / cohort members, not export-time snapshot

- **Previous finding:** Live ACTIVE model + live cohort members at freeze.
- **Verification performed:** Confirmed export persists hash-bound `freezeSnapshot` (model, members, season, policies, timestamps). Freeze parses/verifies snapshot hash and uses snapshot for model/cohort/season/policies. **Also confirmed** freeze still executes:

  - `evidenceManifest.findFirst({ orderBy: frozenAt desc })`
  - `dimensionComputation.findMany(...)`
  - `scoreSnapshot.findFirst(...)` for previous public snapshot
  - optional live `scoreModel.findUnique` when `evaluationModelId` is passed

  Adversarial H3 tests mutate live ACTIVE/cohort only; they do **not** prove evidence immutability after export.
- **Result:** **NOT RESOLVED** (partial remediation only).
- **Evidence:** `scoring-v2-bundle-freeze.ts` lines ~396–573; `freeze-snapshot.ts` schema lacks evidence content refs; freeze tests “uses snapshot active model…” vs live evidence queries.
- **Residual risk:** **Blocking.** Post-export mutation of manifests/fact sets/dimension rows changes freeze packaging while snapshot hash remains valid. Replay of that freeze then embeds the mutated evidence, breaking “export-time freeze” and self-containment claims.

### H4 — Control-center mutation/download routes lack adversarial HTTP tests

- **Previous finding:** No inject coverage for new routes.
- **Verification performed:** `routes.admin-scoring-v2-control-center.test.ts` — 29 tests covering 401/403, read-vs-manage, download gates, freeze blockers, version conflict, pagination bounds, malformed confirm. Isolated run: 29/29 pass. Full `pnpm test` once failed suite setup on IAM `rolePermission.upsert` unique race (harness flake).
- **Result:** **RESOLVED** (coverage present; see validation note).
- **Evidence:** Test file + isolated green run.
- **Residual risk:** Parallel IAM seed race can fail the suite under full workspace load without indicating product auth regressions.

### H5 — Distributed concurrency claims are only proven with in-memory Redis fakes

- **Previous finding:** In-memory Lua fake only.
- **Verification performed:** Executed `lane-permits.redis.integration.test.ts` against real Redis `redis://127.0.0.1:6379` (not skipped): **7 passed**. Covers two clients, atomic race, CAL vs OP isolation, wrong token, TTL reclaim, renew extends lease, release frees capacity.
- **Result:** **RESOLVED** for core distributed permit invariants; checklist incomplete (see new notes).
- **Evidence:** Vitest integration run exit 0, 7/7.
- **Residual risk:** Real Redis suite does not yet cover disconnect/reconnect mid-hold, dynamic limit change without restart, cancellation/failure cleanup end-to-end, or cross-lane same-character exclusion at the Redis layer (character exclusivity relies on job dedupe / winner guard, not lane Redis).

### H6 — Reused refresh jobs can desynchronize `workloadClass` DB vs payload/queue

- **Previous finding:** Producer overwrote DB lane on reuse while payload/queue stayed original.
- **Verification performed:** `queues.ts` no longer updates `workloadClass` on reuse; sets `reusedAcrossWorkloadIntent`. Pipeline still selects `(payload.workloadClass) ?? (job.workloadClass) ?? "OPERATION"` — payload wins if present.
- **Result:** **MOSTLY RESOLVED** — original overwrite bug fixed; authoritative-DB claim incomplete.
- **Evidence:** `queues.ts` reuse branch; `refresh-pipeline.ts` workloadClass resolution.
- **Residual risk:** Stale/mismatched payload vs DB can still drive the wrong lane permit. Prefer DB as sole authority after load, or reject mismatch.

### M1 — History pagination total/items mismatch

- **Previous finding:** `total` counted exports; page could exceed `pageSize` after flatMap.
- **Verification performed:** Unified projection + `paginateUnifiedHistory`; `total = exportTotal + frozenTotal`; page items clamped to `pageSize`.
- **Result:** **RESOLVED**.
- **Evidence:** `scoring-v2-evidence-export-service.ts` `listHistory` / helpers.
- **Residual risk:** Implementation loads `skip + take` export rows from the head each page (admin-scale OK; deep pages are heavier).

### M2 — Frozen bundle content hash ≠ CAS byte hash of persisted JSON

- **Previous finding:** Only logical hash stored.
- **Verification performed:** `frozenBundleByteDigest` column + persistence/DTO fields; migration `20260803190000_scoring_v2_freeze_byte_digest`.
- **Result:** **RESOLVED**.
- **Evidence:** schema + freeze service write path + UI display field.
- **Residual risk:** Clients must use the correct field for CAS fetch vs logical identity.

### M3 — Evidence export abandoned `RUNNING` has no recovery path

- **Previous finding:** Stuck RUNNING forever.
- **Verification performed:** Lease fields + `reclaimStaleEvidenceExports` to `RETRYABLE`; invoked opportunistically when another export job starts. No dedicated sweeper process.
- **Result:** **RESOLVED** with operational residual.
- **Evidence:** migration `20260803180000_…`; worker reclaim helper + tests.
- **Residual risk:** Abandoned RUNNING may sit until another export (or manual action) triggers reclaim. Acceptable if documented to admins; not a silent success path.

### M4 — Archive size / member-count bounds not enforced

- **Previous finding:** No caps.
- **Verification performed:** `EVIDENCE_EXPORT_MAX_MEMBERS` (500), `EVIDENCE_EXPORT_MAX_ARCHIVE_BYTES` (50MiB); enforced before oversized persist; ZIP entry names fixed/safe in builder path.
- **Result:** **RESOLVED**.
- **Evidence:** export worker constants + tests.
- **Residual risk:** Bounds are worker-side; extremely hostile inputs still allocate up to the cap.

### M5 — OpenAPI response schemas are loose for overview/list payloads

- **Previous finding:** `additionalProperties: true` / loose items.
- **Verification performed:** Contract tests pass; `scoring-v2-control-center-schemas.ts` still has **12** `additionalProperties: true` occurrences.
- **Result:** **PARTIALLY RESOLVED** — routes present in snapshot; deep DTO tightness incomplete.
- **Evidence:** schema file count; `tests/contract/provider-and-openapi.test.ts` 10/10.
- **Residual risk:** Response drift can still ship under green contract presence tests.

### M6 — Frontend download uses `window.open`

- **Previous finding:** Cookie-only new tab; no revoke.
- **Verification performed:** Credentialed `fetch` + blob URL; `revokeObjectURL`; download busy flag; fixed download filename from export id (does not trust `Content-Disposition`).
- **Result:** **RESOLVED**.
- **Evidence:** `ScoringV2EvidencePanel.vue` `downloadArchive`.
- **Residual risk:** None material.

### L1 — Tabs incomplete ARIA pattern

- **Previous finding:** Buttons without tablist/arrow keys.
- **Verification performed:** `role="tablist"` / tab keyboard handling tests present.
- **Result:** **RESOLVED**.
- **Evidence:** `AdminScoringV2Page.vue` + page tests.
- **Residual risk:** None material.

### L2 — Replay unit assertion tautological

- **Previous finding:** Weak `typeof` assertion.
- **Verification performed:** Integrity/replay tests assert digest mismatch / logical mismatch / provider-free paths more concretely; freeze tests assert snapshot binding.
- **Result:** **RESOLVED** for the original tautology (broader H3 evidence gap remains above).
- **Evidence:** `artifact-integrity.test.ts`, strengthened freeze tests.
- **Residual risk:** Freeze tests still do not mutate live manifests after export.

---

## New findings

### H7 — Freeze still reads mutable live evidence rows (H3 residual elevated)

- **Severity:** HIGH
- **Affected files:** `apps/api/src/services/scoring-v2-bundle-freeze.ts`
- **Exact failure mode:** After verifying export-time `freezeSnapshot`, assemble still selects latest `EvidenceManifest`, live fact sets via slots, live `dimensionComputation` rows, and latest public `scoreSnapshot`. Snapshot does not pin evidence CAS digests/logical hashes for members.
- **Impact:** Export → mutate evidence → freeze yields a different Calibration Input Bundle than the completed evidence export implied. Violates freeze acceptance criteria §5–§6.
- **Required remediation:** Persist content-addressed evidence refs (or artifact digests) inside `freezeSnapshot` at export completion; freeze must resolve only those immutable artifacts (CAS), not `findFirst` latest rows. Evaluation model must also come from snapshot (or explicit frozen ref), not a live optional id lookup unless content-addressed.
- **Test detects it today?** No. Existing H3 tests do not mutate manifests between export and freeze.

### M7 — Pipeline prefers BullMQ payload `workloadClass` over DB (H6 residual)

- **Severity:** MEDIUM
- **Affected files:** `apps/worker/src/orchestration/refresh-pipeline.ts`
- **Exact failure mode:** `workloadClass = payload ?? job.workloadClass ?? "OPERATION"`.
- **Impact:** Under legacy/mismatched payloads, lane accounting can diverge from authoritative `IngestionJob.workloadClass`.
- **Required remediation:** Load DB row as sole authority; treat payload mismatch as fail/conflict; keep legacy default only when DB null/legacy.

### M8 — Real Redis suite omits several claimed distributed scenarios

- **Severity:** MEDIUM
- **Affected files:** `lane-permits.redis.integration.test.ts`
- **Exact failure mode:** 7 real-Redis tests pass, but do not exercise disconnect/reconnect, dynamic limit changes, cancellation/failure cleanup, or cross-lane same-character exclusion on Redis.
- **Impact:** Residual uncertainty for ops failure modes beyond core acquire/renew/TTL.
- **Required remediation:** Extend real Redis suite; keep character exclusivity proof (DB winner guard / dedupe) explicitly documented if intentionally out of lane Redis.

### L3 — Full `pnpm test` IAM seed unique-constraint flake under parallel load

- **Severity:** LOW
- **Affected files:** `apps/api/src/iam/seed.ts` upsert used by H4 suite `beforeAll`
- **Exact failure mode:** Concurrent `rolePermission.upsert` → unique violation; suite `afterAll` then throws on undefined `app`.
- **Impact:** Canonical `pnpm test` can exit non-zero without product route regressions (isolated H4 run is green).
- **Required remediation:** Make IAM seed concurrency-safe (transaction / ignore-duplicate) or serialize suite setup.

### N1 — Opportunistic export reclaim without dedicated sweeper

- **Severity:** NOTE
- **Notes:** Stale RUNNING → RETRYABLE only when reclaim runs (currently on another export job start). Admins may see stuck RUNNING until then. Accurate exposure preferred in UI copy.

### N2 — Feature flags / publication isolation still hold

- **Severity:** NOTE
- **Notes:** Diff search found no default-true Scoring V2 flags, no export/freeze `CharacterPublishedScore` writes, no model activation, no provider calls from export/freeze workers. Overview remains disabled when master flag is false.

### N3 — Download filename is application-controlled

- **Severity:** NOTE
- **Notes:** Frontend uses `evidence-export-${id}.zip` rather than parsing `Content-Disposition` — safer against header injection / path traversal.

### N4 — Additive remediation migrations

- **Severity:** NOTE
- **Notes:** `20260803180000_scoring_v2_export_determinism` and `20260803190000_scoring_v2_freeze_byte_digest` are additive (new enum value, columns, index). Safe on existing rows; old undigested bundles fail closed at integrity checks. Rolling deploy still needs worker/API order awareness for new statuses/fields.

---

## Area verification summaries

### Redis permit lifecycle

Atomic Lua acquire with unique token; renew ~15s with ownership; release ownership-checked and idempotent; heartbeat stopped on terminal paths; Redis down before acquire → no providers; renew loss → `LANE_PERMIT_LOST` → job failed, not successful; TTL reclaim after crash. No fail-open skip remains.

### Artifact integrity

`logicalContentHash` ≠ `byteDigest` ≠ CAS `contentHash` distinguished; bytes digested independently; resolver does not echo request hash; substituted durable bytes fail preflight; unsupported digest algorithms fail closed.

### Deterministic exports

Pinned timestamps at create; COMPLETED short-circuit; lease claim; deterministic join inputs for same export id.

### Freeze / replay self-containment

Snapshot-bound for model/cohort/season/policies. **Evidence packaging still live-DB-bound → FAIL driver.** Replay helpers themselves are provider-free when given a complete artifact map; the freeze assembler is the weak link.

### Workload class

DB preserved on reuse; queues report cross-intent reuse; pipeline payload preference is residual (M7). Same-character concurrency prevented by refresh dedupe/winner guard, not lane Redis.

### Synchronization

Evidence-based enum; UI does not treat `UNKNOWN` / `PARTIALLY_OBSERVED` as success.

### Route security

Adversarial Fastify inject coverage present for control-center surface; manage-gated download/freeze; no GET mutation observed on audited routes.

### Frontend

Authenticated blob download, 401/403 routing, revoke, download debounce, tab pattern, sync chips — acceptable.

### OpenAPI

Paths present; residual `additionalProperties: true` looseness (M5).

---

## Real Redis tests executed

| Item | Value |
|------|--------|
| Command | `pnpm exec vitest run --config vitest.integration.config.ts apps/worker/src/orchestration/refresh-admission/lane-permits.redis.integration.test.ts` |
| `REDIS_URL` | `redis://127.0.0.1:6379` (isolated local Docker Redis) |
| Result | **7 passed / 7** (0 skipped) |
| Scenarios proven | Multi-client OPERATION limit, atomic race, CAL vs OP isolation, token mismatch renew/release, TTL reclaim, renew extends lease, release frees capacity |

PASS is allowed w.r.t. “suite not skipped”; overall verdict remains FAIL due to H3/H7.

---

## Full validation results

Infrastructure note: disposable Postgres via `DATABASE_URL=postgresql://mplus:mplus@127.0.0.1:5433/...` (IPv4). `localhost:5433` hung on this host (IPv6/`wslrelay`).

| Command | Result |
|---------|--------|
| `pnpm lint` | **PASS** (exit 0) |
| `pnpm typecheck` | **PASS** (exit 0; required prior `prisma generate` + `@mplus/scoring` build on fresh tree) |
| `pnpm test` | **FAIL once** — 254 files passed; `routes.admin-scoring-v2-control-center.test.ts` suite setup IAM unique race; **2027 tests passed**, 33 skipped. **Re-run of H4 file alone: 29/29 PASS** |
| `pnpm test:integration` | **PASS** — 9 files, 24 tests |
| `pnpm test:contract` | **PASS** — 10 tests |
| `pnpm build` | **PASS** |
| `pnpm check:english` | **PASS** |
| `pnpm abilities:validate` | **PASS** (0 errors, 6 pre-existing uncertain-ability warnings) |
| Real Redis H5 suite | **PASS** — 7/7 |
| `pnpm test:raw` | **Not used** |

Diff search (implementation): no default-true V2 activation flags introduced; no export/freeze publication writes; no live provider calls from export/freeze; no `DATABASE_URL` API input; lane Redis fail-open removed.

---

## Required remediation before PASS

1. **H3/H7:** Freeze must consume only export-time pinned evidence artifact refs (CAS). Stop `findFirst`/`findMany` of live manifests/dimensions/snapshots except pure CAS resolution by digest.
2. **H6/M7:** Make `IngestionJob.workloadClass` authoritative in the worker pipeline.
3. **Recommended:** Extend real Redis suite gaps (M8); harden IAM seed for parallel tests (L3); tighten OpenAPI DTOs (M5).

---

## Review process confirmations

- No implementation code modified during this review.
- No push, PR, merge, or deploy.
- No live provider calls.
- No model activation, publication, or feature-flag activation.
- Prior review document and its remediation appendix were not altered.
- Only this review document is intended for commit on the review branch.
