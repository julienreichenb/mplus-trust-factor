# LATEST HANDOFF — Agent 03B (Blizzard character M+ history) — corrective pass

**Branch:** `fix/scoring-stabilization`  
**Status:** Historical character Blizzard dataset: **FIXED IN CODE / READY FOR 03C** (after corrective simplify).

Do **not** claim the Experience UI bug is fixed — Agent 03C owns Experience calculation.  
Do **not** start Agent 04 / 03C from this handoff alone without product gate.

## Corrective semantics (accepted)

1. **Index absence ≠ no activity.** Blizzard docs do **not** explicitly guarantee that missing a season from Profile Index `seasons[]` means zero M+ activity. Absence → **UNKNOWN** (no evidence row). `CONFIRMED_NO_ACTIVITY` only from a successful Season Details payload under existing mapping rules.
2. **Call strategy (KISS):** every Experience acquisition with providers allowed:
   - Profile Index ×1
   - Season Details ×N only for **returned** closed seasons still missing terminal evidence
3. **No magic season-id range** (`1..999`). Authority = index season ids + internal Season mapping + closed/current flags/dates.
4. Kept: `mythic_rating` extraction, immutable evidence, no migration, exact Season map, cross-expansion, partial cache, zero RIO character calls, 03A catalog untouched.

## Next

**Agent 03C** — Experience calculation using Blizzard history + 03A population context.
