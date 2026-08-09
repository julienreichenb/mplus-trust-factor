# Global Directives

## Scope discipline

This chantier is only about Experience evidence correctness, season lifecycle, persistence and replay.

Do not redesign Performance, Survival or Utility.
Do not retune:
- P/S/U formulas;
- Trust Score weights;
- grade thresholds;
- class-rank Experience floors;
- historical elite floor;
- overall weakest-link confidence policy.

Standing logic may be surgically simplified to use verified Raider.IO native cutoff bands because that is an explicit product decision.

## Single authoritative product path

Preserve:

`refresh / recalculate -> runAuthoritativeScoring -> scoreCharacter -> CharacterScore -> API/snapshot`

Do not create an alternate Experience scoring workflow.

Current-season resolution must reuse the repository's existing season authority rather than introducing a second "what season is current?" implementation.

## Historical evidence lifecycle

Completed-season evidence is historical and immutable once successfully resolved.

Design for:
- acquire once;
- persist;
- read many times;
- no TTL-based refetch of a successful closed-season character rating;
- no provider call simply because the user recalculates Experience.

A transient provider failure is not a successful immutable fact.

## Provider priority

Previous real-season rating:
1. Blizzard exact-season evidence.
2. Raider.IO exact-season fallback only if Blizzard fails.

Fallback must carry explicit source/provenance.

Population cutoffs and previous regional class rank may use Raider.IO, but only after exact season binding.

## Season correctness

Never:
- subtract 1 from a Blizzard season ID;
- hard-code Midnight S1/S2;
- assume a generic Raider.IO `previous` field is the selected season;
- select event/intermediate seasons as the real previous season.

Prefer Blizzard season authority + chronological season metadata, then bind Raider.IO data to the selected canonical season.

## Replay

Provider-free Experience replay is a product invariant.

After successful cold acquisition, a pure recalculation must be able to produce the same Experience result with:
- WCL calls = 0;
- Blizzard calls = 0;
- Raider.IO calls = 0.

## Persistence

Reuse existing provider/artifact/Season metadata infrastructure if it supports deterministic indexed reads and compatibility checks.

A minimal dedicated historical Experience evidence model is allowed if generic provider payload storage cannot safely answer:
- which character?
- which exact season?
- which source?
- which evidence version?
- can this evidence be reused without a provider call?

Do not introduce speculative abstractions.

## Tests

Required tests must include a **future season rollover fixture** whose IDs/slugs are not the current live season values.

The test must prove the algorithm, not today's data.

## Git / orchestration

One worktree/branch for the whole chantier.
Agents run sequentially.
Every agent:
- reads latest handoff;
- performs only its step;
- runs focused validation;
- updates `LATEST_HANDOFF.md`;
- commits;
- stops.
