# Scoring V2 extraction integration review

> **Land status (this worktree):** Applied onto `feat/scoring-v2-feature-lineage` tip `d83ec3c` as a production-shaped commit stack on `integration/scoring-v2-extraction-land`. Combat-digest was omitted; extractors live under `packages/providers/warcraftlogs/src/extractors/`; provider-free probes remain developer tooling only.

**Branch under review:** `integration/scoring-v2-probes` @ `5c9d5a5`  
**Target branch:** `feat/scoring-v2-feature-lineage`  
**Merge-base (local target tip):** `d83ec3c`  
**Review date:** 2026-08-05  
**Scope:** architecture + integration readiness only â€” no merge performed.

## Architecture verdict

**Conditional GO for integration** into `feat/scoring-v2-feature-lineage`, after a
**cleanup consolidation** and a **small set of cherry-picks / squashes**. Do
**not** fast-forward or merge the full 23-commit spike history unchanged.

| Area | Verdict |
|------|---------|
| Canonical ability catalog | **PASS** â€” one `AbilityRule` schema and registry |
| Shared capability evidence acquisition | **PASS as library** â€” not yet wired into scoring-v2 acquisition |
| PostgreSQL artifact persistence | **PASS on local target** â€” pg payloads already present at `d83ec3c`; integration adds pg-preferring page selection |
| Activation projection (Offensive / Survival) | **PASS** â€” catalog-driven; probe counts match expectations |
| Utility / Survival extractors | **PASS as proven extractors**; still living under `probe/` paths |
| Production scoring pipeline wiring | **NOT DONE** (out of scope) â€” acquisition still uses older V2 fact extractors |
| Obsolete combat-digest prototype | **FAIL until removed or quarantined** before production land |
| Probe barrel surface pollution | **WARN** â€” `@mplus/provider-warcraftlogs` re-exports one-fight probes |

**Bottom line:** the branch proves the production-shaped evidence + extraction
stack offline. Land it as **grouped production commits**, keep probe CLIs as
developer tooling, delete or quarantine the combat-digest prototype, then wire
scoring consumers in a later commit on the feature lineage (not this review).

### Target-branch tip note

| Ref | Tip | Meaning |
|-----|-----|---------|
| Local `feat/scoring-v2-feature-lineage` | `d83ec3c` | Includes `ffc7198` / `06d284e` (Postgres payload store) |
| `origin/feat/scoring-v2-feature-lineage` | `6c67559` | **Behind** local by those three commits |

Integration planning below assumes the **local** target tip (`d83ec3c`). If
integrating against origin first, push or cherry-pick the three local lineage
commits onto origin **before** bringing probe work.

---

## Invariants checklist

| Invariant | Result | Evidence |
|-----------|--------|----------|
| One canonical `AbilityRule` schema | **PASS** | `packages/abilities/src/types.ts` |
| One canonical ability registry | **PASS** | `packages/abilities/src/registry.ts`; `canonical-catalog.unification.test.ts` |
| No parallel Offensive/Utility/Survival production catalogs | **PASS** | Offensive candidates under `offensive/*` are **tooling**; runtime rules live in class catalogs |
| One shared capability acquisition per fight/revision/actor set | **PASS (library)** | `acquireCapabilityEvidencePackage`; identity key includes actor + ability filter |
| Evidence identity includes catalog, ability-filter, actor-set, plan, GraphQL | **PASS** | `capabilityEvidenceCompatibilityIdentitySchema` |
| Payloads persisted/verified via PostgreSQL | **PASS** | `pg://` writes via `createArtifactRepository`; verified reads |
| No production dependency on local `cas://` for **new** writes | **PASS** | New persists â†’ `pg://`; FS store is legacy read-only when configured |
| Stale `cas://` records fail closed | **PASS** | `ArtifactLegacyExternalPayloadMissingError`; live path treats as cache miss / incomplete load |
| Scoring consumers receive canonical actions (not raw pages) | **PARTIAL** | Timelines/activations exist; **scoring-v2 acquisition not yet switched** to them |
| Fight identity = `reportCode` + `fightId` + `revision` | **PASS** | Contracts + packages + digests |
| Shared class/spec/role resolution | **PASS** | `findRetailSpecIdentityByBlizzardSpecId` / `normalizeRetailClassSlug` from `@mplus/abilities` |
| No probe modules imported by production orchestration | **PASS** | No `probe/*-one-fight` imports under `orchestration/scoring-v2` (except unrelated live-character probe) |
| Generated diagnostic JSON not tracked as runtime data | **MIXED** | Live `apps/worker/artifacts/` gitignored; `packages/abilities/generated/offensive/*.json` **tracked intentionally** for catalog tooling |

---

## Part A â€” File classification

**Range:** `d83ec3c...5c9d5a5` â€” **121 files**, **23 commits**.

### Counts

| Class | Count |
|-------|------:|
| 1 production runtime | 18 |
| 2 shared contract/schema | 9 |
| 3 canonical ability catalog | 20 |
| 4 persistence/repository | 2 |
| 5 probe or diagnostic tooling | 42 |
| 6 tests/fixtures | 19 |
| 7 generated report/artifact | 6 |
| 8 obsolete prototype code | 5 |

### Production runtime (must land)

- `packages/providers/warcraftlogs/src/evidence/capability/*` (acquire, plan, filter batching, persist, page processor, relevant IDs)
- `packages/providers/warcraftlogs/src/evidence/shared-evidence-pagination.ts` (+ ingest/types updates)
- `packages/providers/warcraftlogs/src/normalize/wcl-event-normalizer.ts`
- `packages/abilities/src/offensive/activation.ts`
- `packages/abilities/src/survival/activation.ts`
- `packages/abilities/src/index.ts`, `match.ts` (exports / resolution)
- `apps/worker/src/orchestration/scoring/persistent-shared-evidence-store.ts` (`selectPreferredEvidencePages`, cas miss handling)

### Shared contracts / schema

- `packages/contracts/src/capability-evidence-v1.ts`
- `packages/contracts/src/utility-action-timeline-v1.ts`
- `packages/contracts/src/survival-action-timeline-v1.ts`
- `packages/contracts/src/combat-digest-v1.ts` â€” **transitional / obsolete-adjacent** (see cleanup)
- `packages/abilities/src/types.ts` (activation metadata on `AbilityRule`)
- `doc/architecture/wcl-capability-evidence-contract.md`

### Canonical ability catalog

- All `packages/abilities/src/catalog/classes/*.ts`, shared consumables/racials, `rule.ts`, `registry.ts`, `classes-matrix.ts`
- Docs under `doc/scoring/abilities/`

### Persistence / repository

- `packages/database/src/repositories/artifact-repository.ts` (`getStorageUris`)
- `packages/database/src/repositories/wcl-source-repository.ts` (`replaceArtifactOnConflict`)

> Note: `RawArtifactPayload` table + `PostgresArtifactStore` already exist on
> local target (`ffc7198` / `06d284e`). **Do not re-cherry-pick those.**

### Probe / diagnostic tooling (keep as tooling, not scoring runtime)

- `apps/worker/src/wcl-*-one-fight-probe.ts`, `wcl-capability-evidence-probe.ts`, audits
- `packages/providers/warcraftlogs/src/probe/{offensive,utility,survival}-one-fight/**`
- `tools/scripts/wcl-probe-*.mjs`, `package.json` probe scripts
- `packages/abilities/src/offensive/{build,coverage,validate,sources,cli}/**`
- `apps/worker/src/utility-one-fight-capability-evidence.ts`, `offensive-one-fight-probe-persist.ts`

**Promotion note:** Survival/Utility **extract** modules under `probe/*/extract*.ts`
are production-quality logic trapped in probe folders. Before or during
integration, **move** them to a non-probe path (e.g. `evidence/extract/` or
`digest/`), keeping CLI probes as thin wrappers.

### Tests / fixtures

- Capability, one-fight, persistence, catalog gap-closure, unification tests
- `packages/providers/warcraftlogs/fixtures/capability-reacquisition-1WKcCz2BnAQmbhfq-f1.json`

### Generated reports (tracked tooling outputs)

- `packages/abilities/generated/offensive/*.json` â€” keep for catalog CI/tooling;
  not runtime scoring input

### Obsolete prototype

- `packages/providers/warcraftlogs/src/digest/combat-digest/**` â€” superseded by
  capability evidence packages + dimension timelines

---

## Part B â€” Contract review

### Introduced / extended contracts

| Contract | Role | Production? |
|----------|------|-------------|
| `CapabilityEvidencePackageV1` | Shared filtered evidence package + compatibility identity | **Yes** |
| `UtilityActionTimelineV1` | Canonical utility actions + completeness | **Yes** (scoring consumer later) |
| `SurvivalActionTimelineV1` + pressure windows | Canonical survival activations + pressure | **Yes** (scoring later; no scores in this branch) |
| `combat-digest-v1` (`RunCombatDigest` / participant digests) | Early multi-participant digest spike | **No â€” obsolete for production path** |
| `AbilityRule` activation fields | Cast/buff/trigger projection metadata | **Yes** |
| Existing `WclRunSourceDigest` / evidence page identity | Unchanged foundation | **Yes** (already on target) |

### Completeness / compatibility metadata

Capability identity includes:

- `catalogVersion`
- `abilityFilterHash`
- `actorSetHash`
- `acquisitionPlanVersion`
- `graphqlQueryVersion`
- `reportCode` / `fightId` / `reportRevision`
- `capabilitySet` / `mode`

Utility and Survival timelines carry capability completeness rows and content
hashes. Forbidden score keys remain enforced on digests.

### Findings (no redesign unless blocker)

| Finding | Severity | Action |
|---------|----------|--------|
| Combat-digest vs capability-package **duplicate â€œshared fight evidenceâ€ concepts** | Medium | Prefer capability package; retire combat-digest before/during land |
| Dimension timelines vs older V2 fact documents still used by acquisition | Medium | Coexistence OK until wiring commit; document single consumer path |
| Probe report JSON shapes (`wcl-*-one-fight-v1`) | Low | Keep probe-only; do not promote as production contracts |
| Version literals are string constants | Low | Fine; bump when semantic break occurs |
| Backward compatibility | Low | Additive contracts; no migration of old timeline rows required yet |

**No contract redesign required for integration.** Cleanup is deletion/quarantine
of combat-digest and eventual acquisition rewiring.

---

## Part C â€” Persistence compatibility

### Already on local target (`d83ec3c`)

- `ffc7198` â€” Postgres `raw_artifact_payloads`, `PostgresArtifactStore`, repository rewrite
- `06d284e` â€” package export repair
- `d83ec3c` â€” worker tsx lockfile sync
- Migration `20260805100000_raw_artifact_payloads`

**Omit these from cherry-picks into local target.**

### Added by integration (keep)

| Commit | Change |
|--------|--------|
| `6798180` | `selectPreferredEvidencePages` (prefer `pg://`), legacy cas miss-as-cache-miss, `replaceArtifactOnConflict`, `getStorageUris` |
| `f887977` | Align offensive probe with artifact repository (tooling) |
| `1404ae0` | Pagination completeness for one-fight / shared acquisition |

### Alignment checks

| Check | Result |
|-------|--------|
| Artifact repository APIs align | **Yes** â€” integration extends `d83ec3c` API (`getStorageUris`) |
| No duplicated pg write path | **Yes** â€” single `createArtifactRepository` â†’ Postgres store |
| Checksum semantics | **Yes** â€” SHA-256 of uncompressed bytes |
| Evidence page selection prefers verified PG payloads | **Yes** after `6798180` |
| Reload after process restart | **Yes** â€” probes prove `providerCallsDuringReload=0` with `storageSchemesRead=pg` |
| Second artifact-store abstraction | **No** â€” FS is legacy read path only |
| Migrations exactly once | **Yes** â€” payload migration only on lineage; integration does not add a second |

### Origin vs local

If the integration target is **origin** (`6c67559`), first land:

1. `ffc7198`
2. `06d284e`
3. `d83ec3c`

Then apply the integration sequence below.

---

## Part D â€” Cleanup audit

| Item | Recommendation |
|------|----------------|
| `digest/combat-digest/**` + barrel export | **Remove before integration** (or quarantine behind test-only import) |
| `combat-digest-v1.ts` contract | **Defer removal** until no references; mark deprecated in same cleanup commit if unused |
| Early spike commits (`35ac219`, `10c6c4f`, `d5c65a0`) | **Omit** from cherry-pick; history is archive |
| `PERSISTED_CAS` / cas-first labels in probes | **Keep as developer tooling** only where asserting legacy miss; production prefers `pg` |
| Live reacquisition scripts / audit CLI | **Keep as developer tooling** |
| Untracked `apps/worker/artifacts/**` | **Already gitignored** â€” do not commit |
| `packages/abilities/generated/offensive/*.json` | **Keep** for catalog tooling/CI |
| Timestamp-only churn in generated offensive reports | **Do not commit** noise |
| `package.json` `wcl:probe:*` scripts | **Keep as developer tooling** |
| Provider barrel exporting `probe/*-one-fight` + combat-digest | **Cleanup before integration** â€” export extractors from non-probe modules only |
| Promote `extract.ts` / `extract-actions.ts` out of `probe/` | **Required cleanup commit** (or first production commit) |
| Older Utility/Survival research probes (`utility-v1*`, `survival-v1*`) | **Defer** â€” pre-existing; not introduced by this branch |
| ADR text still saying cas:// MVP | **Defer doc fix** on lineage (docs lag code) |

---

## Part E â€” Validation results

Environment: `ALLOW_LIVE_PROVIDER_CALLS` cleared. No Warcraft Logs calls.
Compatibility identity confirmed:

- `abilityFilterHash`: `37003bce15ac1660`
- `actorSetHash`: `436b06809434f851` (prior offline package / probe audits)
- `catalog`: `12.0.0/midnight-season-1`

| Check | Result |
|-------|--------|
| `@mplus/abilities` build / typecheck / test | **PASS** (120 passed, 1 skipped) |
| `@mplus/contracts` / `@mplus/database` / `@mplus/provider-warcraftlogs` build + typecheck | **PASS** |
| `@mplus/worker` typecheck | **PASS** (after nested-field typing fix in survival probe) |
| `pnpm abilities:validate` | **PASS** |
| `pnpm catalog:validate:offensive` | **PASS** (0 errors, 1 known Resto Shaman exemption warning) |
| Capability evidence unit tests | **PASS** (17) |
| Offensive / Utility / Survival one-fight unit tests | **PASS** |
| `persistent-shared-evidence-store` unit tests | **PASS** (8) |
| Postgres artifact payload + shared evidence **integration** tests (isolated DB) | **PASS** (13) |
| `pnpm wcl:probe:offensive-one-fight` | **PASS** â€” activations **169**, `storageSchemes=pg`, provider 0/0 |
| `pnpm wcl:probe:utility-one-fight` | **PASS** â€” actions **209**, **COMBAT_RES=1**, `evidenceStorageSchemes=pg`, provider 0/0 |
| `pnpm wcl:probe:survival-one-fight` | **PASS** â€” defensive **118**, recovery **58**, AMS **21**, `storageSchemesRead=pg`, provider 0/0 |
| Scores calculated | **None** |

Review-time fix included in the follow-up commit: TypeScript narrowing for
nested WCL event fields in `apps/worker/src/wcl-survival-one-fight-probe.ts`
(worker typecheck blocker only).

---

## Part F â€” Exact integration plan

### 1. Commits already represented on local target

- `ffc7198` â€” persist WCL artifact payloads in Postgres  
- `06d284e` â€” repair postgres artifact package exports  
- `d83ec3c` â€” synchronize tsx dependency lockfile  
- Prior lineage work: scoring-v2 persistence schema, evidence pages, digests, etc.

### 2. Commits to cherry-pick (prefer squash groups)

Work from `feat/scoring-v2-feature-lineage` @ `d83ec3c`.

**Group P â€” Persistence polish (1 squash commit)**

- `6798180` spike(wcl): treat legacy cas cache missâ€¦  
- Relevant production hunks from `1404ae0` if not already covered by `6798180`  
- Optional tooling-only: `f887977` (may land in Group T instead)

**Group C â€” Canonical catalog + offensive tooling (1â€“2 squash commits)**

- `a5c97fc` feat(catalog): build exhaustive offensive cooldown coverage  
- `4417f60` refactor(catalog): integrate offensive abilities into canonical catalog  
- `2f91132` fix(catalog): restore offensive coverage matrix integration  
- `8a7eda3` fix(catalog): restore coherent offensive tooling  
- `fe1c09c` fix(catalog): close proven utility ability gaps  
- Catalog portions of later AMS/consumable commits (`5c9d5a5` catalog hunks)

**Group E â€” Capability evidence acquisition (1 squash commit)**

- `b6cc143` feat(wcl): add capability-scoped shared evidence acquisition  
- Contracts + docs: capability-evidence-v1, wcl-capability-evidence-contract  
- Fixture: capability-reacquisition JSON (from `8ca82a9` fixture hunks only)

**Group X â€” Extraction + activation projection (1â€“2 squash commits)**

- Offensive: `1e09959`, `98c05fe` (+ needed probe-logic for tests)  
- Utility: `71d7f82`, `3e93fe0`  
- Survival: `f650511`, `bf5890e`, `5c9d5a5`  
- During squash: **move extractors out of `probe/`** into production paths

**Group T â€” Developer probes (optional 1 commit)**

- Worker CLIs + `tools/scripts/wcl-probe-*.mjs` + package scripts  
- Persist helpers used only by probes

### 3. Commits to omit

| Commit | Reason |
|--------|--------|
| `35ac219` | Spike inspection only |
| `10c6c4f` | Spike `--live` diagnostic mode |
| `d5c65a0` | Spike PG round-trip superseded by lineage + later probes |
| `94850d4` | Combat-digest **prototype** â€” obsolete |
| `8ca82a9` as a whole | Live reacquisition / DB mutation event â€” **omit runtime**; keep fixture/docs hunks only if needed |
| `ffc7198` / `06d284e` / `d83ec3c` | Already on local target |

### 4. Commits requiring consolidation

- Catalog chain `a5c97fc`â†’`8a7eda3` (+ `fe1c09c`) â†’ single â€œcanonical catalogâ€ commit  
- Utility/Survival â€œvalidateâ€ then â€œintegrateâ€ pairs â†’ single extract commit each  
- Activation projection fixes should not ship without catalog metadata they depend on  

### 5. Expected conflict files

| File | Why |
|------|-----|
| `packages/database/src/repositories/artifact-repository.ts` | Extended on both sides historically |
| `apps/worker/src/orchestration/scoring/persistent-shared-evidence-store.ts` | pg preference + pagination meta |
| `packages/database/src/repositories/wcl-source-repository.ts` | `replaceArtifactOnConflict` |
| `packages/providers/warcraftlogs/src/index.ts` | Barrel exports |
| `packages/abilities/src/index.ts` / `types.ts` / class catalogs | Large catalog surface |
| `packages/contracts/src/index.ts` | New exports |
| `package.json` | Probe scripts |
| `.gitignore` | Artifact ignore rules |

### 6. Required cleanup commit before (or as first) integration land

Suggested message: `chore(wcl): quarantine combat-digest and promote extractors`

Must:

1. Stop exporting `digest/combat-digest` and one-fight probe CLIs from the
   production barrel (or export only promoted extract APIs).
2. Move Survival/Utility/Offensive **extract + rebuild** helpers out of
   `probe/` into a production module path.
3. Delete or test-quarantine obsolete combat-digest implementation.
4. Ensure no scoring-v2 orchestration imports probe CLIs.
5. Leave `wcl:probe:*` scripts as explicit developer tooling.

### 7. Final validation commands after integration

```powershell
Remove-Item Env:ALLOW_LIVE_PROVIDER_CALLS -ErrorAction SilentlyContinue

pnpm --filter @mplus/abilities build
pnpm --filter @mplus/contracts build
pnpm --filter @mplus/database build
pnpm --filter @mplus/provider-warcraftlogs build
pnpm --filter @mplus/worker run typecheck

pnpm abilities:validate
pnpm catalog:validate:offensive
pnpm --filter @mplus/abilities test

pnpm exec vitest run --config ./vitest.config.ts `
  packages/providers/warcraftlogs/src/evidence/capability `
  packages/providers/warcraftlogs/src/probe/offensive-one-fight `
  packages/providers/warcraftlogs/src/probe/utility-one-fight `
  packages/providers/warcraftlogs/src/probe/survival-one-fight `
  apps/worker/src/orchestration/scoring/persistent-shared-evidence-store.test.ts

node tools/scripts/run-tests-isolated.mjs --seed -- pnpm exec vitest run --config vitest.integration.config.ts `
  packages/database/src/postgres-artifact-payload.integration.test.ts `
  apps/worker/src/orchestration/scoring/postgres-shared-evidence.integration.test.ts

pnpm wcl:probe:offensive-one-fight
pnpm wcl:probe:utility-one-fight
pnpm wcl:probe:survival-one-fight
```

**Expected after land (unchanged):**

- Offensive **169**
- Utility **209** with one combat rez
- Survival AMS **21**
- `storageSchemesRead` / schemes = `pg`
- `providerCallsDuringProbe=0` and `providerCallsDuringReload=0`
- ability filter `37003bce15ac1660`, catalog `12.0.0/midnight-season-1`
- **no scores**

---

## Remaining risks

1. **Acquisition not rewired** â€” production still extracts older Survival/Utility
   V2 facts from shared evidence pages; capability packages are proven but unused
   by the orchestrator.
2. **Extractor path hygiene** â€” leaving production extractors under `probe/`
   invites accidental â€œprobe-onlyâ€ treatment or barrel pollution.
3. **Combat-digest leftover** â€” parallel contract/impl confuses â€œwhich shared
   digest is canonical.â€
4. **Origin lag** â€” integrating against unpushed local lineage tip vs origin can
   drop `ffc7198` if someone resets to origin.
5. **Barkskin upper-bound vs baseline CD** â€” 36 casts exceed naive 60s bound;
   cast-verified and plausible with CDR; not an integration blocker.
6. **Generated offensive JSON** â€” intentional tracking; avoid committing
   timestamp-only regenerations.
7. **Live reacquisition commit** â€” must not be replayed against shared DBs during
   integration.

---

## Recommended production commit sequence (summary)

On `feat/scoring-v2-feature-lineage` @ `d83ec3c`:

1. `fix(wcl): prefer postgres evidence pages and fail closed on stale cas`
2. `feat(catalog): unify offensive cooldowns into canonical AbilityRule registry`
3. `feat(wcl): add capability-scoped shared evidence acquisition`
4. `feat(wcl): extract canonical offensive/utility/survival actions from capability evidence`
5. `chore(wcl): remove combat-digest prototype and narrow provider exports`
6. (optional) `chore(wcl): retain one-fight offline probes as developer tooling`

Do **not** merge `integration/scoring-v2-probes` as a single PR without the
cleanup/squash plan above.
