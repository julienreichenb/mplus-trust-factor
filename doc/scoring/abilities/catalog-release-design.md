# Ability catalog release design (Phase 3B — design only)

**Status:** DESIGN ONLY. Do not implement publication, activation, runtime cutover, or Prisma migrations from this document until an explicit Phase 3B.x implementation prompt.

**Authority today:** static TypeScript registry in `@mplus/abilities` (`RETAIL_ABILITY_CATALOG`, `CURRENT_CATALOG_VERSION_ID = 12.0.0/midnight-season-1`, 311 rules). Phase 3A review/draft tables are **not** runtime authority.

**Related:** [`ability-catalog.md`](./ability-catalog.md), [`../operations/model-lifecycle.md`](../../operations/model-lifecycle.md), [`packages/abilities/src/refresh/OPERATOR.md`](../../../packages/abilities/src/refresh/OPERATOR.md), ADR [`0005-raw-artifact-storage.md`](../../adr/0005-raw-artifact-storage.md).

---

## 1. Architecture overview

```text
UNTRUSTED INPUT                    CURATED INPUT                 TRUSTED RUNTIME INPUT
─────────────────                  ─────────────                 ─────────────────────
SimC / Blizzard                    Admin decisions               Compiled AbilityCatalogRelease
PINNED snapshots                   + draft rules/topology        bytes (CAS) + ACTIVE pin
     │                                    │                              │
     ▼                                    ▼                              ▼
AbilityCatalogSourceBaseline      AbilityCatalogReview*          getAbilityCatalog / scoring
(contentHash → RawArtifact)       READY_FOR_PUBLISH_REVIEW       worker/API load by releaseId
                                         │
                                         ▼
                              compile COMPLETE release
                                         │
                                         ▼
                              validate + replay + human confirm
                                         │
                                         ▼
                              atomic ACTIVE activation
                                         │
                                         ▼
                              jobs pin catalogReleaseId
```

**Trust boundary:** raw SimC/Blizzard bytes never enter scoring. Only a compiled, validated, digest-verified release artifact may.

**Non-goals for Phase 3B design:** mutating historical scores, auto-rescoring on publish, generating replacement `catalog/classes/*.ts` as the production path (TS may remain bootstrap/emergency only).

---

## 2. Runtime catalog dependency graph (as of this branch)

### Authority & APIs (`packages/abilities`)

| Symbol | File |
|--------|------|
| `CATALOG_GAME_VERSION`, `CATALOG_SEASON_SLUG`, `CURRENT_CATALOG_VERSION_ID` | `packages/abilities/src/version.ts` |
| `AbilityRule`, `AbilityCatalog` | `packages/abilities/src/types.ts` |
| `RETAIL_ABILITY_CATALOG`, `getAllRegisteredRules`, `getAbilityCatalog`, `getCatalogByVersion`, `resolveAbilityCatalog`, `resolveAbilityRuleBySpellId` | `packages/abilities/src/registry.ts` |
| Admin explorer payload | `packages/abilities/src/admin-query.ts` → `queryAdminAbilityCatalog` |

```text
version.ts ──► CURRENT_CATALOG_VERSION_ID
catalog/classes/*.ts + shared/* ──► getAllRegisteredRules()
        │
        ▼
registry.ts ──► RETAIL_ABILITY_CATALOG / getAbilityCatalog / resolve*
        │
        ├─► packages/providers/warcraftlogs  (capability, digests, utility/survival extractors, probes)
        ├─► packages/scoring                 (Performance/Utility/Survival, cooldown replay, freeze policies)
        ├─► apps/worker                      (refresh-pipeline, build-refresh-contract, acquisition, orchestrator)
        ├─► apps/api                         (admin explorer, bundle freeze gate, shadow canary)
        └─► apps/web                         (AdminAbilityCatalogPage explorer)
```

**Important gap:** `getCatalogByVersion` does **not** archive full multi-class releases. Historical path returns a Warlock-centric fixture (`registry.ts`). A real release system must replace this with load-by-`releaseId` / content digest.

### Naming collision (do not conflate)

| Identity | Meaning |
|----------|---------|
| `abilityCatalogVersion` / `CURRENT_CATALOG_VERSION_ID` | Ability rule registry pin (`12.0.0/midnight-season-1`) |
| Active M+ season `catalogVersion` | Dungeon-pool authority strings under `apps/worker/.../active-mplus-season` |
| Experience cutoffs `catalogVersion` | Numeric elite-cutoff catalog in `packages/database` |

---

## 3. Where catalog identity is persisted today

| Surface | Field / mechanism | Citation |
|---------|-------------------|----------|
| Refresh contract | `abilityCatalogVersion` → stale reason `ABILITY_CATALOG_CHANGED` | `packages/contracts/src/refresh-contract.ts`; stamped in `apps/worker/src/orchestration/build-refresh-contract.ts` |
| ScoreSnapshot | `refreshContractHash` embeds contract (incl. ability catalog) | Prisma `ScoreSnapshot` |
| Capability evidence package | payload `catalogVersion` + compatibility key `catalog:…` | `packages/contracts/src/capability-evidence-v1.ts`; DB index columns (deprecated path) |
| Participant scoring digest | payload `catalogVersion` | `packages/contracts/src/participant-scoring-digest-v1.ts` |
| CharacterRunDigest | **no** top-level catalog release FK; version lives inside nested JSON | Prisma `CharacterRunDigest` |
| ScoringShadowCanary | `catalogVersion`, `catalogSupportState` | Prisma |
| Freeze / evidence export | `abilityCatalogVersions: string[]` must include `CURRENT_CATALOG_VERSION_ID` | `packages/scoring/.../freeze-snapshot.ts`; gate in `apps/api/src/services/scoring-bundle-freeze.ts` |
| Review / baseline | source CAS only — **not** AbilityRule release | `AbilityCatalogSourceBaseline`, review models |

### Historical identity gaps

1. Persisted identity is a **string stamp**, not a FK to an immutable release row.
2. Pre-existing artifacts cannot prove exact rule-bytes beyond that string + code deploy epoch.
3. Nested digests may omit or duplicate stamps inconsistently across dimensions.
4. No activation history for ability catalogs (unlike `ScoreModel`).

---

## 4. Domain entities

### 4.1 `AbilityCatalogRelease` (immutable compiled catalog)

Not a review batch, draft, source baseline, or season.

| Field | Purpose |
|-------|---------|
| `id` | UUID row id (not content identity) |
| `releaseKey` | Human/stable key, e.g. `wow-69299/catalog-v1/a1b2c3d4` |
| `contentDigest` | SHA-256 of canonical compiled artifact bytes |
| `releaseSchemaVersion` | Artifact schema (runtime must support) |
| `status` | See state machine |
| `gameVersion` | Product game version string (context) |
| `wowBuild` | Exact WoW build, e.g. `69299` |
| `seasonSlug` | Season context (not uniqueness) |
| `ruleCount` | Compiled rule count |
| `topologyDigest` | Digest of embedded topology section |
| `artifactId` / CAS URI | Points at RawArtifact payload |
| `sourceBaselineIds` | JSON list of baselines that informed curation |
| `sourceReportDigest` | Optional primary shadow report digest |
| `previousReleaseId` | Predecessor complete release |
| `createdAt` / `createdByUserId` / `notes` | Audit metadata |
| `publishedAt` | Set when first activated (optional denorm) |

**Statuses (align with ScoreModel / ScorePublication conventions):**

| Status | Meaning |
|--------|---------|
| `DRAFT_BUILD` | Compile in progress / incomplete |
| `VALIDATED` | Gates passed; not active |
| `ACTIVE` | Exactly one row (partial unique index) |
| `SUPERSEDED` | Was active; replaced |
| `REJECTED` | Failed gates or abandoned |

Only immutable content + successful validation may reach `VALIDATED` / `ACTIVE`.

### 4.2 `AbilityCatalogReleaseActivation` (recommended)

Mirror need for explicit history (ScoreModel uses status flips; catalog should prefer event rows):

| Field | Purpose |
|-------|---------|
| `id` | UUID |
| `releaseId` | FK |
| `activatedAt` | timestamptz |
| `activatedByUserId` | optional |
| `type` | `PUBLISH` \| `ROLLBACK` |
| `reason` / `notes` | required for rollback |
| `previousReleaseId` | prior ACTIVE |
| `confirmationDigest` | digest admin typed/confirmed |

Release `status` timestamps alone are insufficient for audit/rollback clarity.

### 4.3 Why Phase 3A models are insufficient

| Phase 3A model | Why it cannot be the release |
|----------------|------------------------------|
| `AbilityCatalogReviewBatch` | Shadow report import; incomplete queue; not a complete catalog |
| `AbilityCatalogDraftRule` | Partial/incomplete; `NEEDS_METADATA` allowed |
| `AbilityCatalogSourceBaseline` | External observation identity, not scoring rules |
| Decision events | Admin workflow audit, not runtime resolver input |

---

## 5. Release identity format

**Reject** `12.0.0/midnight-season-1` as sole uniqueness (season/gameVersion are context; curation can produce multiple catalogs for one build).

**Proposed `releaseKey`:**

```text
wow-<wowBuild>/catalog-v<releaseSchemaMajor>/<contentDigestPrefix8>
```

Example:

```text
wow-69299/catalog-v1/a1b2c3d4
```

Rules:

- `wowBuild` required and exact.
- `seasonSlug` / `gameVersion` stored on the row for display and refresh-contract bridging, **not** uniqueness.
- Multiple releases per build allowed (different curation).
- Content identity = full `contentDigest` (64-char SHA-256); prefix is for humans only.
- Row `id` must never be the only identity for pinning/replay.

**Refresh-contract bridging (migration):** temporarily continue stamping a string into `abilityCatalogVersion`, evolving toward:

```text
abilityCatalogVersion = releaseKey
```

or dual fields `abilityCatalogReleaseId` + `abilityCatalogContentDigest` once contracts can bump safely (`ABILITY_CATALOG_CHANGED` already exists).

---

## 6. Compiled release artifact

### Principle

Scoring must **not** reconstruct `AbilityRule` from review tables at analysis time.

```text
ACTIVE previous release (or Bootstrap 0)
+ accepted READY_FOR_PUBLISH_REVIEW drafts
        ↓ compile
canonical AbilityRule[] + topology + manifest
        ↓ canonicalize JSON
contentDigest + RawArtifact (provider INTERNAL)
```

### Format recommendation

| Choice | Decision |
|--------|----------|
| Encoding | UTF-8 JSON, `releaseSchemaVersion: "ability-catalog-release-v1"` |
| Rules | Array of objects matching today's `AbilityRule` fields (`packages/abilities/src/types.ts`) |
| Ordering | Deterministic: `canonicalKey` ascending; bindings sorted by `(spellId, role)` |
| Canonicalization | Stable key order; no undefined; integers as numbers; sorted arrays |
| Hash | SHA-256 of exact UTF-8 bytes (same CAS discipline as review import) |
| Storage | `RawArtifact` + `RawArtifactPayload` (`pg://sha256/<hash>`), `artifactClass = ability_catalog_release` |
| Load | fetch → verify digest → schema check → expose `AbilityCatalog` |

**Why JSON + CAS:** matches ADR 0005 and existing baseline/review durability; keeps scoring consumers on the same TypeScript contract with minimal change (deserialize → `buildCatalog(rules)` shape).

### Artifact sections (logical)

1. `meta` — releaseKey, wowBuild, gameVersion, seasonSlug, schemaVersion, previousReleaseId, digests  
2. `topology` — classes/specs/races/roles/source IDs needed for resolution  
3. `rules` — complete `AbilityRule[]`  
4. `manifest` — curation traceability (not required on hot path; may be adjacent artifact)

---

## 7. Topology versioning

**Recommendation: A — embed topology in every release artifact** (with `topologyDigest` for quick compare).

Reasons:

- Haranir shows topology can change independently of class ability rules.
- Historical replay must not consult today's `classes-matrix.ts` / race table.
- One CAS object = one atomic load for a pinned analysis.

Separate topology artifacts (B) add join complexity without benefit at current scale.

---

## 8. Complete-release construction algorithm

A release is always a **complete** catalog, never a patch file.

```text
base = load(previous ACTIVE release)  // or Bootstrap 0
working = deepClone(base.rules + base.topology)

for each selected READY_FOR_PUBLISH_REVIEW draft included in this candidate:
  NEW_ABILITY_CANDIDATE + ACCEPT     → upsert rule by canonicalKey
  SPELL_BINDING_REVIEW + ACCEPT_* / CUSTOMIZE / KEEP_CURRENT
                                     → replace bindings (and related fields) on matched key
  REMOVAL_REVIEW + CONFIRM_REMOVAL   → apply removal semantics (section 9)
  TOPOLOGY_REVIEW + ACCEPT           → merge topology entry into working.topology

unchanged rules from base remain byte-identical after canonicalize
REJECT / DEFER / NEEDS_METADATA / unresolved queue items → no effect

compile → validate → digest → VALIDATED candidate
```

**Unresolved review items do not block** building a release and do **not** alter semantics. Only explicitly included ready drafts change the next complete artifact. This allows infrastructure work and small first changesets without resolving all 106 queue items.

---

## 9. Removal representation

**Recommendation: B — retain rule with end-build / unavailable metadata** in the compiled artifact for at least one full season of releases, then allow omit in later releases once tooling treats tombstones as reserved keys.

Concrete compiled fields (reuse existing AbilityRule options where possible):

- keep `canonicalKey`
- set `provenance.certainty = "deprecated"` (already on `AbilityProvenance`)
- set `validToBuild` to the build where removal is effective
- resolver: treat as **not available** for analyses whose pinned release has `validToBuild <= analysis build` / explicit unavailable flag

| Concern | Consequence |
|---------|-------------|
| Resolver | Must honor validity; omit-only (A) is simpler but loses reserved-key enforcement |
| Replay | Release N still contains full Icy Veins; N+1 has tombstone |
| UI | Explorer shows deprecated/removed markers from active release |
| Reintroduction | Same `canonicalKey` may be revived by clearing `validToBuild` in a later release; hijacking a different ability with that key is forbidden |

**Never hard-delete** historical release artifacts.

---

## 10. CanonicalKey lifetime

1. Same conceptual ability keeps the same `canonicalKey` across releases.  
2. Spell ID / binding / cooldown changes do **not** mint a new key.  
3. Removed/tombstoned keys remain **reserved** across all historical releases.  
4. Collision check at compile time: key must not collide with any key present in **any** stored release artifact (or a maintained `canonical_key_registry` table derived from them).  
5. Keys must not be derived solely from spell ID (Blizzard reuse).

---

## 11. Bootstrap Release 0

Compile **exactly** from current static registry:

- Source: `getAllRegisteredRules()` / `RETAIL_ABILITY_CATALOG` (`registry.ts`)
- Count: **311**
- Preserve canonical keys, spell IDs, metadata, topology from `classes-matrix.ts` + race tables as embedded topology
- Deterministic digest of canonical JSON
- Status path: `DRAFT_BUILD` → parity gate → `VALIDATED` → (later) `ACTIVE` in test, then production
- `releaseKey` example: `wow-<build-or-unknown>/catalog-v1/<digest8>` with explicit note that build may be `unknown-static` until operator attaches build metadata from first PINNED baseline

**Do not change scoring semantics** during bootstrap. Bootstrap exists so future releases have a complete predecessor.

---

## 12. Validation pipeline

```text
compile
→ structural validation (reuse packages/abilities validation.ts + draft-validation rules)
→ semantic / topology validation
→ resolver smoke (every spell ID → unique primary resolution policy)
→ coverage report (existing coverage.ts)
→ historical invariants (reserved keys, no hijack)
→ shadow replay / impact (section 13)
→ contentDigest verify after CAS write
→ status VALIDATED
```

Blocking structural examples: duplicate keys, invalid spell IDs, invalid class/spec/race, missing provenance on new rules, invalid category/availability, binding duplicates / missing PRIMARY_ACTIVATION, invalid validity ranges.

---

## 13. Release diff model

Machine + human diff vs currently ACTIVE (or Bootstrap 0):

| Code | Meaning |
|------|---------|
| `ADDED_RULE` | |
| `REMOVED_RULE` / `TOMBSTONED_RULE` | |
| `METADATA_CHANGED` | |
| `APPLICABILITY_CHANGED` | class/spec/race |
| `CATEGORY_CHANGED` | |
| `DIMENSION_CHANGED` | |
| `BINDING_CHANGED` | |
| `COOLDOWN_CHANGED` | |
| `CHARGES_CHANGED` | |
| `TOPOLOGY_CHANGED` | |

Each entry: `BEFORE`, `AFTER`, `reviewItemId` / `decisionEventId`, source evidence refs. No opaque “24 rules changed”.

---

## 14. Replay / impact analysis (design)

**Do not rescore production on publish.** Run a shadow replay of a golden corpus under:

- pinned previous release  
- candidate release  

Compare at least:

- ability resolution (spell → rule)  
- cooldown recognition / replay projection (`project-cooldown-replay.ts`)  
- Utility / Survival / Performance evidence where catalog-driven  
- dimension scores and Trust score deltas when those dimensions consume catalog-resolved IDs  

**Proposed metrics:** artifacts replayed; exact matches; changed resolutions; changed dimension scores; changed Trust scores; max/median |delta|; affected class/specs; unresolved errors.

**Delta thresholds:** do **not** invent numeric pass/fail. Human approval required for any non-zero Trust/dimension delta until product policy exists. Blocking automated gate: unresolved resolver errors and catastrophic coverage drop (e.g. class with zero resolvable defensives/interrupts vs baseline).

Boost remains independent unless catalog inputs are proven to feed it.

---

## 15. Golden replay corpus

Minimum before activation in an environment:

- Every Retail class + every spec (from release topology)  
- Tank / healer / DPS  
- Racials  
- Known defensives, interrupts/utility, offensive CDs  
- Multi-ID bindings  
- Pet ownership cases currently modeled  
- Unknown spell IDs (must remain non-fatal / explicit miss)

Prefer persisted real digests/packages already in DB/CAS where privacy allows; supplement with fixtures. Corpus is versioned and referenced by replay run records (design; not implemented).

---

## 16. Publication gates

Candidate cannot become ACTIVE unless:

1. Included drafts are all `READY_FOR_PUBLISH_REVIEW`  
2. Compile succeeds  
3. Validation has zero blocking errors  
4. Diff produced and stored  
5. Replay completed; no unresolved resolver errors  
6. Coverage not catastrophically worse than predecessor  
7. `contentDigest` verified against CAS bytes  
8. Artifact + DB row durable  
9. Human confirms **exact** `releaseKey` + full `contentDigest` (typed confirmation)

---

## 17. Confirmation policy

**Recommendation:** single authorized publisher role, but **typed confirmation** of `releaseKey` + `contentDigest` (and `confirm: true`), mirroring ScoreModel activate’s `confirm: true` (`doc/operations/model-lifecycle.md`) — not a one-click publish.

Optional later: second-person approval. At current team scale, typed digest confirmation + separate `admin.ability_catalog.publish` permission is the simplest robust bar.

---

## 18. Atomic activation

Exactly one ACTIVE release.

```text
BEGIN
  SELECT … FOR UPDATE / partial unique index on (status=ACTIVE)
  assert candidate.status = VALIDATED
  assert candidate.contentDigest matches CAS
  set previous ACTIVE → SUPERSEDED
  set candidate → ACTIVE
  insert AbilityCatalogReleaseActivation (PUBLISH|ROLLBACK)
  writeAuditEvent
COMMIT
```

Constraints:

- Partial unique index: at most one `ACTIVE`  
- Optimistic concurrency: `expectedPreviousActiveId` (same pattern as `ScoreModel` activate in `apps/worker/src/persistence/score-repository.ts`)  
- Never two ACTIVE; never zero ACTIVE after bootstrap cutover (bootstrap ACTIVE required before disabling static fallback)

---

## 19. Runtime loading

**Recommendation: D + C hybrid**

1. Analysis receives explicit `catalogReleaseId` (or contentDigest) in scoring/job context (**pin**).  
2. Process maintains an in-memory cache of loaded releases keyed by id/digest with TTL/LRU.  
3. Active release id cached with short poll / pub-sub invalidation for **new job** defaults only.

**Invariant:** one analysis uses one release start-to-finish. Never reload ACTIVE mid-job.

**Avoid** loading ACTIVE from DB on every spell resolve (hot path). Avoid startup-only load without pin (multi-replica skew).

---

## 20. Job / analysis pinning

When a refresh/score job starts (`apps/worker` orchestration):

1. Resolve default = current ACTIVE release id (or static bootstrap id during Stage 1–2).  
2. Set `catalogReleaseId` + `catalogContentDigest` on job payload / scoring context.  
3. Persist into:
   - refresh contract (extend beyond string when ready)  
   - capability package + participant digest payloads  
   - freeze policies  
   - shadow canary rows  
4. If activation occurs mid-flight, running jobs keep their pin; new jobs use new ACTIVE.

---

## 21. Historical replay & legacy artifacts

**Future artifacts:** must store `catalogReleaseId` + `catalogContentDigest`.

**Legacy policy (recommended):**

| Evidence | Mapping |
|----------|---------|
| Artifact stamps `abilityCatalogVersion === CURRENT_CATALOG_VERSION_ID` **and** created while only static registry existed, **and** Bootstrap 0 digest equals current static parity | Map interpretively to `BOOTSTRAP_RELEASE_0` for tooling |
| Anything else / ambiguous | `LEGACY_CATALOG_IDENTITY_UNKNOWN` — display warning; never silently reinterpret with today’s ACTIVE |

Do not fabricate provenance. Do not rewrite historical rows in place without an explicit migration prompt.

---

## 22. Rollback

Rollback = activate an **existing** immutable previous release (new `AbilityCatalogReleaseActivation` with `type=ROLLBACK`), not mutate/delete the bad release.

- Permission: `admin.ability_catalog.publish`  
- Same atomic activation + typed digest confirmation  
- Jobs already pinned to bad release finish on bad release; operators may RECALCULATE_ONLY later (product decision)  
- Bad release remains `SUPERSEDED` or stays `VALIDATED`/`SUPERSEDED` historically auditable  

---

## 23. Multi-process consistency

API + worker + replicas must load **any** pinned release by id from CAS, not only ACTIVE.

| Mechanism | Role |
|-----------|------|
| Job pin | Analysis consistency |
| Shared CAS + DB | Source of truth |
| Per-process cache | Performance |
| Activation event | Bust “default ACTIVE” cache only |

Failure if pinned artifact missing/corrupt: **fail closed** for that job (no silent ACTIVE fallback).

---

## 24. CAS durability & integrity

Same pattern as Phase 3A baselines (`AbilityCatalogReviewService.persistInternalBytes`, OPERATOR.md):

1. Write payload bytes → contentHash  
2. Insert/upsert RawArtifact + Payload  
3. Commit release row referencing `artifactId` + `contentDigest` in one transaction where possible  
4. On load: verify hash; mismatch → refuse  

**Ordering failures:**

| Failure | Behavior |
|---------|----------|
| CAS write fails | No VALIDATED/ACTIVE transition |
| DB commit fails after CAS | Orphan CAS ok (content-addressed); retry compile/publish |
| ACTIVE artifact corrupt | Refuse new analyses needing ACTIVE; alert; do **not** auto-fallback |

Startup: if ACTIVE cannot load after cutover Stage ≥3, process should refuse readiness for scoring routes/workers (fail closed).

---

## 25. Schema compatibility

- Artifact carries `releaseSchemaVersion`  
- Application declares `SUPPORTED_ABILITY_CATALOG_RELEASE_SCHEMAS`  
- Activation refuses unsupported schemas  
- Deploy order: ship code that understands `vN` **before** activating a `vN` release  

---

## 26. Static → release rollout

| Stage | Behavior |
|-------|----------|
| **3B.1** | Compiler + Bootstrap 0 + parity tooling; static still authoritative |
| **3B.2** | Persist releases + CAS + validation; no activation |
| **3B.3** | Replay/impact; no activation |
| **3B.4** | Explicit job pinning (RELEASE/STATIC); worker loads pin; no ACTIVE lookup |
| **3B.5** | Test-env ACTIVE selection + admin publish/rollback; `ABILITY_CATALOG_RUNTIME_MODE` |
| **3B.6** | Production cutover acceptance + allow explicit `ACTIVE_RELEASE` in production |
| **Post** | Retain static TS as emergency/bootstrap source for rebuilding Release 0 only |

Shadow Stage 2: load Bootstrap 0 beside static; require exact rule/resolution parity before Stage 3.

---

## 27. Bootstrap parity requirements

Exact equivalence where deterministic:

- rule count 311  
- canonical key set  
- every `AbilityRule` field after canonicalize  
- resolution for every spell ID in registry  
- class/spec filtering  
- racial resolution  
- validation report stable subset  
- scoring replay on golden corpus: zero resolution deltas  

Tooling (design): `pnpm ability-catalog:release:parity -- --release-id …` comparing static vs release.

---

## 28. Permissions

| Permission | Scope |
|------------|-------|
| `admin.ability_catalog.read` | Explorer + release inspect (existing READ) |
| `admin.ability_catalog.manage` | Curation / drafts / import (existing MANAGE) |
| **`admin.ability_catalog.publish`** (new) | Compile candidate, validate, replay trigger, activate, rollback |

Publish must not be implied by curation alone.

---

## 29. Audit

Reuse `writeAuditEvent` plus immutable activation rows:

| Event | When |
|-------|------|
| `admin.ability_catalog.release.compile` | Candidate built |
| `admin.ability_catalog.release.validate` | Validation run |
| `admin.ability_catalog.release.replay` | Replay finished |
| `admin.ability_catalog.release.publish_attempt` | Confirmation submitted |
| `admin.ability_catalog.release.publish` | Activation success |
| `admin.ability_catalog.release.publish_failed` | Gate/CAS/DB failure |
| `admin.ability_catalog.release.rollback` | Rollback activation |

---

## 30. Failure-mode table

| Failure | Behavior |
|---------|----------|
| Compile failure | Stay DRAFT_BUILD / no artifact |
| Invalid release | REJECTED or remain DRAFT_BUILD; no ACTIVE |
| Artifact write failure | Abort; no VALIDATED |
| DB success / CAS fail | Should not occur if ordered correctly; if detected, mark unusable |
| CAS success / DB fail | Retry; CAS orphan harmless |
| ACTIVE corrupt/missing | Fail closed; alert; no silent other release |
| Dual publish race | Unique ACTIVE + `expectedPreviousActiveId` → 409 |
| Worker cannot load pin | Fail job; no ACTIVE substitution |
| Rollback during jobs | Running pins unchanged |
| Unknown schema version | Refuse activation / load |
| Partial deploy old code | Old code cannot activate new schema; old code may fail load of new pins → deploy order discipline |

---

## 31. Proposed Prisma models (implementation later — do not create now)

1. `AbilityCatalogRelease` — statuses enum; partial unique ACTIVE; unique `contentDigest`; unique `releaseKey`  
2. `AbilityCatalogReleaseActivation` — history  
3. Optional `AbilityCatalogReleaseChange` or store diff/manifest as CAS artifact referenced by release (`diffArtifactId`, `manifestArtifactId`) to avoid huge JSON columns  

---

## 32. Proposed API endpoints (design only)

Admin-only, state-machine enforced:

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/v1/admin/ability-catalog/releases/compile` | Build candidate from previous + selected ready drafts |
| GET | `/api/v1/admin/ability-catalog/releases` | List |
| GET | `/api/v1/admin/ability-catalog/releases/:id` | Inspect + diff summary |
| POST | `/api/v1/admin/ability-catalog/releases/:id/validate` | Run validation |
| POST | `/api/v1/admin/ability-catalog/releases/:id/replay` | Start/inspect impact |
| POST | `/api/v1/admin/ability-catalog/releases/:id/activate` | Publish (`confirm`, typed digest, `expectedPreviousActiveId`) |
| POST | `/api/v1/admin/ability-catalog/releases/:id/rollback-target` | Activate prior release as rollback |
| GET | `/api/v1/admin/ability-catalog/releases/active` | Active + activation history |

No skipping VALIDATED → ACTIVE without gates.

---

## 33. Operator CLI

| Command | Purpose | Status |
|---------|---------|--------|
| `pnpm ability-catalog:release:bootstrap` | Build Release 0 from static registry; validate; parity | **3B.1 implemented** |
| `ability-catalog:release:parity` | Static ↔ release equivalence (standalone) | Design; covered by bootstrap in 3B.1 |
| `ability-catalog:release:verify` | Load ACTIVE/id, verify CAS digest | Later |
| `ability-catalog:release:inspect` | Print meta/diff | Later |
| `ability-catalog:release:activate` | Emergency activate/rollback with audit (still confirm flags) | Later |

### 3B.1 / 3B.2 Bootstrap commands (implemented)

```
pnpm ability-catalog:release:bootstrap
pnpm ability-catalog:release:bootstrap -- --out <artifact.json> --report-out <parity.json> [--json]
pnpm ability-catalog:release:bootstrap -- --persist [--json]
pnpm ability-catalog:release:verify -- --release-id <uuid> [--json]
```

**THIS DOES NOT PUBLISH OR ACTIVATE THE CATALOG.** Static `RETAIL_ABILITY_CATALOG` remains runtime authority.

**CAS durability decision:** persisted bytes are the semantic `AbilityCatalogReleaseContent` (`stableStringify`); `generatedAt` is DB-only. Therefore `casContentHash === contentDigest`.

---

## 34. First small release example (hypothetical)

```text
Bootstrap Release 0 (311 rules, parity-proven)
+ Vampiric Embrace ACCEPT (READY_FOR_PUBLISH_REVIEW)
+ Haranir topology ACCEPT
+ all other review items unresolved → unchanged
        ↓
Complete Release 1 (312 rules or 311+tombstones as applicable, topology includes haranir)
```

This proves incremental curation + complete artifact output. **Does not assert** those items are accepted in DB today.

---

## 35. Admin publish UX (design only)

Release candidate page: identity, digest, build, rule count, diff list, validation, replay metrics, typed confirmation, activate. Rollback is a separate explicit flow. No mass-accept of review items.

---

## 36. Source baseline vs catalog release

| Concept | Question answered |
|---------|-------------------|
| Source baseline | What external data did we observe? |
| Catalog release | What exact rules did scoring use? |

Relationship: release row may reference many `sourceBaselineIds` + report digests; never collapse concepts.

---

## 37. Implementation slices

| Slice | Deliverable | Cutover? |
|-------|-------------|----------|
| **3B.1** | Compiler + Bootstrap 0 + parity CLI | No |
| **3B.2** | Prisma release tables + CAS persist + validation | No activation |
| **3B.3** | Diff + replay/impact harness + corpus | No activation |
| **3B.4** | Activation transaction + job pinning + artifact stamps (test env) | Test only |
| **3B.5** | Admin publish/rollback UX + `publish` permission | Test only |
| **3B.6** | Production cutover after parity/replay acceptance | Yes |

---

## 38. Architectural blockers found

1. **Incomplete historical `getCatalogByVersion`** — cannot support true replay without release CAS.  
2. **String-only stamps** — insufficient for byte-exact historical identity.  
3. **Nested digests without top-level release FK** — migration/design needed for `CharacterRunDigest` and related.  
4. **Refresh contract bump** — adding release id/digest is a deliberate contract change (`ABILITY_CATALOG_CHANGED`).  
5. **Multi-replica ACTIVE cache** — requires pin-by-id load path before cutover.  
6. **Human curation** — publication infra must not wait for all 106 items; first real production release still needs explicit ready drafts + gates.

---

## 39. READY TO IMPLEMENT PHASE 3B.1

**YES** — Bootstrap compiler + parity tooling against static `RETAIL_ABILITY_CATALOG`, with **no** runtime cutover, **no** activation, **no** production AbilityRule file rewrites as the authority path.
