# Wave 4 — Scoring v3 specification

Status: design baseline, weights provisional until calibration.

## 1. Shared current-season run set

All current execution dimensions use the same eight-run set, one canonical run per active-season dungeon.

```ts
type ScoringRunSelection = {
  seasonSlug: string;
  expectedDungeonCount: number;
  selectedRuns: Array<{
    dungeonSlug: string;
    canonicalRunId: string;
    keyLevel: number;
    timed: boolean | null;
    completedAt: string;
    durationMs: number | null;
    raiderIoScore: number | null;
    wclReportMatched: boolean;
    wclCoverageRatio: number | null;
    selectionReason: "HIGHEST_KEY" | "HIGHEST_SCORE_TIEBREAK" | "LATEST_TIEBREAK";
  }>;
};
```

Rules:

- Historical and lower-key runs do not enter current Performance, Survival or Utility.
- Missing WCL detail produces missing observations and lower confidence, not zero.
- Every selected run must remain traceable to its canonical source references.

## 2. Performance v3

### Goal

Reward strong execution **and** meaningful key difficulty. An excellent parse in a medium key must not automatically outrank a strong parse in a substantially harder key.

### Per-dungeon inputs

- WCL parse percentile for the selected highest-key run.
- Key difficulty score for the same run.
- Timed/depleted state as context, not a hidden parse replacement.

Prefer WCL bracket-aware rankings when available. Build key difficulty from season-relative Raider.IO/Blizzard data, not a permanent hard-coded key ceiling.

### Initial formula

```text
runPerformance = 0.65 × executionPercentile
               + 0.35 × keyDifficultyPercentile

Performance = equal-weight mean(runPerformance across available dungeons)
```

Key difficulty must be normalized inside the current season and region. A recommended implementation is interpolation between published/derived season cutoffs, with a bounded fallback based on the active-season run distribution.

### Confidence

Performance confidence considers:

- selected dungeons with a valid parse;
- key-difficulty normalization availability;
- WCL coverage and freshness;
- resolved spec and role;
- eight-dungeon coverage.

### Required explanation

For every dungeon expose:

- selected highest key;
- parse percentile;
- key difficulty percentile;
- resulting runPerformance;
- source and confidence.

## 3. Survival v3

### Initial internal weights

| Contributor | Weight |
|---|---:|
| Deaths | 35% |
| Avoidable damage | 30% |
| Personal defensive usage | 20% |
| Self-healing and healing potion | 15% |

Unavailable contributors are removed and the available weights are renormalized. A missing metric never scores zero.

### Deaths

Collect player death events for the selected fight. Normalize by dungeon, key bracket, role/spec and duration where cohort data exists. Zero deaths should be strong but should not alone guarantee a perfect Survival score.

### Avoidable damage

Requires a versioned mechanic catalog mapping enemy ability IDs to avoidability and severity. Compute damage relative to player max health and dungeon duration. Do not label all damage taken as avoidable.

### Personal defensives

Use a versioned class/spec ability catalog. Count valid personal defensive casts/buffs and estimate available uses from effective cooldown and run duration. Cap credit to avoid rewarding meaningless spam. A later refinement may require danger-window context.

### Self-healing and potion

Track effective self-healing, overheal, self-heal casts and healing-potion use. Credit healing performed while health was missing; do not reward pure overheal.

## 4. Utility v3

### Initial internal weights

| Contributor | Weight |
|---|---:|
| Interrupt activity and success | 40% |
| Crowd control coverage | 25% |
| Group support / externals | 20% |
| Defensive and offensive dispels | 15% |

Weights are capability-aware. If a spec cannot perform one category, remove it and renormalize the others.

### Interrupts

Resolve the actual interrupt available from class, spec, talents and pet/loadout.

```text
availableKickWindows ≈ runDuration / effectiveKickCooldown
kickActivity = bounded(kickCasts / availableKickWindows)
kickSuccess = successfulInterrupts / max(kickCasts, 1)
interruptScore = 0.70 × kickActivityScore + 0.30 × kickSuccessScore
```

All kick casts count as activity, including unsuccessful attempts, while successful interrupt events provide a quality modifier. The implementation must not assume one static cooldown per class.

### Crowd control

Count distinct hostile actor instances affected by a catalogued CC from the player during the run. Reapplying control to the same actor does not increase the raw unique-target count. For v3, do not require proof that the CC stopped a cast.

### Group support / externals

Count catalogued group-support abilities such as Demonic Gateway, Blessing of Sacrifice and Rallying Cry. Normalize by capability and available uses. Some abilities may only expose a cast/summon rather than confirmed party usage; label that limitation.

### Dispels

Use successful WCL dispel events and classify defensive versus offensive dispels. Only include the contributor when the active spec/loadout has the relevant capability.

## 5. Experience v3

### Critical feasibility rule

Do not assume WCL can publicly enumerate every reroll belonging to an arbitrary player. WCL `canonicalID` follows rename/transfer identity for the same character; it is not an account-wide alt graph. Account-linked experience therefore needs verified linkage or a provider-supported public main/alt relationship.

### Recommended two-mode model

**Public character mode**

- current character, all available Mythic+ seasons;
- season-normalized rating/percentile;
- no inferred alts.

**Verified account mode**

- user-authorized or explicitly claimed character list;
- all verified characters and available seasons;
- visible “verified account experience” label.

### Provisional formula for verified mode

| Contributor | Weight |
|---|---:|
| Current-season account peak | 45% |
| Current-season breadth with diminishing returns | 25% |
| Historical peak, season-normalized | 20% |
| Longevity across active seasons | 10% |

Never compare raw Legion-era and current ratings directly. Convert each season to percentile/rank or a season-specific normalized scale first. Old exceptional ranks may retain value through a bounded age-decay floor.

## 6. Global score v3

Initial proposal:

```text
SkillScore = 35% Performance
           + 30% Survival
           + 25% Utility
           + 10% Experience
```

Renormalize only at the **global dimension** level when a dimension is genuinely unavailable. Keep Confidence separate and continue to use UNRATED below the configured threshold.

## 7. Versioning

- Create scoring model `default@3`.
- Preserve v1 and v2 snapshots.
- Persist formula/catalog versions with observations.
- Never silently recalculate historical snapshots under v3.
