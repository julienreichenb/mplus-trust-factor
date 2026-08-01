---
status: proposed
normative: true
last_reviewed: 2026-08-01
repository: julienreichenb/mplus-trust-factor
baseline_main: 0b0d911f9c4f3ec771bd8f2390e972da01595f99
calibration_draft_branch: agent/11-scoring-calibration-study
calibration_draft_head_observed: 5603d4b8f01375599fa0bb71255b98d775cd8e4d
---


# Utility scoring specification

## 1. Meaning

Utility measures observable non-throughput contribution to group success. Phase 1 measures positive observed contribution. It does not yet have enough information to penalize every missed opportunity.

## 2. Domains

Initial domain weights among applicable domains:

```text
45% cast stops
28% support and group/external cooldowns
27% strategic crowd control
```

Weights renormalize when a specialization has no applicable toolkit domain.

## 3. Ability taxonomy

Utility catalog categories:

- interrupt/kick;
- stun;
- disorient/incapacitate;
- knockback/knock-up;
- grip/reposition;
- silence;
- dispel;
- purge;
- curse/poison/disease removal;
- group defensive;
- external defensive;
- group movement;
- portal/gateway;
- combat resurrection where policy includes it;
- strategic support;
- emergency support.

Routine rotational effects and passive auras are excluded or near-zero credit unless explicitly justified.

## 4. Phase 1 evidence

- player and owned-pet casts;
- WCL confirmed interrupt events;
- hostile cast stream;
- buffs/debuffs;
- dispels;
- target actors;
- active-combat duration;
- spec/talent toolkit;
- report/fight metadata.

## 5. Interrupt attempts

WCL `Interrupts` captures confirmed interruptions. Attempts are inferred from casts of cataloged interrupt abilities.

Classify each attempt:

- `CONFIRMED_SUCCESS`;
- `VALID_OVERLAP` — target cast stopped by another player near the attempt;
- `MATCHED_FAILED`;
- `UNMATCHED_ATTEMPT`;
- `NOT_OBSERVABLE`.

Phase 1 score uses observed attempt volume with safeguards:

- confirmed successes receive full credit;
- valid overlap receives partial credit;
- unmatched attempts are capped and cannot by themselves produce an elite score;
- success ratio remains diagnostic until Phase 2 opportunity modeling.

## 6. Cast-stop score

Normalize credited cast stops by hostile-activity active-combat hour.

Example credited actions:

```text
success = 1.00
valid overlap = 0.50
matched failed = 0.20
unmatched attempt = 0.05, capped
```

These are candidate defaults subject to probes and calibration.

Use a saturating rate curve. A low number of observable hostile casts reduces confidence and pulls contribution toward neutral.

## 7. Strategic crowd control

Credit:

- cataloged player/owned-pet casts;
- confirmed aura/debuff where available;
- target validity;
- active-combat context.

Normalize by active-combat hour with diminishing returns. Repeated spam on the same target in a short window is deduplicated or discounted.

## 8. Support and externals

Phase 1 counts volume only:

- group cooldowns;
- external defensives;
- mass dispel/support;
- gateway/portal;
- targeted emergency tools;
- dispel/purge successes.

Use semantic multipliers:

- reactive/emergency support: full;
- strategic support: high;
- routine rotational support: very low;
- passive support: zero;
- personal mobility: zero;
- unverified external: zero.

## 9. Phase 1 score semantics

Until missed opportunities are modeled, Phase 1 is one-sided observed contribution:

- neutral floor: 50;
- positive evidence raises score;
- no observed action does not automatically lower below 50;
- zero evidence produces low confidence;
- per-domain contribution caps prevent one ability from dominating.

```text
utility =
  clamp(50 + sum(applicable weighted positive contributions), 50, 100)
```

This preserves current observed-contribution safety semantics.

## 10. Confidence

Inputs:

- selected-run and dungeon coverage;
- active-combat hours;
- hostile-cast observability;
- attributable event count;
- ability catalog coverage;
- mechanic catalog coverage;
- source completeness;
- pet attribution;
- toolkit applicability.

Toolkit-inapplicable domains do not count as missing.

## 11. Phase 2 — opportunities and relevance

### 11.1 Interrupt opportunity model

From hostile cast events and mechanic rules:

- interruptible priority cast;
- interruptible low-priority cast;
- stop-able by CC;
- immunity/unstoppable state;
- target range/assignment unknown;
- cast already covered by another player.

This permits:

- successful interrupt credit;
- overlap credit;
- failed attempt credit;
- missed available opportunity penalty;
- no penalty when kick was unavailable or cast not assignable.

### 11.2 External/group cooldown effect

Contextualize:

- buff active during pressure;
- affected target/group;
- absorb/mitigation observed;
- cast too late;
- cast without pressure;
- cooldown available but unused.

Exact mitigation claims require auditable data.

### 11.3 Phase 2 score range

Once opportunities are reliable, scores may fall below 50 for repeated missed applicable opportunities. Activation requires minimum mechanic-catalog and opportunity coverage.

## 12. Phase 3 — reference comparison

Compare per spec/dungeon/key band:

- cast-stop rate;
- success/overlap/miss distribution;
- strategic CC diversity;
- support/external rate;
- mechanic coverage;
- cooldown timing;
- toolkit utilization breadth.

Reference terms remain bounded so absolute contribution still matters.

## 13. Explanation payload

Expose:

- attempts, successes, overlaps, unmatched attempts;
- CC/support actions;
- active-combat hours;
- applicable toolkit domains;
- domain curves and caps;
- observed-contribution mode;
- opportunity mode state;
- catalog/mechanic coverage;
- selected runs and confidence reasons.

## 14. Invalid practices

- counting only confirmed interrupts when the product promises attempts;
- granting full credit to arbitrary unmatched kick spam;
- penalizing zero use without proving opportunities;
- crediting passive rotational auras as strategic support;
- counting pet actions without ownership attribution;
- comparing utility volume across specs without toolkit normalization.
