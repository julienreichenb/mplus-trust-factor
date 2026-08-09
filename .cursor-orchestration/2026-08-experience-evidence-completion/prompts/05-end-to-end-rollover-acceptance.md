# Agent 05 — Four-Dimension E2E + Season-Rollover Acceptance

## Goal

Validate the finished Experience lifecycle and decide merge readiness.

## Real Wallidrixe acceptance

Run the authoritative product path for Wallidrixe-Archimonde EU.

Report:
- canonical current real Mythic+ season;
- exact previous real Mythic+ season;
- proof no event/intermediate season was selected;
- previous rating value/state;
- rating source: Blizzard or exceptional RIO fallback;
- whether that rating came from provider or persisted immutable evidence;
- exact RIO season identity;
- exact previous regional class rank + season proof;
- native cutoff policy/band;
- elite history;
- final Experience score;
- Experience confidence/causes;
- CharacterScore id/version;
- API/snapshot E projection;
- P/S/U and final composite/tier.

If Blizzard works, Wallidrixe should not unnecessarily use RIO rating fallback.

## Historical call-count acceptance

Prove this sequence:

### First compatible cold
Acquire missing historical facts only.

Report separate call counts:
- Blizzard season authority;
- Blizzard historical rating;
- Blizzard achievements;
- Raider.IO static/season binding;
- Raider.IO historical rating fallback;
- Raider.IO class rank;
- Raider.IO cutoffs;
- WCL.

### Second recalculation
For already-resolved historical character-season facts:
- historical Blizzard rating calls = 0;
- historical RIO rating calls = 0;
- repeated season cutoff call = 0 when compatible persisted policy exists;
- previous class-rank call = 0 if already persisted;
- same Experience result.

### Provider-free replay
- Blizzard = 0;
- Raider.IO = 0;
- WCL = 0;
- Experience identical.

## Mandatory future-rollover acceptance

Do not rely only on today's live season.

Create a provider-free integration fixture:
- current real season N;
- previous real season N-1;
- inserted event/intermediate RIO period around them;
- advance authority to invented season N+1;
- prove N becomes previous;
- prove N-1 historical evidence does not bleed into N;
- prove old N-1 facts remain persisted and reusable if explicitly requested;
- prove no code depends on Midnight S1/S2 identifiers.

The fixture IDs/slugs must be invented/future-like, not copied from current production constants.

## Mandatory regression fixtures

- confirmed no activity -> E=0 available;
- rating=0 + activity -> unavailable contradiction;
- positive Blizzard rating -> native cutoff standing;
- Blizzard failure + exact-season RIO fallback -> valid explicit fallback;
- Blizzard success + conflicting RIO -> Blizzard authoritative;
- exact previous regional class-rank floor;
- historical elite floor;
- wrong-season RIO class rank -> rejected;
- event season -> rejected;
- provider failure without fallback -> unavailable;
- replay from persistence -> identical E;
- stale incompatible evidence -> not reused.

## P/S/U regression

Report exact P/S/U scores/confidence for the Wallidrixe acceptance run and compare to audit baseline.

No formula retune is allowed to "make numbers match".

## CI

Run:
- focused Experience suites;
- worker/api builds;
- lint;
- repository CI-equivalent test suite where practical.

## Final handoff

State:
- MERGE READY or NOT READY;
- exact remaining limitations;
- runtime call counts;
- persistence model/keys;
- season rollover proof;
- whether frontend explainability can now safely be the next chantier.

Commit, stop.
