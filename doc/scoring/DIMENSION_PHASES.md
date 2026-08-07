# Dimension functional phases

**Status:** normative product source of truth for **functional phases**.

This document defines what each public skill dimension is at each product maturity
stage. It is distinct from technical calculator versions and from the pipeline
generation.

| Concept | Meaning | Examples |
|---------|---------|---------|
| **Functional phase** | Product maturity of one scoring dimension | Performance Phase 2, Utility Phase 1 |
| **Technical calculator version** | Version stamp of a specific formula implementation | `performance-phase2-v1`, `utility-v2.phase1.0.1.0` |
| **Pipeline generation** | Evidence + orchestration architecture | `scoring-v2` |
| **Implementation status** | Whether production scoring uses that functional stage | `IMPLEMENTED`, `PLANNED`, … |

A technical name containing “V2” is **not** automatically functional Phase 2.
Functional Performance Phase 2 is the product stage that adds offensive cooldown
discipline on top of Performance Phase 1.

Canonical architecture / acquisition / dimension plumbing:

- [`SCORING_ARCHITECTURE.md`](SCORING_ARCHITECTURE.md)
- [`WCL_ACQUISITION.md`](WCL_ACQUISITION.md)
- [`SCORING_DIMENSIONS.md`](SCORING_DIMENSIONS.md)

---

## Common evidence policy

Applies to Performance, Utility, and Survival fight-local evidence (not Experience).

| Rule | Value |
|------|-------|
| Active dungeons per season | Eight |
| Target detailed public WCL runs per dungeon | Two |
| Target total detailed runs | Sixteen |
| Selection priority | The two highest available key levels per dungeon |
| Second-run fallback | When a second run at the same level is unavailable, progressively fall back to lower keys |
| Partial coverage | Use fewer than two runs only when no second valid public log exists |
| Profile summary | Also fetch and persist the WCL `points_and_damage` character/season profile summary (`CharacterPerformanceAggregate`) |

Missing runs are never zero-filled. Confidence and publication behaviour for fewer
than sixteen runs is owned by a **separate** chantier — do not redefine it here.

Calculators consume **canonical selected digests** and must not re-select an
independent run set.

---

## Performance

### Phase 1 — parses, peak, floor, difficulty

Inputs:

- WCL profile summary (`CharacterPerformanceAggregate` / `points_and_damage`);
- selected detailed run `key %` parses (at most 2 × 8 = 16);
- season-relative key difficulty policy.

Behaviour:

- peak (best) selected parse per dungeon;
- floor (lower) selected parse when a second run exists;
- consistency between strong and weak runs that **rewards a high floor**, not
  merely a small absolute delta (weak-but-flat parses stay weak);
- strong positive weighting for good high-key parses;
- reduced effective value for equally high parses in easier keys;
- difficulty thresholds are season-relative (policy `k50` / `k90` / `k99`), never
  a permanent hardcoded key number;
- one-run dungeons are partial evidence (no fabricated second-run zero);
- missing profile or detailed evidence is omitted, not invented.

### Phase 2 — offensive cooldown discipline

Includes **all Phase 1 behaviour**, plus:

- offensive cooldown activation frequency;
- expected usable activations from effective cooldown and canonical active-combat
  duration (with end-grace);
- catalogue-driven eligibility via `performanceCooldownRule` (not category alone);
- activation counts from digest `offensiveActivations` projected by
  `projectOffensiveActivations` (cast/buff deduplicated once).

Phase 2 scores **quantitative frequency only**. It does **not** judge whether a
cooldown was held for the strategically correct pull.

Combination when both Phase 1 and cooldown evidence exist:

```text
PerformancePhase2Score =
  Phase1PerformanceScore × 0.80
  + OffensiveCooldownDiscipline × 0.20
```

When Phase 1 exists but cooldown evidence is unavailable: score = Phase 1,
state `PARTIAL`, cooldown weight 0 (no implicit 20% zero penalty).
When Phase 1 is unavailable: Performance is unavailable — cooldown alone never
publishes a Performance score.

**Technical calculator (production):** `performance-phase2-v1`
**Pipeline:** `scoring-v2`

Difficulty policy note: the calculator applies a versioned Season Difficulty Policy
(`k50` / `k90` / `k99`). When the product path does not yet inject a calibrated
season policy, orchestration falls back to an explicit default policy stamped
`orchestrator-default-v1` (not derived from the scored character). Replacing that
default with a live season SDP is a follow-up configuration chantier — not Phase 3.

### Phase 3 — deferred

- comparison with S/A players;
- dungeon- and situation-specific cooldown timing;
- intentional cooldown holding quality;
- requires a critical mass of scored players.

Status: `DEFERRED_CRITICAL_MASS`. No placeholder Phase 3 score is produced.

---

## Survival

### Phase 1

- deaths;
- self-heals while low health;
- defensive cooldown usage volume;
- damage taken;
- internal group comparison, excluding or adapting tanks.

### Phase 2

- anticipation versus reaction;
- mitigation around incoming damage;
- availability of defensives/self-heals at death or damage time;
- reduced penalty when no relevant tool was available.

Phase 2 uses **persisted pressure-window response facts** plus catalogue cooldown
availability reconstructed from activation timestamps (no new WCL requests):

| Observable state | Evidence | Scoring |
|------------------|----------|---------|
| `ANTICIPATED` | `defensivesBefore` on pressure window | Highest defensive credit |
| `REACTIVE` | `defensivesDuring` | Lower than anticipation |
| `NO_RESPONSE_AVAILABLE` | No defensive response + baseline tool ready at danger start | Poor credit (not omitted) |
| `NO_TOOL_AVAILABLE` | No applicable baseline tool, or all known tools on cooldown | Omitted (not failure) |
| `NOT_OBSERVABLE` | Missing damage/defensive timing datasets or unknown CD/talent | Omitted |
| `TIMELY_RECOVERY` / `LATE_RECOVERY` | `recoveryAfter` activations vs danger end | Emergency recovery credit |
| `NO_RECOVERY_AVAILABLE` | No recovery + baseline self-heal ready | Poor recovery credit |
| `NO_SELF_HEAL_AVAILABLE` | No applicable baseline self-heal / all on CD | Omitted |

Relative party damage remains **omitted** on the product path (`relativeDamage: null`)
until reliability criteria are met — it is not activated merely to complete Phase 2.

Talent-gated tools without confirmed talent state are treated as `UNKNOWN` and are
never penalized as available-but-unused.

**Technical calculator (production):** `survival-v2-phase2-contextual-0.2.0`
**Pipeline:** `scoring-v2`

### Phase 3

- same-class/spec dungeon benchmarks;
- comparison with S/A players.

---

## Utility

### Phase 1

- kick attempts;
- crowd-control interruption attempts;
- group cooldowns;
- externals;
- volume-based scoring;
- attempted interruption counts even when the cast was not successfully stopped.

### Phase 2

- successful versus unsuccessful interruption weighting;
- contextual impact of group defensives and externals;
- confirmed mitigation or support outcome.

Phase 2 uses the **strongest persisted observable state** from
`ParticipantScoringDigestV1` / Utility action timelines:

| Observable state | Typical digest evidence | Credit tier |
|------------------|-------------------------|-------------|
| Confirmed interrupt success | Interrupts-table outcome `SUCCESS` | `CONFIRMED_SUCCESS` |
| Unverified kick attempt | Casts kick with Interrupts capability complete, no confirm | `UNMATCHED_ATTEMPT` |
| Unobservable attempt | Interrupts capability missing/incomplete, or outcome `UNKNOWN` | `NOT_OBSERVABLE` (not treated as failure) |
| Confirmed support impact | Combat res / dispel success | `CONFIRMED_IMPACT` |
| Confirmed application | External applybuff / successful external cast with target | `CONFIRMED_APPLICATION` |
| Unverified usage | Incomplete Buffs context or unknown outcome | `UNVERIFIED` (no full credit) |

`VALID_OVERLAP` and `MATCHED_FAILED` remain implemented in `classifyInterruptAttempts`
when hostile cast windows are present (probe / shared-evidence path). The product
digest path does **not** persist hostile windows, so it does not invent those classes
or invent unobserved mitigation amounts for group cooldowns.

**Technical calculator (production):** `utility-v2-phase2-observed-0.2.0`
**Pipeline:** `scoring-v2`

### Phase 3

- comparisons with S/A players.

---

## Experience

### Phase 1

- historical 0.1% Mythic+ titles;
- exceptional historical class/spec ranking;
- previous-season Mythic+ score;
- stronger value for high prior scores;
- no prior score treated as limited recent class experience.

### Phase 2

- extend evidence to linked characters on the same account.

No Phase 3 is currently defined.

---

## Implementation-status matrix

States:

| State | Meaning |
|-------|---------|
| `IMPLEMENTED` | Production `scoreCharacter()` path uses this functional stage |
| `PARTIALLY_IMPLEMENTED` | Some required evidence/formula pieces exist but product path is incomplete |
| `CANDIDATE_SHADOW` | Calculator/probe exists but is not production-authoritative |
| `PLANNED` | Specified; not built |
| `DEFERRED_CRITICAL_MASS` | Blocked on enough scored players / cohort data |
| `NOT_FEASIBLE_CURRENTLY` | Evidence or platform capability missing |

| Dimension | Functional phase | Planned evidence | Currently available evidence | Implementation state | Blocking dependency | Technical calculator / version |
|-----------|------------------|------------------|------------------------------|----------------------|---------------------|--------------------------------|
| Performance | Phase 1 | Profile summary + ≤16 detailed parses; peak/floor/consistency; season-relative difficulty | Digests with ranking parses; `CharacterPerformanceAggregate`; difficulty policy; Performance V2 Phase 1 internals | `IMPLEMENTED` (subsumed by Phase 2 product path) | — | Phase 1 internals under `performance-phase2-v1` |
| Performance | Phase 2 | Phase 1 + offensive cooldown frequency | Digest `offensiveActivations`; catalogue `performanceCooldownRule`; active-combat duration on survival digest slice; product path uses `computePerformancePhase2` | `IMPLEMENTED` (cooldown); difficulty policy still uses orchestration default until season SDP injection | Season SDP injection for calibrated k50/k90/k99 | `performance-phase2-v1` |
| Performance | Phase 3 | S/A benchmarks; pull-specific timing | None in production path | `DEFERRED_CRITICAL_MASS` | Critical mass of scored players | — |
| Survival | Phase 1 | Deaths, self-heals, defensive volume, DTPS, internal group compare | Survival digests + Survival V2 calculator in product path | `IMPLEMENTED` (subsumed by Phase 2 product path) | — | Phase 1 internals under `survival-v2-phase2-contextual-0.2.0` |
| Survival | Phase 2 | Anticipation / availability-at-damage | Pressure `defensivesBefore`/`During`/`recoveryAfter`; catalogue CD/charges; toolkit from class/spec; `computeSurvivalV2` via enriched `survivalFactDocumentFromDigest` | `IMPLEMENTED` | Relative damage still omitted; talent state unknown → no penalty; mitigation amounts not invented | `survival-v2-phase2-contextual-0.2.0` |
| Survival | Phase 3 | Same-class/spec + S/A benchmarks | None | `DEFERRED_CRITICAL_MASS` | Critical mass | — |
| Utility | Phase 1 | Attempt volume (kicks/CC/externals/group CDs) | Utility digests + Utility V2 in product path | `IMPLEMENTED` (subsumed by Phase 2 product path) | — | Phase 1 internals under `utility-v2-phase2-observed-0.2.0` |
| Utility | Phase 2 | Success weighting + contextual impact | Digest outcomes + capability completeness; support tiers from strongest observable state; `computeUtilityV2` via `utilityRunFactSetFromDigest` | `IMPLEMENTED` | Hostile windows not in digest → no digest-path VALID_OVERLAP/MATCHED_FAILED; mitigation amounts not invented | `utility-v2-phase2-observed-0.2.0` |
| Utility | Phase 3 | S/A comparisons | None | `DEFERRED_CRITICAL_MASS` | Critical mass | — |
| Experience | Phase 1 | Titles, exceptional ranks, prior-season score | Experience V3 calculator when enabled | `PARTIALLY_IMPLEMENTED` | Product wiring / publication maturity | `experience-v3*` (see code) |
| Experience | Phase 2 | Linked account characters | Not implemented | `PLANNED` | Account-link evidence | — |
| Experience | Phase 3 | — | Not defined | `PLANNED` | Product definition | — |

Pipeline generation for the production roster/digest path: **`scoring-v2`**.

---

## Functional → technical mapping (Performance Phase 2)

| Functional requirement | Reused component | Changed | New |
|------------------------|------------------|---------|-----|
| Selected ≤16 detailed parses | Canonical run selection + digest parse facts | — | — |
| Peak / floor / consistency | `computeDungeonPerformance` | — | — |
| Season-relative difficulty | `adjustParseForDifficulty` / SDP | Reject invalid key levels as missing evidence | — |
| Profile stabilizer | `computeProfilePerformance` + blend | Orchestrator passes aggregate (was `null`) | Aggregate → profile fact adapter |
| Offensive eligibility | Ability catalogue + `performanceCooldownRule` | Skip SHARED/racial and talent-gated without availability evidence; do not pollute skips with other-class rules | Eligibility filter in scoring |
| Activation counts | Digest `offensiveActivations` / `projectOffensiveActivations` | — | — |
| Expected uses + end grace | — | Multi-charge uses explicit catalogue `charges` as initial pool only | Phase 2 V1 expected-uses rule |
| 80/20 combine | Phase 1 score as base | Product algorithm version stamp | `computePerformancePhase2` combine |
| Phase 3 isolation | — | — | Documented deferred; no score |

---

## Version stamp (authoritative Performance)

```text
Functional stage: Performance Phase 2
Technical calculator: performance-phase2-v1
Pipeline: scoring-v2
```

## Version stamp (authoritative Utility)

```text
Functional stage: Utility Phase 2
Technical calculator: utility-v2-phase2-observed-0.2.0
Pipeline generation: scoring-v2
```

## Version stamp (authoritative Survival)

```text
Functional stage: Survival Phase 2
Technical calculator: survival-v2-phase2-contextual-0.2.0
Pipeline generation: scoring-v2
```
