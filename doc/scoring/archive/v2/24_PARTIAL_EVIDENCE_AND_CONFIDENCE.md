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

### Mutable WCL report revision lineage

WCL `report.revision` is authoritative and mutable after a fight is published.
Source identity is always `reportCode + fightId + reportRevision`.

**Do not default an unknown revision to `1`.** Unresolved revision fails closed with
`REPORT_REVISION_UNRESOLVED`.

Discovery / hydration must persist the revision returned by
`ReportWithFightAndMasterData` into candidate metadata, ranking evidence, and
frozen manifest slots.

When a frozen complete manifest still holds stale revisions (e.g. all slots at
`1` while live metadata reports higher values), the consolidated canary pipeline
runs metadata-only reconciliation automatically (see
[`25_OPERATOR_SURFACE_AND_PIPELINE.md`](./25_OPERATOR_SURFACE_AND_PIPELINE.md)).

This stage:

1. loads the current compatible frozen manifest;
2. fetches report metadata only (no capability event pages);
3. creates a **new** superseding manifest when any revision differs;
4. preserves `reportCode` / `fightId` / slot assignment;
5. records `supersedesManifestId`, previous/new revision, and diagnostics.

Compatible packages whose revision still matches remain cache hits. Corrected
revision identities require new acquisitions (at most the mismatch count).

## Ranking lineage across manifest supersedes

`EvidenceDataset` ranking_parse rows are slot-owned but keyed by
`reportCode:fightId:reportRevision` compatibility. When a revision-reconcile
supersede creates new slots:

- unchanged identities **carry forward** READY ranking descriptors (same artifact);
- changed revisions **never** reuse incompatible prior-revision ranking;
- the prior frozen manifest document and its slots remain immutable;
- rebind is idempotent and may run again against the latest superseding manifest.

Provider-free preflight treats `rankingFactsMissing` as a **cold digest rebuild**
gap (package HIT + digest ABSENT + ranking ABSENT). When digests already exist,
slot-level `rankingMissing` may still be true without inflating
`rankingFactsMissing`.

### Target-character digest identity

WCL `actorId` is report-local. After revision supersedes, resolve the requested
character via stable identity (canonical Character ID + normalized
region/realm/name + WCL run source digest roster), not discovery actor IDs alone.

Operator diagnostics and provider-free replay:

```bash
pnpm scoring-v2:doctor -- --region EU --realm archimonde --character <name>
pnpm scoring-v2:replay -- --region EU --realm archimonde --character <name>
```

Ranking metadata hydrate and package integrity supersession run automatically
inside `pnpm scoring-v2:canary` (armed with `--confirm-execute`).

### Partial live scoring

Isolated fight failures (including historical revision mismatches) must **not**
globally block dimensions with `fight_processing_failed` when usable character
digests exist. Calculate dimensions from available digests, attach
`scoring-confidence-v1`, set `analysisStatus=PARTIAL` when
`usableRunCount < targetRunCount`, and return `PARTIAL_SUCCESS` without publishing.

`missingDungeons` is derived from active season slugs minus dungeons represented
in usable digests (never left empty when coverage is incomplete).
