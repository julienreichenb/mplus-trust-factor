# Agent 02 — Build One Dynamic Real-Season Binding

## Goal

Make Experience use one canonical current/previous real Mythic+ season binding that survives the imminent and all future season rollovers.

Use Agent 01 findings. Do not invent a second season authority.

## Current season

The existing authoritative current-season mechanism must remain the source of truth.

Experience must consume/reuse it.

No:
- Midnight-specific constants;
- Blizzard season arithmetic;
- fixed RIO current slug;
- "8 dungeons means current season" logic.

## Previous real Mythic+ season

Resolve the immediately preceding real Mythic+ season chronologically from canonical/persisted season authority data.

Requirements:
- same-region correctness;
- cross-expansion correctness;
- deterministic tie/ambiguity handling;
- no event/intermediate Raider.IO season can become previous;
- corrupt/ambiguous dates fail closed.

## Raider.IO season binding

Bind Raider.IO data to the selected Blizzard/internal previous season.

Preferred proof:
- explicit provider season identity if available;
- otherwise deterministic date/season metadata mapping with ambiguity rejection.

Generic `previous` profile data may only be used after the agent proves it corresponds to that exact bound season.

If exact-season regional class rank requires a different RIO query/path, implement the smallest correct provider capability rather than reusing an ambiguous shorthand.

Do not use an event season because it is "the previous RIO item".

## Rollover lifecycle

Fix the lifecycle so Experience does not depend on worker startup having happened after the season changed.

When canonical season authority changes from N to N+1:
- Experience must resolve N as the new previous real season;
- season-level metadata/policy required for N can be lazily or transition-synchronized;
- this must not trigger per-character cutoff fetches;
- stale N-1 evidence must not be mistaken for N.

Prefer a season-level "ensure historical season metadata/policy ready" operation keyed by region+season.

## Tests

Required provider-free tests:
1. same-expansion N -> N+1;
2. cross-expansion last season -> next expansion S1;
3. inserted Break-the-Meta/event RIO season between two real seasons;
4. pre-patch-like interval;
5. duplicate/tied date candidates;
6. long-lived worker / authority rollover without restart;
7. no hard-coded current live ID/slug in selection behavior.

## Invariants

Do not change Experience score mapping yet except as necessary for typed season identity.
Do not touch P/S/U.

Update handoff, commit, stop.
