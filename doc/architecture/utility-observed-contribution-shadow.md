# Utility OBSERVED_CONTRIBUTION — Score Semantics & Shadow Mode

**Branch:** `agent/wave4.5-wcl-utility-probe`  
**Status:** Production-safe shadow candidate — **not** public Trust publication.

## 1. Final score semantics

OBSERVED_CONTRIBUTION is an **observed-positive-contribution** score, **not** a complete personal utility-efficiency score.

| Rule | Behavior |
|------|----------|
| Observed useful actions | May raise score **above** neutral (50) |
| Absence of observed action | Must **not** lower any domain or aggregate **below** 50 |
| Zero attributable evidence | Remains **50** with **low** confidence (≤35) |
| Missed opportunities | **Not measured** (range/LoS unobservable) |
| SUCCESS_OTHER_PLAYER | **Never** credited |
| Toolkit-inapplicable domains | **Neutral** (excluded from weight share); must **not** reduce confidence as “missing evidence” |

Trust weight remains **25%** (unchanged). One-sided suitability for that weight: **conditional** — OK for shadow diagnostics; not yet OK for publication without broader bias validation. Approx max skill impact vs neutral 50 if published at contribution caps: **~4 skill points** (`0.25 × ~16`). Players with no observable evidence should stay **UNAVAILABLE** (preferred) or 50/low-conf — never below 50.

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

## 4. Domain dominance mitigation (panel-justified)

Support previously dominated because contribution was capped **before** weight renormalization, amplifying single-domain scores. Fix:

- Cap **after** weight share
- One-sided contributions ≥ 0
- Milder support curve + `diminishingExponent=0.75`
- Weights: castStops 0.45 / support 0.28 / strategicCc 0.27

No arbitrary class-specific bonuses.

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
4. Explicit product decision: UNAVAILABLE vs 50/low-conf for zero evidence.
5. Implement `published` path (replace legacy combat-facts Utility) behind flag + migration.
6. Confirm Trust authenticity/confidence blend with one-sided Utility.
