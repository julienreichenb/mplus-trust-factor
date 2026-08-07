---
status: proposed
normative: true
last_reviewed: 2026-08-01
repository: julienreichenb/mplus-trust-factor
baseline_main: 0b0d911f9c4f3ec771bd8f2390e972da01595f99
calibration_draft_branch: agent/11-scoring-calibration-study
calibration_draft_head_observed: 5603d4b8f01375599fa0bb71255b98d775cd8e4d
---


# Experience scoring specification

## 1. Meaning

Experience estimates durable familiarity with Mythic+ and high-level progression. It is not current execution quality.

Experience can use Blizzard/local history without WCL detailed events and may complete in parallel with WCL analysis.

## 2. Phase 1 components

Candidate composition:

```text
45% current durable exposure
30% previous-season strength
15% elite title/achievement history
10% exceptional historical ranking
```

Unavailable optional components are not zero-filled. Confidence and weights are renormalized according to evidence-state policy.

## 3. Current durable exposure

Retain and refine current Experience V2 signals:

- active dungeon breadth;
- key-level band breadth;
- participation depth;
- historical season count;
- activity recency.

Use canonical run history and Blizzard profile data. Do not use current WCL parses.

The current key-band definitions may remain initially but are versioned and season-aware.

## 4. Previous-season strength

Primary source order:

1. Blizzard prior-season Mythic Keystone profile;
2. durable local prior-season score/run history;
3. Raider.IO prior-season score when enabled and compatible.

Evidence states:

- `HAS_VALUE`;
- `CONFIRMED_NO_ACTIVITY`;
- `PARTIAL`;
- `PROVIDER_FAILURE`;
- `UNKNOWN`.

Normalize score using a versioned prior-season distribution or manual thresholds. Provider failure is not equivalent to no activity.

## 5. Elite title/achievement history

Maintain a versioned catalog:

```ts
interface EliteAchievementCatalogEntry {
  achievementId: number;
  seasonIdOrSlug: string;
  title: string;
  percentile: number;
  regionScope: string | null;
  evidenceSemantics: string;
  version: string;
}
```

Character achievement responses may expose account-visible completion. Store evidence state and avoid claiming character-specific completion unless supported.

Multiple titles use diminishing returns. One confirmed 0.1% title should be a strong signal but not override the whole dimension.

## 6. Exceptional historical ranking

Potential signals:

- top 10 class/spec region;
- top 0.1% or top 1% historical rank;
- season cutoff achievement.

Source priority:

1. durable local leaderboard snapshots;
2. Blizzard leaderboard data;
3. Raider.IO historical ranks/cutoffs.

Persist season, region, class, spec, role, rank, population/percentile when known, source, and fetch timestamp.

## 7. Phase 1 formulas

### Exposure

Use current Experience V2 weighted metrics or a compatible successor.

### Previous season

Candidate monotonic curve:

- confirmed no activity: low score, not necessarily zero;
- moderate score: middle range;
- high score near seasonal K90/K99: strong score;
- clamp 0–100.

Exact thresholds come from a Season Difficulty/Experience Policy.

### Elite history

Candidate:

- no confirmed title: unavailable/low based on evidence state;
- one confirmed top 0.1% title: 90;
- multiple recent titles: approach 100 with diminishing returns;
- old title decays mildly but remains meaningful.

### Historical rank

Map percentile/rank to 0–100 with season population and source confidence.

## 8. Confidence

Inputs:

- current run-history completeness;
- previous-season provider state;
- achievement visibility semantics;
- historical ranking source quality;
- season binding;
- spec/role compatibility;
- recency.

Experience can have high confidence without WCL logs when Blizzard/local history is complete.

## 9. Phase 2 — verified account-linked characters

Only user-authorized Battle.net-linked characters are eligible.

Policy candidate:

```text
accountExperienceBoost =
  bounded function(best compatible linked-character experience,
                   class/spec similarity,
                   recency,
                   ownership confidence)

finalExperience =
  70% character experience
  + up to 30% account-linked boost
```

Constraints:

- a never-played alt cannot inherit a perfect score;
- same-class/spec history receives more relevance than unrelated class;
- linked-character identities remain private by default;
- revoked/stale ownership is excluded;
- public API exposes only derived contribution if user policy allows it.

## 10. Double-counting controls

Experience MUST NOT duplicate:

- current Performance parse quality;
- current Mythic+ score as a dominant component;
- Survival/Utility actions;
- authenticity/boost heuristics.

Prior-season strength is intentionally historical and capped.

## 11. Explanation payload

Expose:

- current exposure components;
- previous-season source/state/value;
- elite achievement evidence state;
- historical rank source and season;
- account-linked contribution state without leaking identities;
- confidence and missing evidence reasons.
