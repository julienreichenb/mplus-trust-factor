# Utility OBSERVED_CONTRIBUTION — Score Semantics

**Status:** Authoritative Utility is toolkit exploitation on a real **0–100** scale.

Absence of usage of an **applicable, observable** family scores toward 0, not a hidden 50 floor.
Inapplicable families are excluded. Optional group tools (battle rez / bloodlust) do not penalize when unused.
Talent-uncertain families are excluded rather than treated as unused zeroes.

See `packages/scoring/src/utility/v2/` for the current formula, family map, and model config.

**Technical calculator:** `utility-v2-phase3-toolkit-0.1.0`  
**Functional stage:** Utility Phase 3 (Opportunity Mode remains off).

## 1. Final score semantics

OBSERVED_CONTRIBUTION is a **toolkit-exploitation** score. It is **not** a tactical-correctness or missed-opportunity score.

| Rule | Behavior |
|------|----------|
| Strong/broad legitimate usage | Can reach **80+**; exceptional cases can approach **100** |
| Ordinary partial usage | Middle of the 0–100 scale |
| Applicable toolkit unused | Genuine poor score, **clearly below 50**, potentially **0** |
| Missing / unbound facts | Score **withheld** (`UNAVAILABLE`), not a fabricated player zero |
| Talent applicability uncertain | Family **excluded**, never treated as unused-toolkit zero |
| Missed opportunities | **Not measured** (range/LoS unobservable; Opportunity Mode off) |
| SUCCESS_OTHER_PLAYER | **Never** credited |
| Toolkit-inapplicable families | **Excluded** from weight share; must **not** reduce the score |

Trust weight remains **25%** (unchanged). The former hidden floor of 50 and +8 per-domain contribution cap are removed.

## 2. Shadow-mode call graph (Agent 39 shared evidence)

```
refresh-pipeline
├── analyzeSurvivalViaSharedEvidence(includeUtilityDatasets=true)
│     └── ingestSharedEvidenceBundle(consumers=[survival, utility])
│           ├── loadDataset / loadBundleSummary → reuse persisted (0 WCL)
│           └── else fetch once → saveDataset / saveBundleSummary
├── collect sharedEvidenceBundlesForUtility[]
├── combat-facts → legacy utility.* metrics          [public UTILITY — unchanged]
├── buildUtilityShadowInputsFromBundles(bundles)     [0 WCL]
├── runUtilityObservedShadowPass (mode=shadow)
│     ├── score OBSERVED_CONTRIBUTION when evidence present
│     └── else SKIPPED_NO_PERSISTED_EVIDENCE
├── persist utility-observed-shadow-v1 (admin only)
├── mergeObservationsWithLastKnownGood               [LKG Utility preserved]
└── calculateScore(mergedObservations)               [public Trust — unchanged]
```

Compatible second refresh: shared evidence cache/persist hits → `providerCalls=0` detailed event calls.

## 3. Active-combat denominator

| Item | Value |
|------|-------|
| Algorithm | Sort hostile event timestamps; split windows where gap > threshold; sum (last−first + pad) |
| Gap threshold | **15_000 ms** |
| Fallback | &lt;3 events **or** activity coverage &lt;20% of fight → use fight `durationMs` |
| Dungeon sensitivity | Travel-heavy keys shrink denominator → higher per-hour rates when activity windows apply |
| WCL calls | **Zero** (persisted timestamps only) |

## 4. Family scoring (no hidden floor)

Utility is a weighted average of **included** Ability Catalog families (renormalized when a family is not applicable, unused-optional, or talent-uncertain). Candidate defaults:

- interrupt 0.28 / crowdControl 0.18 / dispelPurge 0.16 / groupSupport 0.18 / movement 0.10 / combatRes 0.05 / bloodlust 0.05
- family saturation curves vs active combat hours (not fight-duration/cooldown)
- unmatched interrupt credit share is capped so spam cannot saturate Interrupt

No arbitrary class-specific bonuses. Spec-by-spec weight tables are out of scope.

## 5. Production-safe vs experimental boundary

| Layer | Cherry-pickable | Notes |
|-------|-----------------|-------|
| Shared evidence ingest | yes (`a8240a0`) | Survival + Utility datasets |
| OBSERVED_CONTRIBUTION + shadow | yes (this milestone) | Publication-safe |
| OPPORTUNITY_RESEARCH / V3.2 miss model | experimental | Offline only — do not merge into publication |
| Calibration / probe tooling | experimental tooling | Artifacts under `raw-artifacts/` |

## 6. Remaining blockers before `published`

1. Shared evidence must be ingested in refresh for selected runs (utility datasets present).
2. Stratified panel ≥30 characters (local dataset currently insufficient).
3. Role/class bias sign-off after expanded calibration.
4. Explicit product decision: UNAVAILABLE vs genuine 0/low-conf for zero applicable usage (current calculator: unused applicable toolkit → 0; missing facts → UNAVAILABLE).
5. Implement `published` path (replace legacy combat-facts Utility) behind flag + migration.
6. Confirm Trust authenticity/confidence blend with one-sided Utility.
