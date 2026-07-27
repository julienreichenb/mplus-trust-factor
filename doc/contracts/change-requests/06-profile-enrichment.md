# Agent 6 — Profile response enrichment

## Problem

`CharacterProfileResponse` in `@mplus/contracts` is insufficient for the MVP profile page. Missing fields:

- class / spec / role
- item level
- analyzed run summaries (latest / highest with dungeon, key, date, performance, coverage)
- equipment / talents summaries
- historical season summary
- entitlements / field visibility
- structured incomplete-data warnings

## Proposal (Agent 5)

Extend `CharacterProfileResponse` (or add `CharacterProfileDetailResponse`) with:

```ts
classSlug: string | null;
specSlug: string | null;
role: "DPS" | "TANK" | "HEALER" | null;
itemLevel: number | null;
lastAnalyzedRun: AnalyzedRunSummary | null;
highestAnalyzedRun: AnalyzedRunSummary | null; // same object ref / id when deduped
equipment: { averageItemLevel: number | null; keyItems: Array<{ slot: string; name: string; itemLevel: number | null }> } | null;
talents: { specializationSlug: string | null; loadoutCode: string | null; summary: string | null } | null;
seasonSummary: { seasonSlug: string; runCount: number; mythicRating: number | null; priorSeasonRating: number | null } | null;
entitlements: { detailsUnlocked: boolean; runsUnlocked: boolean; compareExpanded: boolean };
warnings: Array<{ code: string; message: string; severity: "INFO" | "WARN" }>;
```

## Interim

Frontend uses local `CharacterProfileView` in `apps/web` composing contract DTOs + enrichments. Mock mode serves this shape today.

## Compatibility

Additive / optional fields only. No breaking change to existing keys.
