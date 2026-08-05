# Partial evidence analysis and confidence (scoring-confidence-v1)

Status: active implementation note  
Normative companion: [`11_CONFIDENCE_COVERAGE_PUBLICATION.md`](./11_CONFIDENCE_COVERAGE_PUBLICATION.md)

## Separate three gates

| Gate | Meaning |
|------|---------|
| Evidence target completeness | `targetRunCount = activeDungeonCount × 2` (Midnight S1 → 16) |
| Analysis eligibility | At least one usable selected run (`PARTIAL` or `COMPLETE`) |
| Publication eligibility | Independent; `SCORING_V2_PUBLICATION_ENABLED` remains false for canary |

`PARTIAL` manifests **must** run dimension calculators. Missing runs are never zero-filled.

Manifest analysis status:

- `EMPTY` — zero usable runs → dimensions `UNAVAILABLE`
- `PARTIAL` — 1 .. target−1 → calculate with confidence metadata
- `COMPLETE` — target reached

## scoring-confidence-v1

```text
runCoverage     = min(usableRunCount / targetRunCount, 1)
dungeonCoverage = min(representedDungeonCount / activeDungeonCount, 1)
confidenceScore = round(100 * sqrt(runCoverage * dungeonCoverage))
```

Bands: HIGH 85–100 · MEDIUM 60–84 · LOW 1–59 · NONE 0

Overall composite confidence = **minimum** of included dimension confidences.

Store `policyVersion`, counts, and coverages in score lineage.

## Discovery / hydration

Initial coverage-aware budget (`INITIAL_HYDRATION_BUDGET` = 24) is a first-pass
sample only — never a terminal correctness ceiling.

Iterative hydration (approach B — progressive exhaustion of unknown stubs):

1. List and persist all report stubs (`dungeonSlug` is typically null before hydration)
2. Hydrate the initial bounded batch
3. Rebuild candidates and selection
4. While any dungeon has fewer than two distinct candidates, unhydrated stubs remain,
   and rate admission allows OK/WARN: hydrate the next
   `INCREMENTAL_HYDRATION_BATCH_SIZE` (6) batch, then rebuild
5. Terminal states only: full coverage · reports exhausted · DEFER/STOP · provider error

Missing-dungeon-first applies only when a stub’s dungeon is known (hints/prior).
Unknown stubs use deterministic newest/oldest alternation across batches — a middle-
position report must eventually be hydrated if slots remain missing.

Emit `omittedReports` with exact reason plus iterative diagnostics
(`terminalHydrationReason`, batch counts, `reportsRemaining`).

Do not infer that a run does not exist merely because it was not hydrated.

## Manifest revision

Incomplete frozen manifests may be superseded by a new frozen document that merges prior SELECTED source fights with newly discovered candidates. Completed manifests are never mutated in place.
