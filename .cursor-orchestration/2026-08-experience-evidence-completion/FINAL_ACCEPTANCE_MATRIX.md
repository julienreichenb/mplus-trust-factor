# Final Acceptance Matrix

| Area | Required proof | Pass condition | Agent 05 result |
|---|---|---|---|
| Current season | canonical authority trace | provider/DB authority, no hard-coded season | **PASS** — Blizzard `current_season` **17** / internal `blizzard-season-17` (`965c666a-…`) / RIO `season-mn-1` |
| Previous season | chronology + real-season filter | exact immediately previous real M+ season | **PASS** — Blizzard **15** / `blizzard-season-15` (`1e41c326-…`) / RIO `season-tww-3`; fixture `pub-cancel-season` rejected via `/^blizzard-season-\d+$/` filter |
| Cross-expansion | synthetic fixture | last old-expansion season selected before new S1 | **PASS** — Agent 02 suite + Agent 05 invented N→N+1/cross-expansion coverage |
| Event seasons | synthetic RIO event row | never selected as previous real season | **PASS** — `isRealMythicPlusRaiderIoSeason` + Agent 05 invented event slug rejected |
| Blizzard rating | cold runtime | first source used when available | **PASS** (fixtures); Wallidrixe live Blizzard historical **404** → fallback path |
| RIO rating fallback | forced Blizzard failure fixture | exact-season fallback only, explicit provenance | **PASS** — Wallidrixe `RAIDERIO_FALLBACK` on exact `season-tww-3`; ambiguous generic previous rank unused |
| Historical immutability | 2nd recalc | previous rating provider calls = 0 | **PASS** — warm Blizzard hist=0, RIO hist=0, achievements=0 |
| RIO class rank | exact-season proof | regional class rank from same previous real season | **ACCEPTABLE LIMITATION** — no safely season-bound source; fail-closed (`classRankFloor=null`); not claimed complete |
| Native cutoffs | policy diagnostics | native quantile/band identity preserved | **PASS** — v2 COMPLETE policy p999…p600; productive path discrete bands only |
| No activity | null/0 fixtures | E=0 available | **PASS** — Wallidrixe `CONFIRMED_NO_ACTIVITY` → E=0 available confidence 1 |
| Contradiction | 0 + runs fixture | unavailable explicit cause | **PASS** — Agent 05 + Agent 03 suites |
| Population persistence | warm recalc | cutoff provider call = 0 on character hist path | **PASS** — warm/replay hist cutoffs not re-fetched for character; season LKG reused |
| Experience replay | provider-disabled replay | Blizzard=0, RIO=0, WCL=0, identical E | **PASS** — replay identical E=0; hist providers 0 |
| Season rollover | invented N -> N+1 fixture | N automatically becomes previous | **PASS** — Agent 05 acceptance (no process restart; no Midnight hard-codes) |
| Stale evidence | rollover fixture | N-1 not reused for N | **PASS** — evidence keyed by exact season; N-1 cannot satisfy N |
| Wallidrixe | real product path | E resolves or exact irreducible blocker proven | **PASS** — E=0 via proven no activity (not special-cased) |
| CharacterScore | DB read | E score/confidence/causes persisted | **PASS** — id `8e736310-…`; experience=0; details + `standingProvenance` |
| API/snapshot | DTO | matches CharacterScore; E confidence from details | **PASS** — `character-score-read` tests + persisted details shape |
| P/S/U | audit baseline comparison | no scoring regression | **PASS** — P≈94.960 / S≈72.933 / U=62.3 unchanged; composite ~70.691 (E=0 now participates; was ~78.545 when E unavailable) |
| CI | lint/build/tests | green | **PASS** — see Agent 05 handoff validation block |
| DB migration | `20260809180000_character_experience_evidence` | applies cleanly; Prisma aligned | **PASS** — migrate status up to date; table/unique/FKs verified |
| Process restart | durable DB evidence | hist providers remain 0 after cache clear | **PASS** — shared-Map restart sim in Agent 05 acceptance |
| Productive interpolation | no `interpolateTopPercent` / `scoreFromEstimatedTopPercent` | unused on production Experience standing | **PASS** — Agent 05 productive-path grep/test |

## Wallidrixe live call matrix (Experience historical)

| Path | Blizzard historical | Achievements | RIO historical |
|------|---------------------|--------------|----------------|
| COLD | 1 | 1 | 1 |
| WARM | 0 | 0 | 0 |
| REPLAY | 0 | 0 | 0 |

Season-authority / bootstrap index+cutoff calls may still run under TTL; they are not counted as historical Experience regressions.

## Verdict

**MERGE READY** — with known limitation: exact previous-season regional class rank remains unavailable (fail-closed; not represented as completed proof).
