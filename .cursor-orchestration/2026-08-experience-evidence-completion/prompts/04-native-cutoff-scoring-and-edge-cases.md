# Agent 04 — Native Raider.IO Cutoff Scoring + Experience Edge Cases

## Goal

Simplify previous-season standing so it is based directly on verified Raider.IO native cutoff bands and close the semantic edge cases.

## Native cutoff rule

Do not invent unsupported percentile positions.

Start from the native cutoff representation proven by Agent 01.

Current fixtures expose provider-native quantiles such as:
- p999
- p990
- p900
- p750
- p600

Replace unnecessary product percentile interpolation / extrapolation with a deterministic native-band classification if that matches the verified provider contract.

Preserve product scoring intent:
- strongest native band -> strongest standing score;
- successively weaker native bands -> existing descending Experience standing tiers;
- below the weakest supported native cutoff may use the existing low standing floor only when the provider actually exposes that weakest boundary;
- no activity remains 0.

Do not retune class-rank floors or elite floor.

If the exact numerical standing tier mapping is already encoded and matches native bands, reuse it rather than inventing new numbers.

## Required no-activity mapping

Lock with tests:

- rating null + zero runs / explicit provider absence -> `CONFIRMED_NO_ACTIVITY`;
- rating 0 + zero runs / explicit absence -> `CONFIRMED_NO_ACTIVITY`;
- rating 0 + non-empty activity -> `CONTRADICTORY_PAYLOAD`;
- provider exception/404 without trustworthy exact-season corroboration -> unavailable;
- never turn an absence representation into low-standing floor 25.

## Blizzard vs RIO contradiction

When both exact-season sources exist:
- Blizzard wins;
- contradiction is diagnostic;
- do not average;
- do not silently overwrite persisted Blizzard evidence with fallback.

A RIO fallback is only used after Blizzard failure, never as a normal alternate.

## Class-rank edge cases

Preserve confirmed product floors:
- rank <=5 -> 100
- <=10 -> 97
- <=20 -> 94
- <=50 -> 90
- <=100 -> 85
- >100 / absent -> no floor

But rank must be exact previous real season + regional class rank, not overall rank.

## Elite edge cases

Preserve:
- actual historical seasonal 0.1% title only;
- floor 90 forever;
- successful empty elite evidence != provider failure;
- elite provider failure cannot invalidate another valid proof already >=90.

## Character identity edge cases

Audit:
- character rename;
- realm transfer;
- region transfer;
- duplicate names.

Historical evidence must not be attached to the wrong character. Prefer stable internal character identity plus provider identity lineage; fail closed where provider identity cannot be reconciled.

## Confidence/provenance

Expose machine-readable Experience diagnostics:
- current/previous season ids/slugs;
- rating state/value/source;
- `BLIZZARD` vs `RAIDERIO_FALLBACK`;
- native RIO cutoff band used;
- class-rank value/floor/source season;
- elite count/floor;
- confidence + causes;
- unavailable/contradiction reason.

Do not build frontend UI.

## Tests

Table-driven coverage for all above.
Run core scoreCharacter/API regression.
Update handoff, commit, stop.
