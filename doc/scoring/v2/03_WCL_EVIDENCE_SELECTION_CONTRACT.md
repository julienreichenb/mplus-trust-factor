---
status: proposed
normative: true
last_reviewed: 2026-08-01
repository: julienreichenb/mplus-trust-factor
baseline_main: 0b0d911f9c4f3ec771bd8f2390e972da01595f99
calibration_draft_branch: agent/11-scoring-calibration-study
calibration_draft_head_observed: 5603d4b8f01375599fa0bb71255b98d775cd8e4d
---


# WCL Evidence Selection Contract V2

## 1. Purpose

The selection contract determines exactly which public WCL runs may influence detailed scoring. It is dimension-neutral and executes before any detailed event analysis.

Target:

```text
active dungeon count × 2 distinct selected runs
```

For an eight-dungeon season, the target is 16 slots.

## 2. Scope key

A selection is unique for:

```text
characterId
seasonId
specializationId or explicit role scope
refreshContractHash
selectorVersion
evidenceCutoffAt
```

Changing any field creates a new manifest.

## 3. Candidate discovery

Candidate sources:

1. WCL character zone rankings/parse rows.
2. WCL recent public reports.
3. Existing canonical runs with WCL source references.
4. Optional cross-provider run metadata for matching only.

Candidate discovery MUST be bounded but sufficiently deep to support fallback. A target of two valid runs per dungeon generally requires retaining more than two candidates per dungeon.

Initial bounds:

- retain up to 10 ranked candidates per active dungeon;
- retain up to 80 total candidates;
- hydrate only selected/fallback reports lazily;
- increase bounds only through measured coverage audits.

## 4. Candidate identity

A WCL candidate identity is:

```text
reportCode + fightId
```

After hydration, compatibility also includes report revision. Two slots may not use the same report/fight pair.

## 5. Eligibility gates

A candidate is selectable only when all mandatory metadata is known:

- public visibility;
- report accessible to application credentials;
- non-archived or event-accessible;
- fight exists;
- fight is Mythic+ (`keystoneLevel > 0`);
- target player actor resolved in report `masterData` by normalized name + realm;
- **and** the resolved report-local actor ID is present in `fight.friendlyPlayers`
  (ownership proof — never accept from report-wide actors alone);
- active-season dungeon mapped;
- key level known;
- fight duration positive and bounded;
- report/fight is not duplicate;
- spec/role compatible with scoring scope;
- report revision known before final manifest freeze;
- no hard provider/schema error.

`timed` may be unknown for scoring dimensions that do not require timer state, but the unknown state must be retained.

## 6. Deterministic ordering

Candidates are sorted per dungeon by:

1. key level descending;
2. run completion/timer quality when available;
3. canonical run score descending when comparable;
4. evidence completeness score descending;
5. completion timestamp descending;
6. report code lexical;
7. fight ID ascending.

The final lexical/numeric tie-breakers make selection deterministic.

Performance parse, deaths, utility actions, resulting score, or expected calibration label MUST NOT appear in ordering.

## 7. Fallback algorithm

Pseudocode:

```ts
for dungeon in activeDungeonPool:
  ordered = sort(eligibleMetadataCandidates[dungeon])
  selected = []

  for candidate in ordered:
    hydrated = hydrateReportAndFight(candidate)

    if not hydrated.metadataValid:
      recordRejection(candidate, reason)
      continue

    if selected contains same reportCode/fightId:
      continue

    selected.push(hydrated)

    if selected.length == 2:
      break

  freeze two slots, or fewer when candidates exhausted
```

Detailed datasets are fetched after metadata selection. If a selected run is invalid for all detailed dimensions due to event access or truncation, the planner MAY promote the next fallback candidate before manifest finalization.

After finalization, replacement creates a new manifest revision; it does not mutate the frozen manifest.

## 8. Selection slot states

```ts
type EvidenceSlotState =
  | "SELECTED"
  | "MISSING_NO_CANDIDATE"
  | "MISSING_PRIVATE_OR_HIDDEN"
  | "MISSING_ARCHIVED_OR_GATED"
  | "MISSING_IDENTITY_UNRESOLVED"
  | "MISSING_SCHEMA_UNSUPPORTED"
  | "MISSING_RATE_DEFERRED";
```

Each selected slot also records dimension validity:

```ts
type DimensionValidity = {
  performance: "VALID" | "PARTIAL" | "INVALID";
  survival: "VALID" | "PARTIAL" | "INVALID";
  utility: "VALID" | "PARTIAL" | "INVALID";
  reasons: string[];
};
```

## 9. Manifest structure

```ts
interface CharacterSeasonEvidenceManifestV2 {
  schemaVersion: "2.0.0";
  selectorVersion: string;
  characterId: string;
  seasonId: string;
  seasonSlug: string;
  specSlug: string | null;
  role: "DPS" | "TANK" | "HEALER";
  refreshContractHash: string;
  evidenceCutoffAt: string;
  highKeyPolicyId: string;
  activeDungeonSlugs: string[];
  expectedSlotCount: number;
  selectedSlotCount: number;
  selectedAt: string;
  slots: EvidenceSlotV2[];
  rejectedCandidates: CandidateRejectionSummary[];
  coverage: EvidenceCoverageV2;
  contentHash: string;
}
```

The content hash excludes no scoring-relevant field.

## 10. Coverage

Initial deterministic states:

| State | Criteria |
|---|---|
| `FULL` | 100% slots selected, all active dungeons represented |
| `STRONG` | ≥75% slots and ≥87.5% dungeons represented |
| `PARTIAL` | ≥50% slots and ≥75% dungeons represented |
| `INSUFFICIENT` | below `PARTIAL` |

For an eight-dungeon season:

- FULL: 16 runs / 8 dungeons;
- STRONG: ≥12 runs / ≥7 dungeons;
- PARTIAL: ≥8 runs / ≥6 dungeons.

Dimension-specific coverage may be lower after dataset validation.

## 11. Shared-run invariant

Performance, Survival, and Utility MUST reference manifest slot IDs. They MUST NOT reselect runs.

A dimension may omit an invalid slot but cannot substitute another run independently. A substitution requires a new manifest revision.

## 12. Season changes

The active dungeon pool comes from Blizzard season authority and versioned catalog bindings. The selector must not hardcode eight as a universal count. Two runs per dungeon remains the default policy.

## 13. Current-system replacement

Current selectors that choose one Performance run, up to three Survival runs, or one shared run per dungeon are transitional. V2 replaces them with one manifest and two slots per dungeon.

Legacy selectors MAY remain behind a V1 feature flag until the V2 shadow comparison completes.

## 14. Required tests

- two highest valid runs selected;
- second slot falls back to a lower key;
- parse value cannot alter selection;
- hidden, archived, missing actor, wrong season, wrong spec rejected;
- deterministic ties;
- no duplicate report/fight;
- active dungeon pool enforced;
- fewer than two logs represented honestly;
- same manifest consumed by all dimensions;
- frozen manifest immutable;
- hash changes on any relevant input;
- no provider call during selector replay from frozen candidate metadata.
