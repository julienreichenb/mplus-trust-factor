# Scoring dimensions

**Status:** normative. Calculators consume **canonical digests**, never raw WCL pages.

## Digests

`CharacterRunDigest` stores offensive, utility, and survival digests for each fight participant:

- Unique key: `rawRunId + participantActorId + extractorVersion`
- `characterId` is optional (nullable internal Character link; never auto-created)
- Identity metadata on the row / digest: `characterName`, `realmSlug`, `regionCode`, `classSlug`, `specSlug`, `role`
- Actor IDs are fight/report-local; name + realm + region support later Character attachment without WCL refetch

A changed extractor version recalculates digests from cached raw data and does **not** re-fetch WCL unless the raw payload lacks required source data.

One capability package / raw run can produce five durable digests so later requests for another participant reuse cache (zero additional WCL calls).

## Dimensions

| Dimension | Primary inputs | Missing-data rule |
|-----------|----------------|-------------------|
| Performance | Offensive digest + ranking facts | Ranking absence affects Performance only |
| Utility | Utility digest | Missing utility facts affect Utility only |
| Survival | Survival digest | Missing survival facts affect Survival only |
| Experience | Retained when implementation is ready | Optional; may be null |

Do not change formulas merely to simplify infrastructure. Partial evidence is dimension-local: no zero-filled runs.

## Ranking facts

`RunRankingFact` is a normal cached dependency keyed by `rawRunId + characterId + rankingVersion`.

- Provider-enabled: load cache → fetch missing → persist → score Performance.
- Provider-free replay: use persisted facts; mark Performance partial/unavailable when needed.

## Composite and confidence

Composite is available when required dimensions have usable scores.

Confidence reflects usable selected runs, represented dungeons, and active dungeon count (see `computeScoringConfidenceV1` / `overallConfidenceFromDimensions` in `@mplus/scoring`). Overall composite confidence is the minimum of included dimension confidences unless a concrete defect requires a documented change.
