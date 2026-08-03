# Scoring V2 Control Center — Adversarial Review

| Field | Value |
|-------|--------|
| Repository | `julienreichenb/mplus-trust-factor` |
| Review branch | `review/admin-scoring-v2-control-center` |
| Review target | `feat/admin-scoring-v2-control-center` (current `HEAD` of this worktree) |
| Base | `origin/main` |
| Diff scope | `origin/main...HEAD` — 54 files, +9131 / −191 |
| Reviewer posture | Independent; implementation handoff not trusted; tests not accepted as proof without path inspection |
| Review date | 2026-08-03 |

## Verdict

**FAIL — REMEDIATION REQUIRED**

Canonical validation commands pass, feature-flag defaults remain false, and publication/activation paths are not exercised by export/freeze. Distributed concurrency lease handling, manifest byte integrity, evidence-export idempotency, and freeze binding to mutable current state are not safe enough to accept the claimed control-center properties.

---

## Claims matrix

| Claim | Result | Notes |
|-------|--------|-------|
| `/admin/scoring-v2` is a complete Control Center | **Partial** | Five tabs exist; diagnostics preserved; several operational claims fail below |
| Evidence preflight is async and provider-free | **Mostly true** | Dedicated queue/worker; no producers injected; still reads mutable current ACTIVE model/season |
| Evidence artifacts deterministic and downloadable | **False as claimed** | `generatedAt = now` in join; redelivery can diverge; ZIP builder itself is deterministic |
| Bundle freeze creates real `CalibrationInputBundleV2` | **Mostly true** | Uses `@mplus/scoring` builders/preflight; binding/integrity gaps remain |
| Frozen bundles replay without providers | **Mostly true** | Replay path is provider-free when resolver map is complete; freeze-time DB reads are not |
| Identical inputs dedupe by bundle hash | **Partial** | Logical `bundleHash` dedupe exists; CAS stores byte-hash of `JSON.stringify`, not the logical hash |
| CALIBRATION/OPERATION concurrency dynamically configurable | **Partial** | Runtime settings + Redis Lua exist; lease renewal missing; Redis fail-open |
| Redis permits enforce distributed limits | **False under load/failure** | 45s TTL without renew; Redis connect failure skips permits |
| Operation cannot be starved by calibration | **Mostly true when Redis works** | Separate lane counters; not proven under Redis failure |
| Workload class persisted; legacy defaults OPERATION | **True with caveats** | DB default + payload default; reused-job overwrite can desync DB vs payload |
| Calibration bootstrap sets CALIBRATION | **True** | Explicit `workloadClass: "CALIBRATION"` |
| OpenAPI complete | **Partial** | Routes present; several responses loosely typed (`additionalProperties: true`) |
| Canonical validation commands pass | **True** (this environment) | See §Tests executed |
| All Scoring V2 flags remain false | **True** | Diff does not change defaults; overview reports disabled mode |
| No publication / model activation / published-score mutation | **True for export/freeze paths** | Read-only of published snapshots; no writes |

---

## Findings

### B1 — Lane permits expire without renewal while jobs still run

- **Severity:** BLOCKER
- **Affected files:**
  - `apps/worker/src/orchestration/refresh-admission/lane-permits.ts`
  - `apps/worker/src/orchestration/refresh-pipeline.ts`
  - `apps/worker/src/orchestration/refresh-admission/lane-permits.test.ts`
- **Exact failure mode:** Default lease TTL is 45s. Acquire reaps expired leases and frees capacity. `renewLanePermit` is implemented and unit-tested but **never called** from `refresh-pipeline.ts`. Any refresh longer than TTL releases its slot while still executing; another job can acquire and exceed the configured lane limit.
- **Reproduction / reasoning:** Acquire job A with `leaseTtlMs=45000`. Wait >45s without renew. Acquire job B with limit 1 → succeeds after reap. Pipeline never schedules renew.
- **Impact:** Distributed CALIBRATION/OPERATION limits are not enforced for real refresh durations. Operation-protection and calibration caps are illusory under load.
- **Required remediation:** Renew leases on an interval shorter than TTL for the whole pipeline hold; fail closed if renew fails; add integration test for job duration > TTL with two workers / real Redis.
- **Test detects it today?** No. Tests cover renew in isolation and expiry reclaim after crash; none prove pipeline renews during a long job.

### B2 — Manifest logical contentHash does not cryptographically bind packaged durable bytes

- **Severity:** BLOCKER
- **Affected files:**
  - `apps/api/src/services/scoring-v2-bundle-freeze.ts`
  - `packages/scoring/src/calibration/replay-v2.ts` (`createMapArtifactResolverV2`)
  - `packages/scoring/src/calibration/bundle-v2.ts` (`assertResolvable` / preflight)
- **Exact failure mode:** Freeze stores `JSON.stringify(manifest.document)` under the EvidenceManifest **logical** `contentHash` (hash-input schema). `createMapArtifactResolverV2` returns `{ bytes, contentHash: requestedHash }` without verifying `sha256(bytes) === contentHash`. Preflight `HASH_MISMATCH` only compares echoed key equality. Altered durable bytes keyed by the same logical hash pass preflight/replay undetected.
- **Reproduction / reasoning:** Build freeze map with valid logical hash → mutate bytes under that key → `preflightCalibrationBundleV2` / replay still succeed. Document SHA ≠ logical hash is acknowledged by the handoff; the missing verify-on-resolve makes that distinction unsafe.
- **Impact:** Bundle integrity claim fails. Substituted evidence can silently change calibration replay outcomes while preserving refs/hashes.
- **Required remediation:** Either (1) package and reference durable SHA-256 of exact bytes and keep logical hash as a separate field, or (2) verify logical hash by re-deriving it from parsed document and separately store/verify durable byte hash. Resolver must never echo the request hash without computing digests.
- **Test detects it today?** No. Freeze tests assert logical hash equality and missing artifacts; no altered-bytes-under-same-key case.

### B3 — Evidence export worker is not idempotent; `generatedAt` makes archives non-deterministic

- **Severity:** BLOCKER
- **Affected files:**
  - `apps/worker/src/orchestration/scoring-v2-evidence-export.ts`
  - `apps/worker/src/orchestration/scoring-v2/evidence-join.ts`
- **Exact failure mode:** Worker always transitions to `RUNNING` and re-runs join. `runEvidenceJoin` sets `generatedAt` from `new Date()` (unless injected). Duplicate BullMQ delivery / retry after success overwrites archive hashes. ZIP member content therefore changes for identical cohort inputs.
- **Reproduction / reasoning:** Complete an export, re-deliver the same `exportId` job → new `generatedAt` → new summary/preflight/markdown/archive content hashes.
- **Impact:** Claimed deterministic downloadable artifacts and safe retries are false. Downstream freeze eligibility/hashes can flip without data change.
- **Required remediation:** Short-circuit if status is already `COMPLETED` with archive present; pin `generatedAt` to export row timestamps; make progress/summary writes monotonic; add duplicate-delivery test.
- **Test detects it today?** No. ZIP unit tests prove deterministic zip encoding for fixed strings only.

### H1 — Redis lane enforcement fails open when Redis connection cannot be created

- **Severity:** HIGH
- **Affected files:** `apps/worker/src/orchestration/refresh-pipeline.ts`
- **Exact failure mode:** `createRedisConnection()` errors → `admissionRedis = null` → lane permit block skipped; both BullMQ workers still claim up to concurrency 8 each.
- **Impact:** Global lane limits disappear under Redis outage; calibration can saturate operation capacity in practice.
- **Required remediation:** Fail closed (defer/fail job) when lane Redis is unavailable, or require a shared connection that already exists at worker boot.
- **Test detects it today?** No.

### H2 — Concurrency DTO hardcodes `synchronized: true`

- **Severity:** HIGH
- **Affected files:** `apps/api/src/services/scoring-v2-runtime-settings.ts`, overview/concurrency UI consumers
- **Exact failure mode:** `getConcurrencySettings` always returns `synchronized: true` with no Redis/worker/replica proof.
- **Impact:** Admin UI can claim distributed sync while permits are expired, Redis is down, or DB ACTIVE counts disagree with BullMQ/Redis.
- **Required remediation:** Compute sync from Redis counts + worker heartbeat / settings version acknowledgements; return `false` when unprovable.
- **Test detects it today?** No (runtime-settings test does not assert sync semantics).

### H3 — Freeze binds to mutable current ACTIVE model / cohort members, not export-time snapshot

- **Severity:** HIGH
- **Affected files:** `apps/api/src/services/scoring-v2-bundle-freeze.ts`
- **Exact failure mode:** Freeze ignores `exportRow.scoreModelId` and loads `scoreModel.findFirst({ status: "ACTIVE" })`. Members are read from live `calibrationCohort.members`. Cohort revision drift is not re-validated at freeze (only during export worker). Season/catalog/algorithm pins use current constants/registry at freeze time.
- **Impact:** “ACTIVE model changed after export”, “cohort revision changed after export”, and similar adversarial cases can produce a bundle that does not match the completed preflight.
- **Required remediation:** Freeze against immutable export snapshot (model id/config captured at export completion, member revision check, reject drift). Persist frozen model fingerprints from export row.
- **Test detects it today?** No. Tests do not mutate ACTIVE/cohort between export and freeze.

### H4 — Control-center mutation/download routes lack adversarial HTTP tests

- **Severity:** HIGH
- **Affected files:**
  - `apps/api/src/routes/admin-explainability-v2.ts`
  - `apps/api/src/routes.admin-explainability-v2.test.ts` (only legacy manifests/explainability coverage)
- **Exact failure mode:** No route tests for overview/concurrency PUT/evidence-export create/get/download/freeze covering 401/403 read-vs-manage, CSRF/session conventions, optimistic concurrency conflicts, or ZIP auth.
- **Impact:** Permission split (`score.candidate.read` vs `admin.scoring_v2.manage`) is implemented but unverified; regressions can ship green.
- **Required remediation:** Add inject tests for every new route including read-cannot-mutate, manage-required download/freeze, version conflict, malformed IDs, and sanitized errors.
- **Test detects it today?** No for new surface.

### H5 — Distributed concurrency claims are only proven with in-process Redis fakes

- **Severity:** HIGH
- **Affected files:** `apps/worker/src/orchestration/refresh-admission/lane-permits.test.ts`
- **Exact failure mode:** `InMemoryLaneRedis` reimplements Lua locally. No two-worker / real-Redis / latency / crash-after-acquire / cross-lane character race suite.
- **Impact:** Atomicity, multi-replica sharing, and TTL/race behaviour are not evidenced at the fidelity the claims require.
- **Required remediation:** Add Redis-backed integration tests for the scenarios listed in Area 5; reject in-memory-only as distributed proof.
- **Test detects it today?** N/A — gap is absence of required tests.

### H6 — Reused refresh jobs can desynchronize `workloadClass` DB vs payload/queue

- **Severity:** HIGH
- **Affected files:** `apps/worker/src/queues.ts`, `apps/worker/src/orchestration/refresh-pipeline.ts`
- **Exact failure mode:** After `persistAndEnqueue`, producer always `updateMany`s `workloadClass`. On reuse (`enqueued: false`), BullMQ payload/queue remain from the original lane while DB lane flips. Pipeline prefers payload workload class.
- **Impact:** Admin queue counts by `workloadClass` misreport; calibration/operation accounting becomes wrong under concurrent bootstrap + operation traffic.
- **Required remediation:** Do not overwrite workload class on reused jobs; include lane in claim/dedupe policy explicitly; return conflict if lane differs.
- **Test detects it today?** No.

### M1 — History pagination total/items mismatch

- **Severity:** MEDIUM
- **Affected files:** `apps/api/src/services/scoring-v2-evidence-export-service.ts` (`listHistory`)
- **Exact failure mode:** Page fetches N exports then `flatMap`s export + optional frozen_bundle rows; `total` counts exports only. Page can exceed `pageSize` items.
- **Impact:** History UI pagination is wrong once freezes exist.
- **Required remediation:** Paginate a unified history projection or return separate totals and clamp item count.
- **Test detects it today?** No.

### M2 — Frozen bundle content hash ≠ CAS byte hash of persisted JSON

- **Severity:** MEDIUM
- **Affected files:** `apps/api/src/services/scoring-v2-evidence-export-service.ts`
- **Exact failure mode:** `frozenBundleContentHash` stores logical `bundle.bundleHash` (`stableStringify`), while artifact store keys `sha256(JSON.stringify(bundle))`.
- **Impact:** Consumers resolving CAS by the export hash field fail; dedupe by logical hash is OK only because code searches export rows, not CAS.
- **Required remediation:** Persist both logical root hash and durable content hash; document which is which.
- **Test detects it today?** No.

### M3 — Evidence export abandoned `RUNNING` has no recovery path

- **Severity:** MEDIUM
- **Affected files:** `apps/worker/src/orchestration/scoring-v2-evidence-export.ts`, schema/job model
- **Exact failure mode:** Worker crash after `RUNNING` leaves row non-terminal; no sweeper/lease.
- **Impact:** Admin sees stuck exports; manual intervention required.
- **Required remediation:** Stale-RUNNING reclaim with idempotent completion semantics.
- **Test detects it today?** No.

### M4 — Archive size / member-count bounds not enforced

- **Severity:** MEDIUM
- **Affected files:** evidence export worker, `zip-store.ts`
- **Exact failure mode:** No max members/bytes checks before building/persisting ZIP.
- **Impact:** Large cohorts can exhaust worker memory/disk.
- **Required remediation:** Hard caps with terminal `FAILED` + sanitized error.
- **Test detects it today?** No.

### M5 — OpenAPI response schemas are loose for overview/list payloads

- **Severity:** MEDIUM
- **Affected files:** `apps/api/src/routes/scoring-v2-control-center-schemas.ts`
- **Exact failure mode:** Several 200 schemas use `additionalProperties: true` / untyped item objects; contract snapshot grew massively but does not deeply constrain DTOs.
- **Impact:** Silent response drift; weaker client/codegen guarantees.
- **Required remediation:** Align Fastify schemas with `@mplus/contracts` required fields.
- **Test detects it today?** Contract tests pass presence/snapshot only.

### M6 — Frontend download uses `window.open` (no blob revoke path; cookie-only)

- **Severity:** MEDIUM
- **Affected files:** `apps/web/src/components/scoring-v2/ScoringV2EvidencePanel.vue`, `ScoringV2HistoryPanel.vue`
- **Exact failure mode:** Download opens a new tab to the manage-gated GET; no `URL.revokeObjectURL` path (N/A for window.open) and error handling for 401/403 in that tab is browser-native, not app-routed.
- **Impact:** Weaker UX/auth handling versus XHR blob download used elsewhere.
- **Required remediation:** Fetch blob with credentials, route 401/403 like other panels, revoke object URLs.
- **Test detects it today?** No.

### L1 — Tabs are buttons with focus styles but not a full ARIA tablist pattern

- **Severity:** LOW
- **Affected files:** `apps/web/src/pages/AdminScoringV2Page.vue`
- **Exact failure mode:** No `role="tablist"/tab/tabpanel`, no arrow-key navigation.
- **Impact:** Keyboard accessibility incomplete vs WAI-ARIA tabs.
- **Required remediation:** Implement tablist pattern or document as in-page nav.
- **Test detects it today?** No.

### L2 — Replay unit assertion is tautological

- **Severity:** LOW
- **Affected files:** `apps/api/src/services/scoring-v2-bundle-freeze.test.ts`
- **Exact failure mode:** `expect(typeof report.ok === "boolean" || Array.isArray(report.members) || report != null).toBe(true)` accepts almost any value; `providerSpy` is never wired into production code.
- **Impact:** False confidence in replay/provider-free claim from this test.
- **Required remediation:** Assert `providerCalls === 0`, deterministic `contentHash`, and member dimension scores.
- **Test detects it today?** Weak positive only.

### N1 — Provider-free evidence export worker construction looks correct

- **Severity:** NOTE
- **Affected files:** `apps/worker/src/processors.ts`
- **Notes:** Evidence-export Worker is built with prisma/logger/artifacts only (no producers/providers). Export path does not enqueue refresh. Good isolation for Area 2 provider-reachability, modulo freeze/export reading current DB state.

### N2 — Feature flags / publication isolation hold for this diff

- **Severity:** NOTE
- **Affected files:** `packages/config` defaults (unchanged), export/freeze services
- **Notes:** `SCORING_V2_*` and `CALIBRATION_V2_ENABLED` remain default false. Export/freeze do not update `ScoreModel.status`, `CharacterPublishedScore`, or publication flags. Overview labels mode Disabled when master flag is false.

### N3 — Migration defaults look forward-compatible for empty/non-empty DBs

- **Severity:** NOTE
- **Affected files:** `packages/database/prisma/migrations/20260803160000_scoring_v2_control_center/migration.sql`
- **Notes:** `workload_class DEFAULT 'OPERATION'`, runtime settings PK on key, seeded concurrency 4/2. `Provider.INTERNAL` added via `ALTER TYPE ... ADD VALUE` — rolling old workers that cannot deserialize INTERNAL artifact rows need deploy ordering awareness (document). Contract test migrate/seed path applied this migration successfully.

### N4 — Canonical bundle contract is used

- **Severity:** NOTE
- **Affected files:** `apps/api/src/services/scoring-v2-bundle-freeze.ts`, `packages/scoring/src/calibration/bundle-v2.ts`
- **Notes:** Freeze calls `buildCalibrationInputBundleV2` / `preflightCalibrationBundleV2` / replay helpers — not a parallel DTO. Member fields for labels, identity, season, manifests, fact sets, dimension exports, policies, active/evaluation models, previous snapshot, and excluded stubs are present when data exists. Integrity/binding issues above still block acceptance.

---

## Area notes (concise)

### Area 1 — Authorization / API security
Permission split is structurally correct: reads under `score.candidate.read`, mutations/download/freeze under `admin.scoring_v2.manage`. UUID params and pageSize≤50 are schema-bounded. Optimistic concurrency exists for settings. Download resolves via export row → `archiveContentHash` → artifact id (not arbitrary paths). Gaps: missing route tests (H4); GET download under manage is intentional stronger permission.

### Area 2 — Evidence export safety
Provider methods are not reachable from the export worker deps. No refresh enqueue. No Character/EvidenceManifest/published-score writes in the export path. Failures mark `FAILED`. Determinism/idempotency/recovery/bounds fail (B3, M3, M4).

### Area 3 / 4 — Bundle freeze & replay
Canonical V2 contract assembly exists and preflight runs. Logical-vs-durable hash distinction is **not** cryptographically safe (B2). Freeze reads mutable current state (H3). Replay with in-memory map is provider-free; production safety depends on packaging + verify-on-resolve.

### Area 5 — Distributed concurrency
Lane separation and defaults are directionally right; OPERATION reservation via separate counters is sound when Redis works. Lease TTL without renew (B1), Redis fail-open (H1), and in-memory-only tests (H5) reject the distributed claims.

### Area 6 — Admin status accuracy
DB groupBy powers queued/active counts; `synchronized: true` is dishonest (H2); reused-job workload overwrite skews lane counts (H6).

### Area 7 — Frontend
Overview/Evidence/Concurrency/Diagnostics/History exist; 401/403 routing on JSON fetches; freeze confirmation dialog; busy disables; flags messaging says observational. Download/tab a11y gaps (M6, L1).

### Area 8 — Database / migration
Safe OPERATION default; indexes for listing; runtime settings PK; evidence export FKs intentional. No migration rollback test beyond contract migrate-from-empty. INTERNAL enum needs rolling-deploy note.

### Area 9 — OpenAPI / contracts
New routes appear in handlers and snapshot regeneration succeeded in `pnpm test:contract`. Schema strictness incomplete (M5).

### Area 10 — Test quality
Many unit tests pass meaningful checks (freeze blockers, zip determinism for fixed inputs, settings version conflict). Critical risky behaviours are untested or weakly asserted (B1–B3, H1–H6, L2). Process-local Redis fake is insufficient for Area 5.

### Area 11 — Flags / publication
No flag default flips in diff. Export/freeze do not activate models or mutate published scores.

---

## Tests executed

| Command | Result |
|---------|--------|
| `pnpm lint` | PASS |
| `pnpm typecheck` | PASS (after `prisma generate` + workspace build on clean install) |
| `pnpm test` | PASS — 1970 passed, 4 skipped (247 files) |
| `pnpm test:integration` | PASS — 17 passed (8 files) |
| `pnpm test:contract` | PASS — 10 passed (includes migrate applying `20260803160000_scoring_v2_control_center`) |
| `pnpm build` | PASS (after `prisma generate`) |
| `pnpm check:english` | PASS |
| `pnpm abilities:validate` | PASS (0 errors, 6 pre-existing uncertain-ability warnings) |

`pnpm test:raw` was not used.

---

## Required remediation before re-review

1. Renew lane permits for the full hold; fail closed on Redis unavailability; prove with real Redis / multi-worker tests.
2. Cryptographically bind manifest/fact durable bytes to refs (verify digests on resolve); fix logical-vs-CAS hash story for frozen bundles.
3. Make evidence export idempotent and deterministic (`generatedAt` pinned; COMPLETED short-circuit).
4. Freeze from export-time immutable snapshot; reject model/cohort/season drift.
5. Add HTTP adversarial tests for all new control-center routes; stop hardcoding `synchronized: true`.
6. Fix reused-job `workloadClass` overwrite / lane accounting.

Until blockers B1–B3 and high items H1–H6 are addressed, the Control Center must not be treated as production-ready for distributed concurrency or calibration freeze integrity.
`)