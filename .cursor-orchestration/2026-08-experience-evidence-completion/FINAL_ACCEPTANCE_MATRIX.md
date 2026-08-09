# Final Acceptance Matrix

| Area | Required proof | Pass condition |
|---|---|---|
| Current season | canonical authority trace | provider/DB authority, no hard-coded season |
| Previous season | chronology + real-season filter | exact immediately previous real M+ season |
| Cross-expansion | synthetic fixture | last old-expansion season selected before new S1 |
| Event seasons | synthetic RIO event row | never selected as previous real season |
| Blizzard rating | cold runtime | first source used when available |
| RIO rating fallback | forced Blizzard failure fixture | exact-season fallback only, explicit provenance |
| Historical immutability | 2nd recalc | previous rating provider calls = 0 |
| RIO class rank | exact-season proof | regional class rank from same previous real season |
| Native cutoffs | policy diagnostics | native quantile/band identity preserved |
| No activity | null/0 fixtures | E=0 available |
| Contradiction | 0 + runs fixture | unavailable explicit cause |
| Population persistence | warm recalc | cutoff provider call = 0 |
| Experience replay | provider-disabled replay | Blizzard=0, RIO=0, WCL=0, identical E |
| Season rollover | invented N -> N+1 fixture | N automatically becomes previous |
| Stale evidence | rollover fixture | N-1 not reused for N |
| Wallidrixe | real product path | E resolves or exact irreducible blocker proven |
| CharacterScore | DB read | E score/confidence/causes persisted |
| API/snapshot | DTO | matches CharacterScore |
| P/S/U | audit baseline comparison | no scoring regression |
| CI | lint/build/tests | green |
