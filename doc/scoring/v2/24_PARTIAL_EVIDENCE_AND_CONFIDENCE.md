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

Missing-dungeon-first hydration:

1. Prefer stubs known to map to dungeons with 0 candidates
2. Then dungeons with 1 candidate
3. Unknown-dungeon stubs via bounded round-robin (not newest-24 only)
4. Already-complete dungeons last
5. Stop at full coverage or budget exhaustion; emit `omittedReports` with exact reason

Do not infer that a run does not exist merely because it was not hydrated.

## Manifest revision

Incomplete frozen manifests may be superseded by a new frozen document that merges prior SELECTED source fights with newly discovered candidates. Completed manifests are never mutated in place.
