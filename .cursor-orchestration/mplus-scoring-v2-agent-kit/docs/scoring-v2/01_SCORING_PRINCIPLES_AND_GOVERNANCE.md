---
status: proposed
normative: true
last_reviewed: 2026-08-01
repository: julienreichenb/mplus-trust-factor
baseline_main: 0b0d911f9c4f3ec771bd8f2390e972da01595f99
calibration_draft_branch: agent/11-scoring-calibration-study
calibration_draft_head_observed: 5603d4b8f01375599fa0bb71255b98d775cd8e4d
---


# Scoring principles and governance

## 1. Product objective

M+ Trust Factor estimates whether a Mythic+ character is a reliable group member through four distinct dimensions:

- **Performance**: class/spec execution and damage or role-appropriate output.
- **Survival**: deaths, defensive behavior, emergency recovery, and exposure to avoidable pressure.
- **Utility**: observed contribution through interrupts, crowd control, dispels, externals, group cooldowns, and strategic tools.
- **Experience**: durable Mythic+ exposure, prior-season strength, elite history, and verified account-level experience.

The system is not a universal player ranking. Each dimension must preserve its own meaning and avoid double-counting another dimension.

## 2. Non-negotiable invariants

### 2.1 Evidence

- Performance, Survival, and Utility MUST consume the same immutable selected-run manifest.
- The target sample is two distinct WCL runs per active dungeon.
- Selection MUST NOT use the target performance parse, survival result, utility volume, or resulting score.
- Missing logs MUST NOT be converted to a zero metric.
- Public scores MUST expose evidence coverage and confidence.
- Any provider response used by a public score MUST be traceable by request fingerprint, payload/artifact hash, fetched time, and schema/adapter version.

### 2.2 Reproducibility

A score computation is reproducible only when the following are frozen:

- character identity and specialization/role scope;
- season and active dungeon pool;
- selected-run manifest;
- WCL report code, fight ID, and revision;
- evidence artifacts and normalized fact-set fingerprints;
- ability and mechanic catalog versions;
- season difficulty policy;
- dimension algorithm versions and coefficients;
- score model configuration;
- evidence cutoff and provider-data-as-of timestamps.

Recalculation against newer data creates a new computation. It never mutates a published historical snapshot.

### 2.3 Separation of concerns

The target architecture has five layers:

1. **Provider payload layer** — immutable raw responses or compressed artifacts.
2. **Canonical evidence layer** — selected runs, actors, report/fight metadata, event datasets.
3. **Normalized fact layer** — deaths, parses, pressure windows, cooldown activations, attempts, successes, toolkit availability.
4. **Metric and dimension layer** — normalized metrics, confidence, dimension scores.
5. **Publication layer** — immutable overall score, rank, explanation, and current pointer.

Provider adapters MUST NOT contain score weights. Scoring code MUST NOT call providers.

### 2.4 Versioning

Every semantic transformation MUST have a version:

- provider schema adapter;
- candidate discovery;
- run selector;
- evidence bundle schema;
- fact extractor;
- ability catalog;
- mechanic catalog;
- dimension algorithm;
- confidence algorithm;
- overall score model;
- calibration report schema.

Versions are content-addressed or explicit immutable identifiers. Editing an active version in place is prohibited.

## 3. Dimension boundaries

### Performance includes

- WCL same-bracket parse percentiles;
- WCL profile best and median aggregates;
- difficulty-adjusted execution;
- offensive cooldown use in Phase 2.

Performance excludes:

- deaths;
- defensive behavior;
- interrupt or support volume;
- general current-season run breadth;
- account-linked alt history.

### Survival includes

- deaths;
- defensive and immunity activations;
- low-health self-recovery;
- relative avoidable damage where evidence is reliable;
- timing and availability context in Phase 2.

Survival excludes raw DPS/HPS and overall Mythic+ score.

### Utility includes

- player-attributable cast stops;
- crowd control;
- dispels/purges;
- group cooldowns and externals;
- strategic movement/positioning tools when auditable.

Utility excludes personal defensives and ordinary rotational damage abilities.

### Experience includes

- current and historical participation;
- prior-season Mythic+ score;
- elite titles/achievements with evidence-state semantics;
- exceptional historical rankings;
- verified account-linked experience in Phase 2.

Experience MUST NOT use current WCL parse quality.

## 4. Score semantics

All dimension scores use a 0–100 presentation scale, but 50 does not have identical statistical meaning in every phase:

- Phase 1 Performance can be approximately execution-centered after calibration.
- Phase 1 Utility is an observed-contribution score; without opportunity modeling, zero observable contribution remains neutral/low-confidence rather than automatically bad.
- Survival is behavioral and outcome-based, not a population percentile.
- Experience is an exposure index, not an execution percentile.

The UI and API MUST expose these semantics.

## 5. Governance roles

- **Data contract owner**: provider schemas, evidence and artifact compatibility.
- **Scoring owner**: dimension formulas and score model versions.
- **Catalog owner**: class/spec abilities, talents, mechanics.
- **Calibration owner**: cohort labels, exclusions, reports, activation recommendations.
- **Operations owner**: rate limits, queue health, retention, rollback.
- **Product owner**: publication thresholds and player-facing explanations.

One actor may hold multiple roles during development, but approvals remain logically separate.

## 6. Change control

Any scoring-impacting PR MUST contain:

- a change classification: provider, evidence, extractor, formula, confidence, publication, or presentation;
- version bumps;
- backward compatibility or destructive-reset plan;
- fixture updates;
- calibration comparison;
- expected score movement;
- rollback conditions;
- confirmation that labels were not derived from scores.

## 7. Anti-leakage rules

Calibration and reference cohorts MUST NOT:

- auto-label from current score, rank, or dimension values;
- select evidence based on whether it supports the expected label;
- include multiple identities of the same account across train/test splits without grouping;
- use a model to define its own positive reference cohort;
- query providers during replay;
- silently replace unavailable evidence with newer evidence.

## 8. Phase boundaries

### Phase 0 — architecture and evidence

No public score changes. Introduce V2 contracts, manifests, artifacts, fact sets, and observability.

### Phase 1 — deterministic absolute scoring

Implement fixed, explainable models that can operate without platform-wide population statistics.

### Phase 2 — contextual analysis

Model cooldown availability, encounter timing, missed opportunities, anticipation/reaction, and mitigation effects.

### Phase 3 — population-relative comparison

Enable comparisons against sufficient, stable, stratified reference populations. Until critical mass is proven, these features remain disabled or shadow-only.
