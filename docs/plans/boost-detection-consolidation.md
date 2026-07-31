# Boost detection consolidation — implementation-ready design

**Status:** design only (documentation). Amended for shadow-only V1 readiness.  
**Date:** 2026-07-31 (amended)  
**Branch intent:** `plan/boost-detection`  
**Canonical product docs:** [`doc/product/scoring-model-v6.md`](../../doc/product/scoring-model-v6.md), [`doc/security/red-flag-language.md`](../../doc/security/red-flag-language.md), [`doc/operations/model-lifecycle.md`](../../doc/operations/model-lifecycle.md)

## Decision taxonomy (read first)

| Label | Meaning |
|-------|---------|
| **Locked V1 shadow** | Binding for initial implementation; still produces **no** production scoring effect |
| **Hypothesis** | Candidate ranges for offline evaluation only — **not** product thresholds |
| **Future model decision** | Requires a non-active draft ScoreModel + lifecycle approval |
| **Privacy / product approval** | Separate human decision before any public or account-derived surface change |
| **Implementation prerequisite** | Schema/migration/tooling work that must be approval-gated before coding |

---

## Hard constraints

- Do **not** modify production scoring formulas, weights, thresholds, grades, or model versions in this programme’s shadow phases.
- Do **not** activate or publish a model.
- Do **not** add public flags.
- Do **not** populate production `AuthenticityFeatureInput` under the **active** model — including currently unused weighted keys. Filling an unused weighted key is a **scoring behavior change**.
- Authenticity / boost remains a **separate pillar** under v6: metadata + probabilistic red flags; it does **not** change Trust Score until a future calibrated model explicitly says otherwise.
- Account linkage is **private**. Never infer alternate ownership from names, guild, IP, group composition, or similarity. Use **verified Battle.net ownership only**.
- Public wording remains probabilistic and unchanged ([`doc/security/red-flag-language.md`](../../doc/security/red-flag-language.md)).

---

## Final neutral feature names (**Locked V1 shadow**)

| Feature | Role |
|---------|------|
| `progressionVelocity` | Progression through key **difficulty** over time (not run volume) |
| `teammateScoreGap` | Time-aligned Mythic+ rating gap vs teammates on high keys |
| `repeatedStrongerTeammateCohort` | Recurrence of the same substantially stronger teammates across the high-key set |
| `highKeyGroupConcentration` | Overlap of the same roster core across most high-key progression |
| `verifiedAltExperienceMitigation` | Private mitigation when a verified same-account character has equal/higher season Mythic+ |

Internal names describe **observed patterns**. They do **not** assert that a boost occurred.  
(Renamed from earlier draft `repeatedCarryCohort` → `repeatedStrongerTeammateCohort`.)

---

## Shadow-only phase boundaries (**Locked V1 shadow**)

### What Phases 1–4 may do

- Compute private feature facts in memory or offline tools
- Produce offline / backtest outputs
- Persist private shadow-analysis records in the **approved private store** (Phase 3+, after migration approval)
- Compare shadow values with **current production** authenticity results **without writing back**

### What Phases 1–4 must not do

- Populate production `AuthenticityFeatureInput`
- Change `authenticityScore`
- Change existing red flags (including unused-key side effects)
- Change public explanations
- Change addon bitsets
- Change Trust Score
- Affect refresh publication
- Influence grade, confidence, or eligibility
- Emit or strengthen `confirmed_reroll` / `probable_reroll` from verified ownership
- Write account-derived evidence into public explanation JSON

**Only** a separately approved **non-active draft ScoreModel** or **isolated analysis batch** may consume the new features (Phase 5+).  
Populating currently unused authenticity keys under the **active** model is forbidden merely because weights already exist.

---

## 1. Current-state audit

### 1.1 End-to-end path today

```text
Raider.IO profile
  → extractBoostSupportFacts()          (neutral facts; no verdict)
  → mapBoostFactsToAuthenticity()       (partial 0–1 feature severities)
  → calculateAuthenticity()             (score + tags + red flags)
  → calculateScore() / explainScore()   (snapshot + public/admin text)
  → ScoreSnapshot.authenticityScore
    + ScoreSnapshot.explanation.redFlags
```

Battle.net `VerifiedCharacterOwnership` is a **separate private IAM path** and is **not** wired into authenticity mitigations.

### 1.2 Current red flags

| Key | Severity | Emitted by | Seeded in `red_flag_definitions`? | Notes |
|-----|----------|------------|-----------------------------------|-------|
| `boost_suspected` | HIGH | `calculateAuthenticity` when score &lt; `boostSuspectedBelow` (40) and evidence adequate | Yes | Public; probabilistic language |
| `atypical_progression` | MEDIUM | Auth score &lt; `atypicalBelow` (60), not boost | Yes | Public |
| `insufficient_data` | INFO | Authenticity **or** score confidence path | Yes | Dual emission; deduped by key |
| `confirmed_reroll` | INFO | `isConfirmedReroll` / high `confirmedEliteMain` | **No** | Emitted; missing from seed |
| `probable_reroll` | INFO | `isProbableReroll` / high `probableReroll` | **No** | Emitted; missing from seed |
| `low_run_volume` | LOW | — | Yes | Seeded + UI filter; **never emitted** by engine |
| `data_stale` | — | — | Yes | Seeded; not part of authenticity engine |
| WCL / logs flags | various | Non-auth paths | Yes | Orthogonal to boost detector |

**Persistence today:** Boost flags live on `ScoreSnapshot.explanation.redFlags` JSON. The `CharacterRedFlag` table exists and is cleared on some run deletes, but scoring **does not** write boost rows there.

**Addon public bitset** (`tools/addon-exporter`): `boost_suspected`, `atypical_progression`, `logs_hidden`, `insufficient_data`, `probable_reroll`, `confirmed_reroll`.

### 1.3 Authenticity / boost metrics

| Symbol | Location | Role |
|--------|----------|------|
| `calculateAuthenticity` | `packages/scoring/src/authenticity.ts` | 100 − weighted suspicions + mitigations → `authenticityScore`, evidence, tags, flags |
| `AuthenticityFeatureInput` | `packages/scoring/src/types.ts` | Nine suspicion + five mitigation inputs (0–1) |
| Default weights / tags | `packages/scoring/src/model/defaults.ts` | Inherited by v6 via `createDefaultModelV6` |
| `calculateFinalTrust` | `packages/scoring/src/trust.ts` | v6: `authenticityAppliedToOverall: false` |
| `ScoreSnapshot.authenticityScore` | Prisma | Persisted column |
| Metric `authenticity.suspicion_index` | Seed catalog | Defined; **never computed** |

**Default tag thresholds (current model config — do not change here):**  
`boostSuspectedBelow: 40`, `atypicalBelow: 60`, `minEvidenceStrength: 18`.

**Reroll softening (already in engine):** progression-only suspicions may be softened; **direct performance** suspicions (`weakTargetPerformance`, `highDeathsLowContribution`, `ratingPerformanceDivergence`) are **never** erased by reroll/main mitigations.

### 1.4 Suspicion features vs live population

| Feature key | Weight | Live mapper populates? |
|-------------|--------|------------------------|
| `progressionKeyJump` | 18 | Yes — season score delta &gt; 600 → clamp(jump/1800) |
| `compressedBestRunWindow` | 12 | **No** — facts have timestamps/levels; unused |
| `lowVolumeForScore` | 14 | Yes — run count &lt; 20 |
| `repeatedStrongerTeammates` | 16 | Yes — top recurrence, ≥2 shares, teammate avg &gt; 1.1× subject |
| `topRunRosterConcentration` | 12 | Yes — top recurrence shares / all runs (not high-key subset) |
| `lackIntermediateProgression` | 10 | Yes — `historyIncomplete` → 0.35 |
| `weakTargetPerformance` | 20 | **No** |
| `highDeathsLowContribution` | 14 | **No** |
| `ratingPerformanceDivergence` | 12 | **No** |

**Mitigations:** only `probableReroll` / `isProbableReroll` heuristically set (null previous season + score ≥ 2200 + &lt; 30 runs). `confirmedEliteMain`, `strongPriorSeasonSameRole`, `strongPersonalTopRunPerformance`, `independentGroupDiversity` are **not** fed from production refresh.

### 1.5 Run and participant data

| Model / type | Path | Boost relevance |
|--------------|------|-----------------|
| `MythicRun` | Prisma | `keyLevel`, `timed`, `scoreValue`, `completedAt`, season/dungeon |
| `RunParticipant` | Prisma | Roster; `mythicRatingAtRun`; `isTargetCharacter`; `providerCharacterKey` |
| `RaiderIoBoostSupportFacts` | `packages/contracts/src/raiderio.ts` | Ephemeral RIO-derived runs + `teammateRecurrence` |
| Persist | `apps/worker/src/persistence/run-repository.ts` | Upserts participants including `mythicRatingAtRun` |
| Fusion | `apps/worker/src/orchestration/run-fusion.ts` | Merges roster/ratings across providers |

### 1.6 Timeline data

There is **no** dedicated boost progression timeline table. Available inputs:

- RIO run arrays with `completedAt` + `keyLevel` inside `RaiderIoBoostSupportFacts.runs`
- Persisted `MythicRun.completedAt` / `keyLevel`
- Season scores: `currentSeasonScore` / `previousSeasonScore`
- Experience V2 key bands (skill Experience — **separate** pipeline from authenticity)
- `CharacterSnapshot` / `ScoreSnapshot` history (character-level; **ScoreSnapshot.overallScore is not a Mythic+ rating**)

### 1.7 Teammate score evidence today

No dedicated teammate timeline entity.

- Ephemeral: `teammateRecurrence[].averageTeammateScore` from RIO roster `mythicRating` (not guaranteed time-aligned to subject at-run)
- Durable: `RunParticipant.mythicRatingAtRun` (per participant, when persisted)
- Production mapper uses subject **current** season score vs teammate averages — **not** time-aligned (known defect for consolidation design)

### 1.8 Account ownership data

| Symbol | Role |
|--------|------|
| `BattleNetAccount` | OAuth account (`claimed`, `unlinkedAt`, …) |
| `VerifiedCharacterOwnership` | Provider-backed ownership; `status` CURRENT / HISTORICAL / STALE / REVOKED; `currentSeasonMythicRating` + season id + fetchedAt |
| `syncVerifiedOwnership` | Upserts from `/profile/user/wow` |
| Private `/api/v1/me/characters` | Account characters view |

**Not connected to authenticity.** No path sets verified-alt mitigation from ownership.

### 1.9 Current model inputs (authenticity)

Refresh builds `ScoringContext.authenticity` via `mapBoostFactsToAuthenticity(boostFacts)` in `refresh-pipeline.ts`. Package defaults supply weights when DB model JSON omits authenticity sections (`coerceModel`).

### 1.10 Public / private explanation paths

| Layer | Behavior |
|-------|----------|
| `explainScore` | `publicSummary` (safe wording) + `adminDetail` + `authenticityHighlights` |
| `RedFlagDTO.public` | Most authenticity flags `public: true` today |
| API `extractRedFlags` | Reads `explanation.redFlags` |
| `sanitizePublicExplanation` | Strips secrets; does **not** strip authenticity evidence payloads |
| UI | `AuthenticitySection`, `RedFlagsList` (filter `f.public`) |
| Language policy | Suspicion only — never “bought a boost” |
| Addon | Bitset only; no evidence payload |

### 1.11 Tests and backtesting tools

| Asset | Coverage |
|-------|----------|
| `packages/scoring` authenticity / fixture tests | Tags, language, reroll softening, cohort fixtures |
| `tools/fixtures/scoring/profiles.ts` | e.g. `03-boost-suspect`, `04-legitimate-reroll` |
| `apps/worker/.../boost-authenticity.test.ts` | Mapper mapping |
| RIO normalize tests | Facts stay verdict-free |
| Overall-formula v6 tests | Auth not applied to overall |
| Calibration prompts (Agent 10/11) | Spec only; **no dedicated boost backtest CLI** in tree |

### 1.12 Duplicated or contradictory detection paths

1. **Rich engine vs sparse mapper** — nine suspicions defined; ~five RIO signals live.
2. **`CharacterRedFlag` vs snapshot JSON** — two persistence concepts; only JSON is written for boost.
3. **`insufficient_data` dual sources** — authenticity evidence gate and score confidence.
4. **`low_run_volume` seeded but never emitted** — volume folds into `lowVolumeForScore` → may become boost/atypical.
5. **Reroll flags emitted but not seeded** as definitions.
6. **`confirmedEliteMain` vs Battle.net** — mitigation exists; ownership never feeds it.
7. **v5 vs v6 overall** — legacy blend applied authenticity to Trust; v6 does not.
8. **Experience V2 vs authenticity progression** — overlapping “key progression” concepts, different pipelines.
9. **`publication-flow` DTO helper** returns empty `redFlags[]` while API mapper reads explanation.
10. **No dedicated “carry” flag** — roster patterns are encoded inside authenticity features only.
11. **Non-time-aligned gap** — live mapper compares current subject score to teammate averages.

Cleanup items above that are **out of programme scope** are restated in §16 (separate decisions).

---

## 2. Design goals (target signals)

| Feature | Target signal |
|---------|---------------|
| `progressionVelocity` | Unusually rapid increase in **achieved key difficulty** over elapsed time |
| `teammateScoreGap` | Teammates with **time-aligned** Mythic+ ratings significantly above the subject |
| `repeatedStrongerTeammateCohort` | Same high-gap teammates repeated across the versioned high-key set |
| `highKeyGroupConcentration` | Same group core accounts for most high-key progression |
| `verifiedAltExperienceMitigation` | Verified same-account character with equal/higher season Mythic+ (**private**) |

**Mitigation rule (**Locked V1 shadow** semantics):** verified-alt mitigation may **hypothetically** reduce progression/roster-pattern suspicion in offline/draft adapters. It **must not** affect direct subject performance evidence. It **must not** automatically remove an existing suspicion outcome. It **must not** emit public reroll/account flags in shadow phases.

---

## 3. Unified feature pipeline (shadow)

```text
                    ┌─────────────────────────────────────┐
                    │ Private inputs                      │
                    │  MythicRun + RunParticipant         │
                    │  CharacterSnapshot (time-aligned)   │
                    │  RaiderIoBoostSupportFacts (fallback)│
                    │  VerifiedCharacterOwnership (PIT)   │
                    └──────────────┬──────────────────────┘
                                   │
                    ┌──────────────▼──────────────────────┐
                    │ BoostFeatureExtractor               │
                    │  highKeyPolicyVersion (shared)      │
                    │  → BoostFeatureFactsV1              │
                    └──────────────┬──────────────────────┘
                                   │
         ┌─────────────────────────┼─────────────────────────┐
         ▼                         ▼                         ▼
  Offline / backtest        Private BoostFeatureSnapshot   Compare-only vs
  harness outputs           (Phase 3+; not explanation JSON) production authenticity
                                                         (no write-back)

  Phase 5+ only (separate approval):
    non-active draft ScoreModel OR isolated analysis batch adapter
```

Phases 1–4 stop before any authenticity adapter.  
**Do not** map onto unused active-model keys during shadow work.

---

## 4. Shared foundations (**Locked V1 shadow**)

### 4.1 High-key set (single versioned policy)

All of `teammateScoreGap`, `repeatedStrongerTeammateCohort`, and `highKeyGroupConcentration` **must** consume one shared, season-aware, independently testable high-key definition.

**Locked:** features must **not** each redefine “high key” silently.

Feature facts always store:

- `highKeyPolicyVersion`
- `runsEligible`
- `runsExcluded`
- exclusion reasons (aggregated counts by reason code)

**Hypothesis — policy ingredients for evaluation (pick/version; do not ship static absolutes):**

| Ingredient | Candidate approach |
|------------|-------------------|
| Season-relative key band | Authoritative season band table / percentile bands |
| Subject-relative distance | Keys within **Hypothesis:** top−0…top−3 of subject’s season best |
| Top-N | **Hypothesis:** top 10–20 runs by key level then score |
| Minimum score percentile | Season-calibrated; never a lone static “15 or 20” as a shipping threshold |

Absolute key levels (e.g. 15, 20) may appear only as **hypotheses** for a named season in offline studies. Shipping thresholds require season calibration.

**Small samples (**Locked**):** each feature declares `minUsableHighKeyRuns`. Below that minimum:

- **omit** the feature (not computed);
- lower coverage;
- **do not** map missing data to value `0` (zero means “computed, no signal”).

**Hypothesis — minimums for evaluation:** gap / cohort / concentration each **Hypothesis:** 3–5 eligible high-key runs with identity+rating coverage as required by that feature.

### 4.2 Canonical teammate identity

**Preferred order (**Locked**):**

1. Persisted `Character.id` when resolved
2. Stable provider character identifier when available (region-scoped)
3. Normalized `region + realm + character identity` as **lower-confidence** fallback (alias/transfer-aware where `CharacterAlias` exists)

**Rules (**Locked**):**

- Do **not** rely on display name alone
- Identity keys are region-scoped, realm-aware, transfer/rename-aware where aliases exist, collision-resistant, and **private**
- When fallback identity is uncertain: **lower** recurrence/concentration confidence; **do not** merge ambiguous characters; **never** expose the identifier publicly
- Backtests must prevent the same canonical teammate cohort from leaking across training/calibration and evaluation splits (see §12)

### 4.3 Missing vs zero (**Locked**)

| State | Meaning |
|-------|---------|
| Feature **omitted** | Not computed (insufficient evidence / policy exclusion) |
| `value: 0` | Computed with sufficient evidence; **no** observed signal |
| Low `confidence` | Distinct from zero; evidence weak or partial |
| Global confidence alone | **Insufficient** — per-feature metadata is required |

Adapter code (Phase 5+) must **never** coerce omitted → `0` without updating evidence strength. One missing feature must not incorrectly weaken or strengthen another.

---

## 5. Feature specifications

### 5.1 `progressionVelocity`

**Intent:** Detect unusually rapid progression through **key difficulty** over time — **not** activity density / many runs at an already established level.

#### V1 shadow calculation (**Locked** algorithm shape)

1. Scope to the **authoritative current season** for the subject’s region.
2. Sort dated runs chronologically (require usable `completedAt`).
3. For each key level or **season-normalized key band**, retain the **first completion** or **first timed completion** (policy flag; Hypothesis for which variant wins calibration).
4. Measure the **increase in achieved key difficulty** over **elapsed time** between a meaningful baseline and a later peak (or across the rapid window).
5. Require a meaningful **starting baseline** before attributing a “rapid progression window” (e.g. observed best key / band before the candidate window — not an empty history treated as zero).
6. Track **intermediate-band coverage** separately (`intermediateBandsObserved` / missing intermediate bands).
7. Keep **repeated high-key volume** (`topKeyRunCount`) as **contextual** diagnostics only — **not** the primary velocity statistic.

**Do not** flag a character merely for completing many runs at an already established level.

#### Candidate private facts

- `startingBestKey`
- `endingBestKey`
- `keyLevelDelta`
- `elapsedDays`
- `firstCompletionDatesByBand`
- `intermediateBandsObserved`
- `datedRunCoverage`
- `topKeyRunCount` (contextual only)

#### Normalization options for shadow evaluation (**Hypothesis**)

- Key level **relative to the subject’s seasonal top key**
- Key bands defined by the **authoritative season**
- Season percentile or calibrated season-relative bands  
Absolute levels remain hypotheses only; season key scaling changes over time.

#### Observation window

Season-scoped chronological progression; candidate rapid window length is **Hypothesis:** 7–21 days **for measuring delta/time**, not for counting farm volume.

#### Missing-data behavior (**Locked**)

- Insufficient dated runs or no baseline → **omit** feature
- Batch-imported timestamps with identical crawl times → reduce `datedRunCoverage` / confidence; may omit
- Never invent velocity from current-season score alone

#### False-positive scenarios (required review)

- Push week
- Fortified / Tyrannical rotation effects
- Late-season return
- Data imported in one batch (compressed apparent chronology)
- Already-established high-key players farming many runs

#### Explainability / privacy

- **Private:** baseline, ending best, delta, elapsed days, band coverage, contextual farm count
- **Public:** unchanged; no new flags

#### Suggested parameters (**Hypothesis**)

`baselineMinRuns`, `progressionWindowDays`, `timedOnlyFirstCompletions`, `bandSchemaVersion`, `minDatedRunCoverage`.

#### Backtest

Compare labeled rapid-purchase patterns vs legit push weeks and established farmers; primary metric uses difficultyΔ/time, not `topKeyRunCount`.

---

### 5.2 `teammateScoreGap`

**Intent:** Teammates’ Mythic+ ratings significantly above the subject on shared **high-key** runs, using **temporally aligned** ratings only.

#### Time-aligned evidence hierarchy (**Locked**)

For each run, both subject and teammate ratings must be time-aligned. Preferred order:

1. Subject and teammate Mythic+ ratings **captured for that exact run** (e.g. both `RunParticipant.mythicRatingAtRun` present)
2. Nearest persisted rating snapshot **at or before** the run (`CharacterSnapshot.mythicRating` or equivalent with `capturedAt <= run.completedAt`)
3. Another **explicitly time-aligned** provider value for that run

**Forbidden for historical at-run gap:**

- Teammate rating at run time vs subject’s **current** rating calculated weeks later
- Silent substitution of current-season rating as historical at-run evidence
- Trust Score / `ScoreSnapshot.overallScore` as a Mythic+ rating source

If no time-aligned **subject** rating exists for a run:

- **omit that run** from the score-gap feature;
- reduce feature coverage / confidence;
- **never** substitute the current score silently.

Each included run-level gap:

```text
gap = teammateRatingAtRun - subjectRatingAtRun
```

(using the aligned values from the hierarchy above)

#### Handling matrix (**Locked**)

| Condition | Handling |
|-----------|----------|
| Missing subject rating (no aligned source) | Exclude run; lower coverage |
| Missing teammate rating | Exclude that teammate from the run’s gap aggregate |
| Stale provider values | If freshness policy fails, exclude; do not silently use |
| Rating snapshot **after** the run | **Do not use** for that run |
| Season mismatch | Exclude |
| Character transfer / identity change | Resolve via canonical identity + aliases; if ambiguous, exclude / lower confidence |

Current-season rating values may be used for **other point-in-time features** (e.g. verified-alt mitigation at calculation time T) but **not** as historical at-run gap evidence.

#### Normalization (**Hypothesis**)

- Aggregate mean (or trimmed mean) of positive gaps over eligible high-key runs
- Onset / saturation in rating points: **Hypothesis:** onset 200–500; saturation 600–1200 (season-calibrate later)
- Prefer mean of stronger teammates on a run over single max to reduce one-friend noise

#### Missing vs zero

Below `minUsableHighKeyRuns` with aligned pairs → **omit**.  
Adequate sample and near-zero gaps → `value: 0`.

#### False-positive risks

Skill-aligned friends; mid-season subject lag; stale at-run ratings; role rating patterns.

#### Privacy

No public teammate naming; private diagnostics use internal ids only.

#### Backtest

Require time-aligned fixtures; explicitly test that current-score substitution is rejected.

---

### 5.3 `repeatedStrongerTeammateCohort`

**Intent:** Same **substantially stronger** teammates recur across the shared high-key set.  
A repeated roster alone is **not** boosting evidence (see §10).

#### Required data

- Shared high-key set (`highKeyPolicyVersion`)
- Canonical teammate ids
- Per-run time-aligned gaps (from §5.2) or an equivalent “stronger” classifier that itself requires time-aligned evidence

#### Normalization (**Hypothesis**)

1. Strong teammate: aligned gap ≥ onset **or** season-calibrated absolute band
2. Count distinct high keys shared with each strong teammate
3. Cohort score from top-N recurrent strong teammates, normalized by eligible high-key count

**Hypothesis:** min shared high keys 2–4; top-N 1–3; saturation fraction 30–60%.

#### Interaction with gap (**Locked** shadow evaluation rule)

Do **not** treat high recurrence as strong unusual-pattern evidence without sufficient score-gap (or other corroboration) in evaluation reports. Production interaction weights are a **future model decision**.

#### Missing-data / identity uncertainty

Uncertain identities → do not merge; lower confidence; may omit.

#### Privacy

Internal ids only; never public.

---

### 5.4 `highKeyGroupConcentration`

**Intent:** Same multi-member roster core accounts for most high-key progression.

#### Required data

Shared high-key set; full rosters; canonical identities; optional strength classification from time-aligned gaps.

#### Normalization (**Hypothesis**)

Core set size 2–4; min overlap members 2–3; concentration fraction of high-key count/score 50–80%; optional strength gate (≥1 strong teammate in core) for “unusual pattern” interpretation in offline combo metrics — not a production weight.

#### Stable team vs unusual pattern

High concentration + **low** score gap → likely stable team context in shadow reports.  
High concentration + **high** score gap → stronger unusual pattern candidate.  
See §10.

#### Missing-data

Incomplete rosters → exclude run or lower coverage; prefer omit over fabricating overlap. Small samples → omit.

---

### 5.5 `verifiedAltExperienceMitigation` (private)

**Intent:** Reduce **hypothetical** progression/roster suspicion when another verified character on the **same Battle.net account** has the **same or higher** current-season Mythic+ score.

#### Subject eligibility filters (**Locked**)

Subject must resolve through a verified ownership satisfying **all** of:

- `ownership.status = CURRENT`
- `ownership.revokedAt` is null
- `ownership.confidence = CONFIRMED`
- `ownership.characterId` is not null
- associated `BattleNetAccount.unlinkedAt` is null
- associated `BattleNetAccount.claimed` is true

#### Candidate alt filters (**Locked**)

Same requirements as subject, plus:

- Belong to the **exact same** `BattleNetAccount` (not `userId` alone)
- Differ from the subject character
- Have authoritative **season-scoped Mythic+** evidence:
  - `currentSeasonMythicSeasonId` matches the authoritative season for **their** region
  - `currentSeasonMythicRating` &gt; 0
  - `currentSeasonMythicFetchedAt` within the approved freshness window (**Hypothesis:** 7–30 days for evaluation)

#### Forbidden evidence sources (**Locked**)

- `userId` alone as proof two characters share a Battle.net account
- HISTORICAL, STALE, or REVOKED ownerships
- Unclaimed or unlinked accounts
- Unscoped latest rating / old-season rating
- **Trust Score or `ScoreSnapshot.overallScore`** (removed from evidence hierarchy)
- Names, guilds, IPs, or gameplay patterns

#### Cross-region (**Locked V1 preference**)

If characters are in different regions, only compare ratings when an authoritative season mapping **explicitly** establishes comparability. **V1 shadow may restrict mitigation to the same region** if safer.

#### Shadow semantics (**Locked**)

| Condition | Mitigation |
|-----------|------------|
| No verified linked subject | **Absent** (omit) — **never a penalty** |
| Linked subject, no eligible equal/higher alt | `value: 0` with sufficient ownership evidence |
| Eligible equal/higher alt | Value increases **monotonically** with score margin and evidence freshness |

Additional locks:

- Applies only to **progression / roster-pattern** features in hypothetical adapters
- **Never** affects direct subject performance evidence
- Alone cannot prove legitimacy
- Cannot automatically remove an existing suspicion outcome
- Total hypothetical softening must be **capped** (**Hypothesis** for offline study; eventual cap is a **future model decision**)
- **Do not** reuse production `confirmedEliteMain` weight under the active model

Document separately in backtests:

1. Raw private mitigation feature  
2. Hypothetical adapter effect (offline)  
3. Eventual model weight (**future model decision**)

#### Privacy (**Locked** — stronger than earlier draft)

In shadow phases, this feature must **not** emit or strengthen public:

- `confirmed_reroll`
- `probable_reroll`
- any account-linkage wording
- any addon bit

Store only the private mitigation value (+ non-identifying aggregates).  
Do **not** write account-derived evidence into public explanation JSON.  
Do **not** expose whether the subject has linked characters.

Wiring verified ownership into existing reroll flags is a **separate privacy/product approval**, even though flag keys already exist in the engine/addon.

---

## 6. Point-in-time ownership for backtests (**Locked**)

Historical backtests must **not** use ownership or alt ratings learned **after** the score event.

For a score calculated at time \(T\), only use evidence known or valid at \(T\):

- `ownership.verifiedAt <= T`
- ownership not revoked before \(T\)
- account linked and claimed at \(T\)
- alt `currentSeasonMythicFetchedAt <= T` (and rating belongs to the season active at \(T\))

**Do not** use today’s linked roster to mitigate an old historical sample.

### Current schema limitations (**Implementation prerequisite** awareness)

The live schema emphasizes **current** ownership state (`status`, `revokedAt`, `unlinkedAt`) and current-season mythic fields. It may **not** fully reconstruct historical link/unlink sequences or past alt ratings at arbitrary \(T\).

If historical account-link state cannot be reconstructed reliably:

- **exclude** those samples from mitigation evaluation;
- **do not** assume current state applied historically;
- identify whether a future **ownership-history snapshot** store is required (**implementation prerequisite** / separate approval).

Unlinking must not create a penalty. Historical already-published scores must **not** be silently rewritten because a user unlinks later.

---

## 7. Private feature contract (**Locked V1 shadow**)

Public DTOs remain free of these values.

```ts
/** Private boost feature facts — never a public DTO. */
export interface BoostFeatureEvidenceV1 {
  value: number;       // 0..1; only present when computed
  confidence: number;  // 0..1
  sampleSize: number;
  coverage: number;    // 0..1
}

export interface BoostFeatureFactsV1 {
  schemaVersion: 1;
  extractorVersion: string;
  highKeyPolicyVersion: string;
  subjectCharacterId: string;
  seasonId: string; // authoritative season
  calculatedAt: string; // ISO
  sourceProvenance: {
    primary: "persisted_runs" | "raiderio_facts" | "mixed";
    runSourceCounts?: Record<string, number>;
  };
  highKeySet: {
    runsEligible: number;
    runsExcluded: number;
    exclusionReasonCounts: Record<string, number>;
  };
  features: {
    progressionVelocity?: BoostFeatureEvidenceV1;
    teammateScoreGap?: BoostFeatureEvidenceV1;
    repeatedStrongerTeammateCohort?: BoostFeatureEvidenceV1;
    highKeyGroupConcentration?: BoostFeatureEvidenceV1;
    verifiedAltExperienceMitigation?: BoostFeatureEvidenceV1;
  };
  missing: Array<{
    featureKey: string;
    reasonCode: string; // e.g. INSUFFICIENT_HIGH_KEYS, NO_TIME_ALIGNED_SUBJECT_RATING
  }>;
  /** Aggregated, non-identifying diagnostics only */
  diagnostics?: {
    startingBestKey?: number | null;
    endingBestKey?: number | null;
    keyLevelDelta?: number | null;
    elapsedDays?: number | null;
    intermediateBandsObserved?: number | null;
    datedRunCoverage?: number | null;
    topKeyRunCount?: number | null;
    meanAlignedTeammateGap?: number | null;
    topCohortSharedHighKeys?: number | null;
    highKeyCoreOverlapFraction?: number | null;
    verifiedAltMitigationPresent?: boolean;
    verifiedAltScoreMargin?: number | null; // no alt names
  };
}
```

**Semantics reminder:** omitted feature key = not computed; `value: 0` = computed, no signal.

---

## 8. Private persistence decision (**Locked V1**)

**Do not** store rich private boost diagnostics in `ScoreSnapshot.explanation`, even under a namespaced key. That shared JSON already feeds public and admin mapping paths and creates an avoidable leakage risk.

**Recommended V1 store:** dedicated private shadow-analysis persistence (e.g. versioned `BoostFeatureSnapshot` and/or analysis-batch record).

| Requirement | Decision |
|-------------|----------|
| Exposure via profile serializers | **None** by default |
| Access | Worker, backtest tooling, authorized admin analysis only |
| Public DTO mapping | **None** |
| Addon export mapping | **None** |
| Migration | **Future approval-gated implementation** — not part of this documentation commit |

### Record contents (allowed)

- Subject character ID (FK)
- Authoritative season ID
- Feature schema / extractor / high-key policy versions
- `calculatedAt`
- Per-feature value / confidence / sampleSize / coverage
- Minimal non-identifying diagnostics
- Input coverage + source provenance
- Optional analysis-batch id

### Must avoid persisting

- BattleTag
- Battle.net account ID in serialized diagnostics
- Teammate display names
- Full ownership graphs
- Raw provider payloads
- Unnecessary alt character names

Use durable internal foreign keys only when required; protect via private access controls.

---

## 9. Stronger-alt mitigation layers (keep separate)

| Layer | Status |
|-------|--------|
| Raw private mitigation feature | **Locked** shadow extract (Phase 4) |
| Hypothetical adapter effect | Offline / Phase 5 draft or analysis batch only |
| Eventual model weight | **Future model decision** — new draft version; do **not** reuse active `confirmedEliteMain` weight in production first |

---

## 10. Fixed team versus unusual stronger cohort (**Locked** evaluation logic)

A repeated roster is **not** inherently evidence of boosting.

Shadow evaluation must distinguish:

- Stable team with similar ratings
- Stable team where the subject contributes strongly (when direct performance features exist)
- Repeated substantially stronger teammate cohort
- Rotating high-score helpers
- One stronger friend
- Full fixed five-player push group

`repeatedStrongerTeammateCohort` and `highKeyGroupConcentration` must **not** be reported as strong unusual-pattern evidence without sufficient `teammateScoreGap` (or other corroboration) in shadow dashboards.

### Interaction tests (shadow only — no production weights)

| Pattern | Interpretation candidate |
|---------|--------------------------|
| High concentration + low score gap | Likely stable team context |
| High concentration + high score gap | Stronger unusual pattern |
| High gap + diverse roster | Distinct pattern; not repeated cohort |
| High progression velocity + strong subject performance | Reduced concern (when direct features exist) |
| High progression velocity + weak direct performance | Stronger concern (when direct features exist) |

Do **not** introduce production interaction weights in this document.

---

## 11. Public explanation strategy (**Locked** for this programme)

- No new public flags
- No change to existing public wording in shadow phases
- No account-linkage disclosure
- No verified-alt → reroll flag wiring without **privacy/product approval**
- Addon bitset unchanged

---

## 12. Label and backtest governance (**Locked** process)

Do **not** treat “manual boost suspect” as unquestioned ground truth.

### Label classes

- Confirmed or high-confidence external evidence, where legally and ethically usable
- Reviewer-consensus suspicious
- Reviewer-consensus legitimate
- Uncertain / exclude from supervised metrics
- Synthetic fixture

### Review process

- At least **two independent reviewers** for non-synthetic samples
- Disagreements retained as uncertainty
- Record label source and timestamp
- No public accusation generated from labels
- No circular labels derived solely from the current boost detector
- No use of account linkage as the **target** label

### Leakage-safe splits

Prevent leakage by:

- Character
- Battle.net account
- Recurring teammate cohort
- Season / time window

Use temporal holdout where possible.

### Metrics to report

- PR-AUC **and** AUROC
- Precision at review-budget thresholds
- Recall
- Calibration
- False-positive rate
- Subgroup results by role, class, region, score band, run volume, roster style
- Confidence intervals
- Sample counts
- Performance with and without missing-data cohorts

A small manually reviewed cohort must **not** justify production thresholds (**future model decision** only after adequate evidence).

---

## 13. Data minimization and retention (**Locked V1 policy intent**)

| Topic | Policy |
|-------|--------|
| Retain | Feature vectors + aggregated diagnostics only as long as needed for calibration/reproducibility |
| Retain | Extractor / model / version metadata |
| Avoid | Raw teammate rosters when aggregated recurrence facts suffice |
| Prefer | Internal character IDs rather than names |
| Deletion | Remove or expire diagnostics when associated account/character data is deleted per existing privacy policy |
| Unlink / revocation | Define whether ownership-derived feature values are recomputed or deleted; unlink is **never** a penalty |
| Published scores | Do **not** silently rewrite historical published scores on unlink |

Exact retention TTL is an **implementation prerequisite** aligned with [`doc/security/privacy-retention.md`](../../doc/security/privacy-retention.md) (**Hypothesis** starting point: calibration window then purge; not finalized here).

---

## 14. Phased implementation (revised)

### Phase 0 — Documentation only

This document. No code.

### Phase 1 — Pure extractors (**shadow-only**)

- Implement pure feature extractors + fixtures
- **No** database write
- **No** production authenticity adapter
- **No** unused-key population under active model

### Phase 2 — Offline / backtest harness (**shadow-only**)

- Persisted runs + time-aligned participant evidence
- Robust labeling + leakage-safe splits (§12)
- Compare to production authenticity outputs read-only

### Phase 3 — Private shadow persistence (**shadow-only**)

- Approval-gated migration for `BoostFeatureSnapshot` (or analysis-batch equivalent)
- Extractor outputs only
- **No** public or production score effect

### Phase 4 — Verified-alt private shadow extraction (**shadow-only**)

- Point-in-time ownership evidence (§6)
- Private mitigation values only
- **Still no** authenticity adapter
- **Still no** reroll/public flag emission

### Phase 5 — Draft / analysis-batch adapter only

Requires **all** of:

- Non-active draft ScoreModel **or** isolated analysis batch
- Model lifecycle approval
- Backtest evidence
- **No** automatic activation

May consume new features **only** in that isolated context. Still must not mutate active refresh publication.

### Phase 6 — Calibration and human review

Propose model changes **only** as a **new draft** version. No activation.

### Phase 7 — Activation (out of programme by default)

Separate explicit activation decision. **Not** part of this programme by default.

---

## 15. Explicit decisions requiring approval before coding

1. High-key policy version contents (bands / top-N / relative distance mix) for first extractor — freeze candidates for V1 shadow evaluation.
2. Migration for private `BoostFeatureSnapshot` (or equivalent) — Phase 3 prerequisite.
3. Ownership-history snapshot store if PIT backtests cannot be reconstructed — separate prerequisite.
4. Any Phase 5 draft model / analysis-batch adapter — scoring-sensitive approval.
5. Any weight, threshold, grade, or overall-formula change — always new draft + activation approval.
6. Wiring verified ownership into public `confirmed_reroll` / `probable_reroll` — **privacy/product approval** (forbidden in shadow).
7. Any new public flag or addon bit — forbidden here; separate approval if ever revisited.
8. Cross-region alt score comparability mapping — product/ops approval; V1 may same-region only.
9. Retention TTL for shadow diagnostics — privacy alignment.
10. Existing authenticity cleanup items in §16 — each needs its own scoped PR/decision; **not** silent fixes during shadow extraction.

---

## 16. Existing inconsistencies requiring separate decisions

These remain audit findings. **Do not** silently fix them during shadow feature extraction. Each needs its own scoped decision or PR:

| Item | Issue |
|------|-------|
| Reroll flags vs seed | `confirmed_reroll` / `probable_reroll` emitted but not seeded in `red_flag_definitions` |
| `low_run_volume` | Seeded but never emitted; volume folded into features/tags instead |
| Dual `insufficient_data` | Authenticity evidence gate and score confidence both emit the same key |
| `CharacterRedFlag` vs snapshot JSON | Table unused for boost; flags live in `ScoreSnapshot.explanation` |
| Stale UI wording | Copy may imply authenticity changes Trust Score under v6 |
| Sparse mapper vs rich model | Production populates a subset of weighted authenticity keys |

---

## 17. Model-version implications

| Change | Requires new model version? | Allowed in Phases 1–4? |
|--------|----------------------------|-------------------------|
| Pure extractors / fixtures / offline metrics | No | Yes |
| Private `BoostFeatureSnapshot` persistence | No (schema migration approval ≠ model version) | Phase 3+ after approval |
| Populating unused keys on **active** model | Behavior change — **forbidden** without draft/batch isolation | **No** |
| Draft adapter in analysis batch / non-active model | Draft config yes; activation separate | Phase 5 only |
| Weight / threshold / tag changes | **Yes** | Phase 6 draft only |
| Apply authenticity to overall Trust | **Yes** + product decision (contradicts v6) | No |
| New public flags | Product + security approval | No |

Lifecycle authority: [`doc/operations/model-lifecycle.md`](../../doc/operations/model-lifecycle.md).

---

## 18. Adversarial cases (updated)

| Attack / edge | Expected handling |
|---------------|-------------------|
| Rotating stronger helpers | Low cohort/concentration; gap may still compute |
| Farm volume at established key | Low `progressionVelocity`; high contextual `topKeyRunCount` only |
| Current-score substitution for gaps | **Rejected** by time-alignment hierarchy |
| Claim guild/name/IP = alt | **Rejected** |
| Link BNet after the fact to launder historical sample | PIT backtest excludes post-hoc ownership |
| Unlink BNet | Mitigation absent going forward; **no penalty**; no silent rewrite of old published scores |
| Ambiguous teammate identity | Do not merge; lower confidence / omit |
| Push week / affix rotation / late return / batch import | Velocity FP review scenarios |

---

## 19. Key code authority index

| Path | Role |
|------|------|
| `packages/scoring/src/authenticity.ts` | Score + tags + softening rules |
| `packages/scoring/src/types.ts` | Feature input / weights types |
| `packages/scoring/src/model/defaults.ts` | Default weights and tag thresholds |
| `packages/scoring/src/explain.ts` | Public vs admin explanation |
| `apps/worker/src/orchestration/boost-authenticity.ts` | Live RIO → features mapper (not time-aligned) |
| `packages/providers/raiderio/src/normalize.ts` | `extractBoostSupportFacts` |
| `packages/contracts/src/raiderio.ts` | `RaiderIoBoostSupportFacts` |
| `packages/database/prisma/schema.prisma` | Runs, participants, ownership, snapshots, red flags |
| `apps/api/src/iam/ownership-sync.ts` | Verified ownership sync |
| `apps/api/src/lib/mappers.ts` | Public DTO / red flag extraction |
| `doc/security/red-flag-language.md` | Public language policy |
| `doc/product/scoring-model-v6.md` | Auth metadata under v6 |

---

## 20. Non-goals (explicit)

- Changing Trust Score with authenticity under v6
- Activating or publishing any model in this programme by default
- Adding public flags or addon bits
- Inferring alts without Battle.net verification
- Finalizing numerical product thresholds in this document
- Populating unused active-model authenticity keys during shadow work
- Storing private boost diagnostics in `ScoreSnapshot.explanation`
- Silently fixing §16 inconsistencies during feature extraction
- Using Trust Score / overallScore as Mythic+ evidence

---

## Document history

| Date | Change |
|------|--------|
| 2026-07-31 | Initial audit + consolidation design (docs only) |
| 2026-07-31 | Amend: shadow-only phases 1–4; neutral cohort name; difficulty-based velocity; time-aligned gaps; canonical identity; unified high-key policy; per-feature evidence; verified-alt eligibility + PIT + privacy; private `BoostFeatureSnapshot`; label governance; §16 cleanup separation |
