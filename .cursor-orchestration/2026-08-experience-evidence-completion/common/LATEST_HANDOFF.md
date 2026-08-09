# Latest Handoff

## Step
Agent 02 complete — dynamic real Mythic+ season binding + RIO bind + rollover ensure.

## Product decisions locked
See `PRODUCT_DECISIONS.md` (unchanged). Agent 02 applied the additional locked decisions from the orchestration instruction (Blizzard authority, no hard-coded season, exact previous real M+ only, event seasons excluded, slug regex not authority, class-rank fail-closed, remapped cutoffs not LKG unless equivalence proven, do not assume `raiderIoProfile`, long-lived N→N+1 without restart).

## Agent 02 outcomes

### Season-binding architecture
- **Current** remains Blizzard `season_index.current_season` via existing season authority / `ensureBlizzardCurrentSeason` (no second authority).
- **Previous** remains chronological Blizzard/DB selection (`pickPreviousSeasonByStartTimestamp` / `resolvePreviousMythicSeason`) — never `id-1`.
- **RIO bind** now prefers `isMainSeason` + `blizzardSeasonId` + dates (`matchBlizzardSeasonToRaiderIoByDates`). Slug regex is diagnostic only (`isCanonicalRaiderIoSeasonSlug`).
- Bootstrap writes `providerSeasonId` from Blizzard→RIO match (same-expansion first, then previous-expansion static), not from unfiltered RIO chronological previous.
- Contracts/normalize retain `isMainSeason`, `blizzardSeasonId`, and cutoffs `isRemappedSeason`.

### Exact RIO class-rank conclusion
- Raider.IO exposes only profile `previous_mythic_plus_ranks` with **no season id** in schema/payload; no exact-season class-rank endpoint found.
- Production path **fails closed**: `previousRegionalClassRankFromRioProfile` returns null unless `exactSeasonProven: true` (never set in refresh-bridge today).
- This is a real provider blocker for previous-season class-rank floor until RIO (or another source) can prove exact-season identity.

### Event-season handling
- `resolveRaiderIoCurrentAndPrevious` defaults to real main seasons only (`isMainSeason === true`).
- Unfiltered mode kept only for trap diagnostics (`{ unfiltered: true }`).
- Break-the-Meta / cutoffs / remix cannot become Experience previous.

### Rollover proof
- Process-local `shouldEnsureExperienceSeasonBinding` / `ensureExperienceSeasonBindingReady`.
- Wired into refresh after season authority flip and remembered after startup bootstrap.
- Provider-free test proves same-process N→N+1 re-triggers ensure without restart.

### Wallidrixe / no-activity preservation
- Corroboration requires bound previous RIO slug match (`seasonBound`); does not hard-code Wallidrixe.
- Missing `raiderIoProfile` → no corroboration (fail closed), not assumed present.
- Remapped cutoffs refuse new LKG unless `exactTargetSeasonEquivalenceProven`.

### Files changed (high signal)
- `packages/contracts/src/raiderio.ts`
- `packages/providers/raiderio/src/{raw-types,normalize,normalize.test}.ts`
- `apps/worker/src/orchestration/scoring/experience-season-bootstrap.ts` (+ tests)
- `apps/worker/src/orchestration/scoring/experience-season-rollover.audit.test.ts`
- `apps/worker/src/orchestration/scoring/experience-phase1.ts` (+ tests)
- `apps/worker/src/orchestration/scoring/experience-previous-season-evidence.ts` (+ tests)
- `apps/worker/src/orchestration/scoring/experience-season-population-policy-sync.ts` (+ tests)
- `apps/worker/src/orchestration/scoring/refresh-bridge.ts`
- `apps/worker/src/orchestration/refresh-pipeline.ts`
- `apps/worker/src/orchestration/scoring/experience-class-rank.live.example.test.ts`

### Tests run
`vitest` focused suites: rollover audit, bootstrap, phase1, previous-season evidence, population-policy sync, raiderio normalize — **92 passed**.

## Blockers / questions for Agent 03
1. Persist immutable character+exact-previous-season Experience evidence (Agent 03 scope).
2. Class-rank floor remains unavailable until exact-season rank source exists (or product accepts permanent omit).
3. Remapped historical cutoffs currently refuse LKG — Agent 03/04 standing path must decide durable native-band policy + whether any remapped feed can be proven equivalent.
4. Confirm refresh always has `providerSeasonId` bound before Experience corroboration (ensure path soft-fails; 404 without bound slug stays uncorroborated).
5. Do **not** change P/S/U formulas; native cutoff band scoring simplification is still later (Agent 04 per original plan / Agent 01 note).

## Baseline
Preserve P/S/U baseline in `AUDIT_BASELINE.md`. No P/S/U formula changes in Agent 02.

## Start instruction for Agent 03
Read this handoff + `PRODUCT_DECISIONS.md` + Agent 02 season-binding APIs. Implement immutable historical Experience evidence persistence / replay lineage only. Do not start Agent 04.
