# DIAGNOSTIC FINDINGS — Scoring Stabilization Agent 01

**Date:** 2026-08-10  
**Branch:** `fix/scoring-stabilization`  
**Mode:** Diagnostic only — no scoring behavior changes.

Legend for evidence: **OBSERVED** (code/tests), **INFERRED** (strong code path), **NOT YET PROVEN** (needs live character dump).

---

## 1. Executive summary

| # | Problem | Root cause (verdict) | Confidence |
|---|---------|----------------------|------------|
| 1 | Public search → `CHARACTER_NO_CURRENT_SEASON_MYTHIC_SCORE` | Complete Character shells skip Blizzard M+ re-fetch; missing season-scoped evidence is treated as proven absence; keystone failures collapse to `mythicRating=null`; `bootstrapRepairRequired=false` by design for this code | **OBSERVED** |
| 2 | Utility identical “+8” / “contributed 8” | Explainability prints `cappedContribution`; `UTILITY_V2_DOMAIN_CONTRIBUTION_CAP = 8`. Strong dual-domain players saturate both domains (CASE A). `expectedDungeons=8` is unrelated | **OBSERVED** |
| 3 | Perf confidence Warlock ≫ Warrior/Shaman | **Lfgmasochist (live):** cooldown coverage already 1.0; low Perf confidence is Phase1 `profile_only` / incomplete dungeon+detailed slots — **not** cooldown. Latent class risk remains: null `specSlug` + ABSENT loadout zeros Warrior/Shaman eligibility (fixtures). Wallidrixe: 16/16 usable, conf 100% | **OBSERVED** (Wallidrixe/Lfgmasochist live) + **OBSERVED** fixtures for null-spec risk; Warrior live **NOT YET PROVEN** |
| 4 | Lfgmasochist Experience “Previous-season evidence unavailable” | **Live:** `experience: null`, reason `PREVIOUS_EVIDENCE_UNAVAILABLE`; **no** `PREVIOUS_SEASON_RATING` evidence row. Previous TWW season-15 **has COMPLETE population policy** locally — so this instance is **not** `MISSING_POPULATION_POLICY`. Still a real integrity bug: `NO_USABLE_POLICY` is treated as ensure-complete (Midnight hole risk). User fact (played TWW) conflicts with Wallidrixe-style RIO CONFIRMED_ABSENCE path; Lfgmasochist never persisted a previous rating | **OBSERVED** (Lfgmasochist score + evidence) / **OBSERVED** (ensure-complete code bug) |

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

**State machine**

| Case | Bootstrap Blizzard on resolve? | Persist season M+ evidence? | Enqueue refresh? | `bootstrapRepairRequired` |
|------|-------------------------------|-----------------------------|------------------|---------------------------|
| Unknown public, rating>0, max level | Yes | Yes if rating≠null | Yes if eligible | false |
| Unknown public, rating null/0 | Yes | No if null | No (READY) | false |
| Existing complete + published score | No | No | No on resolve | false |
| **Existing complete + no authoritative-season M+ evidence, !forceRetry** | **No** | **No** | **No / 409 on refresh** | **false** |
| Same + `forceRetry` | Yes if missing season evidence | If rating≠null | If eligible | depends |
| Incomplete shell | Yes | If rating≠null | If eligible | **true** |
| Prior job `UNKNOWN` | Yes | … | … | **true** |
| Owned discovery max-level | Always keystone | Ownership + snapshot if rating | Auto if rating≥1000 | Gate may pass via ownership |

**Why public ≠ owned**

- Public completeness = profile shell fields only (`characterLacksBootstrapEvidence`).
- Owned discovery always fetches current-season keystone and writes `verified_character_ownership.currentSeasonMythic*`.
- Worker gate is provider-free and reads only persisted evidence.

**A–E answers**

- **C:** Missing season evidence ≠ incomplete bootstrap. Season known + no evidence → `currentSeasonMythicScore: null` → `CHARACTER_NO_CURRENT_SEASON_MYTHIC_SCORE`. Incomplete level → `UNKNOWN` + repair true.
- **D:** Yes — keystone throw → `mythicRating=null`, same as successful no-rating. Failed keystone also undercounts `providerCalls` (stays 1).
- **E:** `isBootstrapRepairRequired` / `eligibilityConflictNeedsBootstrapRepair` only fire for incomplete shell or `UNKNOWN`, never for `NO_CURRENT_SEASON_MYTHIC_SCORE`.

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
### 3.4 Experience Lfgmasochist

**Live OBSERVED (local DB):**

- CharacterScore on Midnight `blizzard-season-17`: `experience: null`, `available: false`, `reason: PREVIOUS_EVIDENCE_UNAVAILABLE`, cause `previous_evidence_unavailable`.
- **No** `PREVIOUS_SEASON_RATING` evidence row for Lfgmasochist (only elite absence on current season).
- Canonical previous TWW `blizzard-season-15` has `providerSeasonId=season-tww-3` and population policy **COMPLETE** — so this instance is **not** explained by missing policy on the previous season.
- Contrast Wallidrixe: previous rating evidence `CONFIRMED_ABSENCE` via `RAIDERIO_FALLBACK` → calculator E=0 available.

**Still a real code integrity bug (Midnight-era risk):** `isExperienceSeasonBindingEnsureComplete` returns true for `policySync.status === "NO_USABLE_POLICY"`, freezing retries when policy never lands. That path yields `MISSING_POPULATION_POLICY` when rating HAS_VALUE but policy absent — different from Lfgmasochist's current local row.

**Likely Lfgmasochist immediate causes (ranked):**

1. Previous-season rating never successfully persisted (Blizzard historical + RIO fallback both failed or skipped) → UNAVAILABLE without diagnostics (**OBSERVED** missing evidence row).
2. Dual `isCurrent` seasons locally (`placeholder-current` + `blizzard-season-17`) may confuse bootstrap/previous selection in some paths (**OBSERVED** DB hygiene).
3. Generic cause collapse: `diagnostics.previousReason` discarded before CharacterScore (**OBSERVED** code).

User fact (played final TWW season) conflicts with a true CONFIRMED_NO_ACTIVITY outcome; current data never reached a HAS_VALUE rating for Lfgmasochist.

Calculator does **not** emit E=0 with the unavailable label. Lfgmasochist column is correctly `null` locally (not 0). If UI shows “0”, that is presentation coercion.
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
4. Why Lfgmasochist never persisted `PREVIOUS_SEASON_RATING` while Wallidrixe got RIO absence on season-15 (provider logs / binding).
5. Production UI: does Experience null render as “0”?
6. Whether production Midnight previous-season policy is COMPLETE or `NO_USABLE_POLICY` (local season-15 is COMPLETE).

---

## 6. Recommended fix boundaries

### Agent 02 — Eligibility / public search

- Distinguish keystone **failure** from proven absence (do not persist/consume failure as null proof).
- When complete shell lacks authoritative-season evidence, allow bounded bootstrap repair without requiring unrelated incomplete-shell semantics — or map `NO_CURRENT…` to an explicit repair advertisement carefully.
- Keep worker gate provider-free.
- Do not change eligibility thresholds (max level / min score) unless explicitly approved.
- Acceptance: tests already freezing current behavior become failing→passing acceptance after fix.

### Agent 03 — Utility explainability (optional product)

- Prefer surfacing uncapped/capApplied in audit UI; do **not** change `UTILITY_V2_DOMAIN_CONTRIBUTION_CAP` unless product explicitly requests recalibration.
- Do not conflate with `expectedDungeons`.

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

| Test | File | Today |
|------|------|-------|
| Complete shell + missing season + !forceRetry → no repair; repairRequired false; conflict no repair | `character-bootstrap-repair.test.ts` | Freezes bug |
| Keystone throw → null indistinguishable from absence; providerCalls undercount | `character-public-bootstrap.keystone-collapse.test.ts` | Freezes bug |
| Dual-domain cap=8 with distinct uncapped; expectedDungeons unrelated | `utility-v2.test.ts` | Documents design |
| Warlock BASELINE vs Warrior/Shaman null-spec zero eligible; coverage blend | `phase2.test.ts` | Documents asymmetry |
| `NO_USABLE_POLICY` ensure-complete | `experience-agent02-integrity.test.ts` | Freezes bug |
| `MISSING_POPULATION_POLICY` → null not 0; confirmed absence → 0 | `calculate.test.ts` | Semantics lock |

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

## Manual UI baseline checklist (human gate — before Agent 02)

Keep short. Record exact strings/numbers.

### PUBLIC SEARCH

1. Search a non-owned character known to exist on Blizzard (note name/realm/region).
2. Expect error code `CHARACTER_NO_CURRENT_SEASON_MYTHIC_SCORE` (or profile READY without refresh).
3. Confirm `bootstrapRepairRequired` is **false** / no repair CTA if shell looks complete.
4. Retry search without `forceRetry` — expect **same** failure.
5. Compare with an owned Battle.net character that refreshes successfully.

### UTILITY

1. Open a scored character showing Utility strengths.
2. Note labels: `Cast stops contributed …` and `Strategic CC contribution …`.
3. Record Utility score and both contribution numbers (expect **8** / **8** on strong characters).
4. Do **not** treat “8” as event count.

### PERFORMANCE

1. Wallidrixe (Warlock): record Performance confidence % and confidence limitation labels.
2. Warrior character: same.
3. Shaman (Lfgmasochist if scored): same.
4. Note whether Warlock is ~100% and others show incomplete cooldown coverage / lower %.

### EXPERIENCE

1. Open Lfgmasochist.
2. Record Experience score/state exactly (null/unavailable vs `0`).
3. Record exact explainability/confidence label (expect **“Previous-season evidence unavailable”** if RCA holds).
4. Confirm it is **not** “Previous-season activity: none confirmed” unless truly E=0.

**Gate rule:** Agent 02 starts only after this checklist is filled and attached to the chantier notes.
