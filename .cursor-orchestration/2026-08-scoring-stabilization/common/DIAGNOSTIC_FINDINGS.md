# DIAGNOSTIC FINDINGS — Scoring Stabilization

**Date:** 2026-08-10  
**Branch:** `fix/scoring-stabilization`  
**Mode:** Agent 01–03B on branch. Experience **formula/UI** still pending Agent 03C. Agent 04 not started.

Legend for evidence: **OBSERVED** (code/tests), **INFERRED** (strong code path), **NOT YET PROVEN** (needs live character dump).

---

## 0b. Agent 03B — Historical Blizzard character M+ dataset

| Field | Value |
|-------|-------|
| Status | **FIXED IN CODE / READY FOR 03C** |
| Persistence | Reused `PREVIOUS_SEASON_RATING` (no migration) |
| Formula / UI | Unchanged — 03C owns Experience calc |

Cold: Profile Index + Season Details only for missing closed seasons in index.  
Warm (complete terminal evidence): **0** historical Blizzard calls.  
Absent-from-index (after successful index): `CONFIRMED_NO_ACTIVITY`. Index failure: leave retryable.

---

## 0a. Problem 4 status (Agent 03 — Experience)

| Field | Value |
|-------|-------|
| Status | **FIXED IN CODE** — historical acquisition path fixed; **Experience UI bug not claimed fixed** until 03C |
| Not fully accepted until | Agent 03C + human Experience UI gate |
| Agent 04 | **Do not start** until Experience UI gate passes |

### Root cause (confirmed)

Blizzard mythic-keystone **season-details** returns rating under `mythic_rating`. Production only read `current_mythic_rating` (profile-index shape). Successful historical responses were normalized to `rating: null`, then discarded as contradictory when `best_runs` were present. Exact-season RIO fallback does not run on that path → no evidence row → `PREVIOUS_EVIDENCE_UNAVAILABLE`.

### Exact fix

1. Schema + `pickSeasonProfileMythicRating()` prefer `mythic_rating`, fallback `current_mythic_rating`.
2. Live/fixture `getMythicKeystoneSeasonProfile` use that picker.
3. `isExperienceSeasonBindingEnsureComplete`: `NO_USABLE_POLICY` is **not** complete (retryable).
4. Tiny: `standingProvenance.acquisitionReason` ← `diagnostics.previousReason`.

### Provider-call behavior

Cold (no previous rating evidence): ≤1 Blizzard historical season profile (+ existing achievements / optional exact RIO only when already allowed).  
Replay (immutable evidence persisted): **0** Blizzard historical + **0** RIO historical.

---

## 0. Problem 1 status (Agent 02)

| Field | Value |
|-------|-------|
| Status | **FIXED IN CODE** — **MANUALLY UI-VALIDATED** (per chantier handoff) |
| Agent 03 | Started after Problem 1 UI gate |

### Root cause (confirmed)

1. A complete Character shell (level, Blizzard ID, class, spec, role) could exist **without** authoritative current-season Mythic+ evidence.
2. Exact public resolve skipped Blizzard keystone unless `forceRetry` / incomplete shell / UNKNOWN job.
3. Missing season evidence was loaded/evaluated as proven absence → `CHARACTER_NO_CURRENT_SEASON_MYTHIC_SCORE`.
4. Keystone provider failures collapsed to `mythicRating = null`, indistinguishable from confirmed no-score.
5. `bootstrapRepairRequired` stayed `false` for that code, so UI/admin had no repair path.

### Exact fix

1. Typed `CurrentSeasonMythicEvidence`: `HAS_SCORE` | `CONFIRMED_NO_SCORE` | `UNKNOWN`.
2. `shouldRepairCharacterBootstrap`: missing season evidence repairs on **normal** exact resolve (no `forceRetry`).
3. Load path: no season-scoped evidence → `undefined` (UNKNOWN/repairable); tagged `confirmedNoScore` / rating 0 → `null` (confirmed absence); rating > 0 → number.
4. Persist: UNKNOWN writes **no** rating row (preserves prior evidence); CONFIRMED_NO writes season-tagged snapshot `mythicRating: 0` + `confirmedNoScore: true`; HAS_SCORE writes positive tagged snapshot.
5. Keystone throw → `UNKNOWN` (counted provider call), never confirmed no-score.
6. `bootstrapRepairRequired` / conflict repair: true when missing/UNKNOWN; **false** for confirmed `CHARACTER_NO_CURRENT_SEASON_MYTHIC_SCORE`.

### Provider-state semantics

| State | Meaning | Persist | Eligibility |
|-------|---------|---------|-------------|
| HAS_SCORE | Finite current-season rating proved | Season-tagged positive snapshot | Pass (if max level) |
| CONFIRMED_NO_SCORE | Provider succeeded; no rating | Season-tagged 0 + `confirmedNoScore` | `CHARACTER_NO_CURRENT_SEASON_MYTHIC_SCORE`, retryable=false |
| UNKNOWN | Provider failed / unresolved | No rating write | Not `NO_CURRENT…`; 503 / retryable; repair remains possible |

### Provider call bounds

Per exact public resolve: **≤1** keystone acquisition when evidence missing; **0** when evidence already known. No loops. Owned Battle.net path unchanged.

### Tests (acceptance)

- `character-bootstrap-repair.test.ts` — repair without forceRetry; repair flags
- `character-public-bootstrap.keystone-collapse.test.ts` — UNKNOWN vs CONFIRMED_NO
- `refresh-eligibility-gate.test.ts` — missing→UNKNOWN; confirmed absence; UNKNOWN persist no-write
- `smoke-character.test.ts` — complete+missing repairs; complete+evidence reuses
- `character-refresh-eligibility.test.ts` — undefined ≠ null semantics
- Owned discovery + Blizzard provider suites remain green

---

## 1. Executive summary

| # | Problem | Root cause (verdict) | Confidence | Agent status |
|---|---------|----------------------|------------|--------------|
| 1 | Public search → `CHARACTER_NO_CURRENT_SEASON_MYTHIC_SCORE` | Complete shells skipped M+ re-fetch; missing evidence treated as absence; keystone failure→null; repair flag false | **OBSERVED** | **FIXED** / **UI-VALIDATED** |
| 2 | Utility identical “+8” / “contributed 8” | Explainability prints `cappedContribution`; `UTILITY_V2_DOMAIN_CONTRIBUTION_CAP = 8`. Strong dual-domain players saturate both domains (CASE A). `expectedDungeons=8` is unrelated | **OBSERVED** | Out of scope (Agent 02+) |
| 3 | Perf confidence Warlock ≫ Warrior/Shaman | **Lfgmasochist (live):** cooldown coverage already 1.0; low Perf confidence is Phase1 `profile_only` / incomplete dungeon+detailed slots — **not** cooldown. Latent class risk remains: null `specSlug` + ABSENT loadout zeros Warrior/Shaman eligibility (fixtures). Wallidrixe: 16/16 usable, conf 100% | **OBSERVED** (Wallidrixe/Lfgmasochist live) + **OBSERVED** fixtures for null-spec risk; Warrior live **NOT YET PROVEN** | Out of scope |
| 4 | Lfgmasochist Experience “Previous-season evidence unavailable” | Blizzard season-details `mythic_rating` ignored → null rating → contradictory discard → no persist. Secondary: `NO_USABLE_POLICY` was ensure-complete (retry freeze). | **OBSERVED** | **FIXED IN CODE** / **PENDING MANUAL UI** |

**Production invariant:** P/S/U/E calculators and WCL acquisition were not modified.

---

## 2. Reproduction matrix

| Character | Search eligibility | Utility cast stop | Utility CC | Perf cooldown coverage | Perf confidence | Previous rating | Population policy | Experience |
|-----------|--------------------|-------------------|------------|------------------------|-----------------|-----------------|-------------------|------------|
| Wallidrixe (Warlock/Demo) | Owned; mythic 4135 on ownership (**OBSERVED** local) | Utility 62.3 (**OBSERVED**); explainability drivers absent on persisted score | same | **16/16 usable, coverage=1** (**OBSERVED**) | **Perf confidence 100%** (**OBSERVED**) | RIO CONFIRMED_ABSENCE on season-15 (**OBSERVED**) | season-15 policy COMPLETE (**OBSERVED**) | **E=0 available** confirmed absence (**OBSERVED**) |
| Lfgmasochist (Shaman/Ele) | Owned; mythic 3595 (**OBSERVED**) | Utility 69.18 (**OBSERVED**) | same | **15/15 usable, coverage=1** (**OBSERVED**) | **Perf conf ~43%** — causes are Phase1 `profile_only` / incomplete dungeon coverage, **not** cooldown (**OBSERVED**) | No PREVIOUS_SEASON_RATING row (**OBSERVED**) | season-15 policy COMPLETE (**OBSERVED**) | **score null**, `PREVIOUS_EVIDENCE_UNAVAILABLE` (**OBSERVED**) |
| User Warrior | Public search fail if complete+no evidence (**OBSERVED** path) | Cap 8 if strong (**INFERRED**) | Cap 8 if strong (**INFERRED**) | Null-spec risk (**OBSERVED** fixture); live Warrior **NOT YET PROVEN** | Depends on Phase1 + coverage | **NOT YET PROVEN** | Season-level | **NOT YET PROVEN** |
| Fourth representative | Same as public path | Same | Same | Spec/class dependent | Spec/class dependent | **NOT YET PROVEN** | Season-level | **NOT YET PROVEN** |

Provider-free dump (when Character exists locally):

```bash
pnpm scoring:diagnose:stabilization -- --region EU --realm <realm> --character <Name>
```

---

## 3. Root causes

### 3.1 Public search / eligibility

**Agent 01 baseline (faulty) — superseded by Agent 02 for Problem 1.**

**State machine AFTER Agent 02**

| Case | Bootstrap Blizzard on resolve? | Persist season M+ evidence? | Enqueue refresh? | `bootstrapRepairRequired` |
|------|-------------------------------|-----------------------------|------------------|---------------------------|
| Unknown public, HAS_SCORE, max level | Yes (≤1 keystone) | Yes (tagged positive) | Yes if eligible | false after persist |
| Unknown public, CONFIRMED_NO_SCORE | Yes | Yes (tagged 0 + confirmedNoScore) | No | **false** |
| Unknown public, UNKNOWN (provider fail) | Yes | Profile only; **no** rating write | No; 503 retryable | **true** (still repairable) |
| Existing complete + season evidence known | **No** | Reuse | Unchanged | false |
| **Existing complete + missing season evidence** | **Yes (≤1 keystone)** | Per typed result | If HAS_SCORE + eligible | **true** until repaired |
| Incomplete shell | Yes | Per typed result | If eligible | **true** |
| Prior job `UNKNOWN` | Yes | … | … | **true** |
| Owned discovery max-level | Always keystone (unchanged) | Ownership + snapshot | Unchanged | Gate may pass via ownership |

**Why public ≠ owned (still true)**

- Public completeness = profile shell fields only (`characterLacksBootstrapEvidence`).
- Owned discovery always fetches current-season keystone and writes `verified_character_ownership.currentSeasonMythic*`.
- Worker gate remains provider-free and reads only persisted evidence.

**A–E answers AFTER Agent 02**

- **C:** Missing season evidence (`undefined`) is repairable UNKNOWN — **not** confirmed absence (`null` → `CHARACTER_NO_CURRENT_SEASON_MYTHIC_SCORE`).
- **D:** Keystone throw → `UNKNOWN` + counted provider call; never collapsed to confirmed no-score.
- **E:** Repair flags fire for incomplete shell, UNKNOWN job, or **missing** season evidence; confirmed `NO_CURRENT…` does **not** advertise fake repairability.

### 3.2 Utility “+8”

Displayed contribution is `domain.cappedContribution` after:

`uncapped = weightShare × (rawScore − 50)` → clamp to `UTILITY_V2_DOMAIN_CONTRIBUTION_CAP` (8).

With all domains applicable, castStops and strategicCc both exceed uncapped 8 at high curve scores → identical **displayed** 8 with different rates (**CASE A**, by design).

`expectedDungeons: 8` is confidence/reliability coverage only — coincidence of literal 8.

**CASE B** (identical upstream facts across characters) requires live `perCombatHour` / digest hash comparison — not proven from code alone.

### 3.3 Performance confidence Warlock vs Warrior/Shaman

```text
confidence = 0.8×phase1Confidence + 0.2×(usable/selected)   when cooldownWeight>0
```

**Live local matrix (season blizzard-season-17 / Midnight):**

| Character | phase1Confidence | cooldownRunCoverage | Perf confidence | Dominant causes |
|-----------|------------------|---------------------|-----------------|-----------------|
| Wallidrixe | 1.0 | **1.0 (16/16)** | **1.0** | none (limit: difficulty_policy_orchestrator_default) |
| Lfgmasochist | **0.2835** | **1.0 (15/15)** | **0.4268** | `profile_only`, `incomplete_dungeon_coverage`, `incomplete_detailed_slot_coverage`, `difficulty_policy_confidence_reduced` |

**Conclusion for the reported Shaman case:** confidence gap is **Phase 1 evidence completeness**, not missing Shaman catalogue / cooldown usability.

**Latent eligibility risk (fixtures, still real):**

| Class/spec | BASELINE without loadout | Live same-fight validated? |
|------------|--------------------------|----------------------------|
| Warlock Demo | Demonic Tyrant | Yes (primary fixture) |
| Warrior Arms | Colossus Smash (needs specSlug) | Static COVERED only |
| Warrior null spec + ABSENT loadout | **0 eligible** | — |
| Shaman Elemental | Fire Elemental (needs specSlug) | Static COVERED only |
| Shaman null spec + ABSENT loadout | **0 eligible** | — |

Do not “fix” Lfgmasochist by inflating cooldown weights — Phase1 profile/detailed slot coverage is the live driver.
### 3.4 Experience Lfgmasochist — Agent 03

**Live OBSERVED (Agent 01 local DB):** score null / `PREVIOUS_EVIDENCE_UNAVAILABLE`; no `PREVIOUS_SEASON_RATING` row; previous season-15 policy COMPLETE.

**Root cause (Agent 03, OBSERVED in Blizzard types + provider mapping):** season-details field `mythic_rating` was never mapped → finite prior-season activity looked like null rating (+ runs) → not persisted; RIO fallback not eligible for that failure class.

**Secondary (FIXED):** `NO_USABLE_POLICY` no longer counts as ensure-complete.

**Diagnostics (tiny):** `standingProvenance.acquisitionReason` now carries `previousReason`.

**Status:** FIXED IN CODE / PENDING MANUAL UI VALIDATION.
---

## 4. Evidence / code paths

| Finding | Path |
|---------|------|
| Keystone failure → null | `apps/worker/src/orchestration/character-public-bootstrap.ts` (`fetchBlizzardPublicBootstrap` catch) |
| Persist skips null rating | `apps/worker/src/orchestration/refresh-eligibility-gate.ts` `persistRefreshEligibilityEvidence` |
| Gate null when season known | same file `loadCharacterRefreshEligibilitySignals` |
| Repair predicates | `apps/api/src/services/character-bootstrap-repair.ts` |
| Utility cap | `packages/scoring/src/utility/v2/constants.ts` `UTILITY_V2_DOMAIN_CONTRIBUTION_CAP` |
| Cap apply | `packages/scoring/src/utility/v2/compute.ts` |
| Label `{contribution}` | `packages/scoring/src/explainability/adapters/utility.ts` + `label-registry.ts` |
| Perf confidence blend | `packages/scoring/src/performance/phase2/confidence.ts` |
| Eligibility / talents | `packages/scoring/src/performance/phase2/eligibility.ts` |
| Catalogs | `packages/abilities/src/catalog/classes/{warlock,warrior,shaman}.ts` |
| Same-fight party | `packages/abilities` SAME_FIGHT_PARTY (warlock/evoker/monk/druid/dk) |
| Experience policy map | `apps/worker/.../experience-phase1.ts` `mapPreviousEvidenceToPhase1Input` |
| Ensure-complete | `apps/worker/.../experience-season-bootstrap.ts` `isExperienceSeasonBindingEnsureComplete` |
| Experience label | `packages/scoring/src/explainability/label-registry.ts` `previous_evidence_unavailable` |

---

## 5. Unknowns requiring live observation

1. Concrete **non-owned** public-search character reproducing `CHARACTER_NO_CURRENT_SEASON_MYTHIC_SCORE` (owned Wallidrixe/Lfgmasochist do not reproduce problem 1).
2. Utility audit explainability (`capApplied` / uncapped) — current CharacterScores predate or omit ScoreExplainabilityV1 utility drivers locally.
3. User Warrior character: Phase1 vs cooldown breakdown (Lfgmasochist showed Phase1-dominant).
4. ~~Why Lfgmasochist never persisted `PREVIOUS_SEASON_RATING`~~ — answered: `mythic_rating` field drop (Agent 03).
5. Production UI: does Experience null render as “0”?
6. Whether production Midnight previous-season policy is COMPLETE or `NO_USABLE_POLICY` (local season-15 is COMPLETE).

---

## 6. Recommended fix boundaries

### Agent 02 — Eligibility / public search

**DONE** — manually UI-validated. See §0.

### Agent 03 — Experience previous-season acquisition

**DONE IN CODE** — see §0a. **PENDING MANUAL UI VALIDATION.** Do not start Agent 04 until UI gate passes.

Shipped:
- Blizzard season-details `mythic_rating` mapping
- `NO_USABLE_POLICY` ensure-complete correction
- `standingProvenance.acquisitionReason`

### Agent 03b — Utility explainability (optional product; not this chantier agent)

- Prefer surfacing uncapped/capApplied in audit UI; do **not** change `UTILITY_V2_DOMAIN_CONTRIBUTION_CAP` unless product explicitly requests recalibration.

### Agent 04 — Performance confidence

- For Lfgmasochist-like cases: fix **Phase1 profile/detailed dungeon coverage** (why profile_only / 0 detailed dungeons) before touching cooldown catalog.
- Still harden extraction so `specSlug` + loadoutEvidence are present (null-spec Warrior/Shaman remain unusable in fixtures).
- Validate Warrior live with bounded probes.
- Do **not** artificially inflate confidence weights.
- Acceptance: Phase1 coverage causes; null-spec vs known-spec Arms/Elemental fixtures; coverage→confidence formula tests.

### Agent 05 — Experience policy / diagnostics

- Investigate why Lfgmasochist has **no** previous-season rating evidence while Wallidrixe got RIO CONFIRMED_ABSENCE on the same previous season (Blizzard historical miss handling / fallback gate).
- Stop treating `NO_USABLE_POLICY` as ensure-complete when no LKG exists (must retry) — Midnight hole.
- Persist or log `diagnostics.previousReason` into CharacterScore/explainability.
- Ensure UI never paints UNAVAILABLE as score 0.
- Do not change E=0 vs unavailable semantics.
- Clean dual-`isCurrent` season hygiene if present in env under test.

---

## 7. Tests that should become acceptance tests

| Test | File | Status |
|------|------|--------|
| Complete shell + missing season → repair without forceRetry; flags advertise repair | `character-bootstrap-repair.test.ts` | **Agent 02 acceptance** |
| Keystone throw → UNKNOWN (not confirmed no-score); providerCalls counted | `character-public-bootstrap.keystone-collapse.test.ts` | **Agent 02 acceptance** |
| Missing evidence → UNKNOWN; confirmed absence → NO_CURRENT; UNKNOWN persist no-write | `refresh-eligibility-gate.test.ts` | **Agent 02 acceptance** |
| Dual-domain cap=8 with distinct uncapped; expectedDungeons unrelated | `utility-v2.test.ts` | Documents design (later agents) |
| Warlock BASELINE vs Warrior/Shaman null-spec zero eligible; coverage blend | `phase2.test.ts` | Documents asymmetry (later) |
| `NO_USABLE_POLICY` ensure-complete | `experience-agent02-integrity.test.ts` | Freezes bug (later) |
| `MISSING_POPULATION_POLICY` → null not 0; confirmed absence → 0 | `calculate.test.ts` | Semantics lock (later) |

---

## 8. Risks / regression surfaces

- Eligibility repair that always re-hits Blizzard on every public resolve → rate limits / cost.
- Treating keystone failure as “has score” → false enqueue.
- Raising Utility cap → score inflation / calibration break.
- Inflating Perf confidence weights → hides missing cooldown evidence.
- Writing Experience standing without population policy → invalid E scores.
- Mutating immutable historical Experience evidence.
- Collapsing Experience unavailable into E=0 in DTO/UI.

---

## Manual UI validation checklist (human gate — after Agent 02, before Agent 03)

See full checklist in `LATEST_HANDOFF.md`. Summary:

### A. Non-owned character with current-season M+ score
Public search → resolve successfully; must **not** fail with `CHARACTER_NO_CURRENT_SEASON_MYTHIC_SCORE` solely because local season evidence was absent; refresh should enqueue/become available.

### B. Second search of same character
Still works; persisted evidence reused.

### C. Real character with no current-season M+ score
Legitimate `CHARACTER_NO_CURRENT_SEASON_MYTHIC_SCORE` OK; `bootstrapRepairRequired` false.

### D. Owned character
Battle.net-linked path unchanged.

### E. Provider failure
Automated only — do not break production credentials.

**Gate rule:** Problem 1 is **not fully accepted** until this checklist passes. Agent 03 must not start before then.

---

## Manual UI baseline checklist (Agent 01 — historical)

Kept for chantier archive. Agent 01 expected the **faulty** public-search failure modes; Agent 02 reverses those for Problem 1.
