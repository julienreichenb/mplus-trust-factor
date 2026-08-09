# Agent 03 — Persist Immutable Historical Experience Evidence

## Goal

Make completed-season Experience evidence "acquire once, reuse forever" where the underlying fact is immutable.

This is the main provider-efficiency + replay step.

## Historical rating acquisition contract

For a character + exact previous real season:

### Primary
Call Blizzard exact-season profile first when no compatible successful evidence exists.

### Exceptional fallback
Only if Blizzard genuinely fails/unavailable:
- use Raider.IO only if Agent 02 can bind the RIO score to the exact same real season;
- record source as an explicit fallback;
- never silently prefer RIO.

### Terminal successful states
Persist:
- positive/real rating;
- confirmed no activity;
- exceptional exact-season Raider.IO fallback rating/no-activity if product-safe.

Once persisted successfully:
- no normal TTL;
- no automatic refetch on Experience recalculation;
- no Blizzard call on warm;
- no Raider.IO call on warm;
- no provider call on replay.

Transient provider failure is not immutable evidence and must remain retryable.

## Persist all evidence required for deterministic Experience

Audit existing persistence first.

Durable reusable evidence must cover:
- character identity;
- internal historical season id;
- Blizzard season id;
- canonical RIO season slug where relevant;
- rating value/state;
- rating source `BLIZZARD` vs `RAIDERIO_FALLBACK`;
- regional class rank + exact season provenance;
- native cutoff/policy version/hash + region + exact season;
- elite historical evidence required by calculator;
- provider/schema/normalizer compatibility versions;
- source payload/provenance references where available.

Do not use the final CharacterScore as the historical evidence cache.

If generic persisted ProviderResult artifacts cannot be indexed/reconstructed safely, add the smallest dedicated historical Experience evidence model. Explain why.

## Population policy lifecycle

A closed-season regional cutoff policy is also immutable for product purposes once the provider's final usable policy is accepted.

It should be:
- stored once per region + real season;
- shared across characters;
- not fetched on every character score;
- invalidated only by explicit repair/schema compatibility or if the stored policy is known incomplete/non-final according to verified provider semantics.

## Previous class rank

Persist exact previous-season regional class rank per character+season once successfully resolved.

Do not reuse generic current/previous profile shorthand without persisted season identity.

## Elite evidence

Provider-free replay must not need an achievements call.

Persist the minimal historical elite-title proof needed by Experience.
Design refresh semantics so a season rollover can discover newly historical elite titles without calling achievements on every recalculation.

Do not overbuild an achievement warehouse.

## Replay read path

Add a provider-free Experience evidence read/reconstruction path used by the authoritative scorer.

REPLAY must reconstruct identical:
- score;
- availability;
- confidence;
- causes;
- source/provenance.

## Tests

Required call-count tests:
- cold historical rating -> Blizzard 1;
- second recalc -> Blizzard 0 / RIO 0;
- Blizzard failure + exact-season RIO fallback -> explicit fallback and persisted;
- fallback warm -> all historical rating calls 0;
- transient failure without successful evidence -> later attempt may retry;
- replay -> Blizzard 0 / RIO 0 / WCL 0;
- season rollover -> new previous season causes acquisition for the new character-season only;
- old successful historical season fact remains reusable.

Update handoff, commit, stop.
