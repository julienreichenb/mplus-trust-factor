# Locked Product Decisions

These decisions were explicitly confirmed by the product owner. Agents must not silently reinterpret them.

## 1. Previous-season rating source

- Blizzard is the primary / authoritative source.
- Raider.IO is allowed as a fallback only when Blizzard genuinely fails to provide the exact previous-season evidence.
- The fallback is exceptional and must be visible in provenance / diagnostics.
- Do not prefer Raider.IO merely because it is easier to query.
- Do not blend Blizzard and Raider.IO ratings.

### Historical immutability

A completed season's character rating is immutable.

Once a character + exact historical season has a successfully resolved rating state:
- persist it durably;
- reuse it for every later Experience recalculation;
- do not automatically call Blizzard or Raider.IO again for that character-season;
- only explicit repair/migration/contract invalidation may force reacquisition.

Transient provider failures are not terminal evidence and may be retried later.

## 2. Dynamic season lifecycle

Never hard-code:
- Midnight Season 1;
- Blizzard season 17;
- a fixed current season slug;
- `currentSeasonId - 1`;
- a fixed number of dungeons as a way to identify a season.

The application is about to cross a real season boundary and must continue working automatically.

Current season must come from the canonical season authority. Previous season is the immediately preceding real Mythic+ season, resolved from authoritative season metadata / chronology.

This must work:
- within one expansion;
- across expansion boundaries;
- after process restart;
- while a long-lived worker crosses a season boundary without restart.

## 3. Raider.IO "previous season" / class rank

Experience requires the **regional class rank of the exact previous real Mythic+ season**.

Raider.IO can expose intermediate/event-like periods (e.g. Break the Meta, pre-patch-like periods). These must never replace the real previous season.

Do not trust a generic `previous` shorthand unless its semantics are proven to refer to the exact canonical previous Mythic+ season selected by the product.

If the current endpoint cannot season-bind class rank:
1. inspect official Raider.IO contract / existing provider capabilities;
2. find the narrowest season-specific source;
3. fail closed rather than using a rank from the wrong season;
4. report a real provider blocker if exact-season rank is genuinely impossible.

## 4. Population standing

Base standing calculations on Raider.IO's **native cutoff bands / quantiles**.

Do not invent a second set of product percentile cutoffs and do not extrapolate into percentile ranges that Raider.IO did not provide.

Current provider fixtures expose native cutoffs such as:
- `p999`
- `p990`
- `p900`
- `p750`
- `p600`

The exact mapping implementation must follow the verified provider contract.

Preserve the existing product intent that stronger native bands produce stronger Experience standing scores. Do not retune unrelated class-rank floors, elite floor, global dimension weights or grade thresholds in this chantier.

## 5. No-activity edge

Required mapping:

- `rating = null/0` AND provider proves no runs/activity for the exact historical season:
  `CONFIRMED_NO_ACTIVITY` -> Experience standing 0, available.
- `rating = 0` with season runs/activity present:
  contradictory evidence -> unavailable / explicit cause.
- provider failure or ambiguous absence:
  unavailable, never 0.
- never turn a no-activity representation into a synthetic low-standing score.

## 6. Persistence required for Experience

Persist all evidence needed to deterministically recalculate Experience.

At minimum the durable lineage must make it possible to reconstruct:
- exact previous real season binding;
- historical rating + source (Blizzard or exceptional RIO fallback);
- native Raider.IO cutoff policy / band data + region + season identity;
- exact previous-season regional class rank and its season provenance;
- historical elite-title evidence required by the calculator;
- compatibility/schema/source versions;
- evidence timestamps / source payload references as appropriate.

Prefer existing durable persistence where it supports indexed compatible reads. If it does not, a minimal dedicated historical Experience evidence record is allowed and must be justified.

Do not persist only the final Experience score as a substitute for evidence.

## 7. Scope

This chantier ends with:
- correct Experience evidence acquisition;
- immutable historical persistence;
- provider-free replay;
- real-character E2E validation;
- CharacterScore/API correctness;
- season-rollover regression proof.

It does NOT include:
- frontend explainability/timeline UI;
- P/S/U retuning;
- WCL event-call optimization;
- Trust Score weight changes.
