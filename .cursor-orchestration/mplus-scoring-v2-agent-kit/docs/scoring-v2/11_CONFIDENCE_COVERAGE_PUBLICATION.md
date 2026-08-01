---
status: proposed
normative: true
last_reviewed: 2026-08-01
repository: julienreichenb/mplus-trust-factor
baseline_main: 0b0d911f9c4f3ec771bd8f2390e972da01595f99
calibration_draft_branch: agent/11-scoring-calibration-study
calibration_draft_head_observed: 5603d4b8f01375599fa0bb71255b98d775cd8e4d
---


# Confidence, coverage, and publication

## 1. Separate score from confidence

A dimension score answers “what does the available evidence indicate?” Confidence answers “how representative and reliable is that indication?”

Confidence MUST NOT be hidden inside the score through arbitrary penalties.

## 2. Coverage layers

Track independently:

1. profile aggregate coverage;
2. candidate discovery coverage;
3. selected manifest coverage;
4. dataset coverage;
5. fact extractor coverage;
6. per-dimension metric coverage;
7. overall model coverage.

Public APIs MUST expose at least selected/analyzed runs and dungeon coverage.

## 3. Dimension confidence inputs

### Performance

- valid detailed slots;
- two-run dungeon share;
- active dungeon breadth;
- profile aggregate presence;
- spec/role adapter validity;
- partition/season compatibility;
- high-key policy confidence;
- freshness.

### Survival

- valid slots;
- deaths/damage/health coverage;
- pressure-cluster mode;
- defensive/self-heal catalog coverage;
- mechanic exclusion coverage;
- relative-damage reliability.

### Utility

- valid slots;
- active-combat hours;
- attributable events;
- hostile casts;
- toolkit catalog coverage;
- mechanic/opportunity coverage;
- pet attribution.

### Experience

- run-history depth;
- prior-season state;
- achievement semantics;
- ranking source quality;
- linked-account ownership confidence.

## 4. Confidence formula pattern

Each dimension defines versioned components in [0,1]:

```text
confidence =
  weighted mean of evidence-quality components
  × semantic-mode factor
  × identity/season compatibility factor
```

Hard caps apply for known limitations.

Confidence algorithms are calibrated but do not derive labels.

## 5. Publication states

```text
DRAFT
SHADOW
CANDIDATE
PUBLISHED
SUPERSEDED
REJECTED_INCOMPLETE
REJECTED_INCOHERENT
```

- `SHADOW`: stored and observable by admins, never public.
- `CANDIDATE`: passed technical gates but not current public pointer.
- `PUBLISHED`: public pointer target.
- rejected states retain diagnostics.

## 6. Evidence quality gates

Initial Phase 1 gates:

### Full public V2

- manifest coverage `FULL` or `STRONG`;
- required identity/season compatibility;
- no required dataset truncation;
- at least six active dungeons with valid detailed evidence;
- dimension confidence above model threshold;
- scoring model active and compatible;
- coherence validation pass.

### Provisional public V2

Optional product policy:

- manifest coverage `PARTIAL`;
- explicit provisional badge;
- confidence capped;
- no S-tier/public top-rank eligibility;
- explanation states missing slots.

### Insufficient

- retain last known good compatible public score; or
- publish dimension unavailable/U according to freshness policy.

Never silently replace unavailable V2 evidence with unrelated V1 semantics.

## 7. Last known good

Reuse only when:

- same season and spec/role scope;
- compatible model/evidence contract;
- within freshness limit;
- not revoked by provider visibility/privacy;
- clearly marked as older provider data.

The new refresh failure is recorded independently.

## 8. Overall score and rank

The overall model combines dimension scores only after per-dimension states are resolved.

Rules:

- unavailable dimensions are not zero;
- missing mandatory dimension may block overall publication;
- weights renormalize only when the model explicitly permits;
- rank thresholds are model-versioned;
- population-relative rank thresholds are distinct from fixed score bands.

## 9. Explanation requirements

Every public score response includes:

- calculation/model version;
- provider data as of;
- selected/analyzed run counts;
- represented/expected dungeon counts;
- each dimension score/confidence/state;
- top contributors;
- limitations;
- provisional/stale state;
- current versus previous snapshot timestamp.

Report codes and sensitive raw identifiers remain admin-only or sanitized.

## 10. Coherence checks

Block publication when:

- dimensions reference different manifests;
- report revision mismatch;
- season/dungeon mismatch;
- score model or catalog version missing;
- input fingerprint mismatch;
- confidence outside bounds;
- score outside bounds;
- required fact set missing;
- calibration-only or shadow algorithm marked public;
- provider call occurred during replay/finalization.

## 11. Rank eligibility

Candidate defaults:

- S rank requires high overall confidence and no provisional dimension;
- A rank requires strong confidence;
- low confidence caps maximum rank;
- U represents unavailable/unranked, not bad;
- rank eligibility and score value are distinct outputs.

Exact thresholds are determined through calibration and product policy.
