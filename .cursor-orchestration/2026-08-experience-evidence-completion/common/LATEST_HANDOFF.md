# Latest Handoff

## Step
Agent 01 complete — audit dynamic season + historical provider semantics.

## Product decisions locked
See `PRODUCT_DECISIONS.md` (unchanged).

## Agent 01 outcomes

### Root causes
1. **Wallidrixe:** Blizzard previous season **15** profile is **404**; RIO `previous` = `season-tww-3` score **0**; previous class ranks all **0**. Without RIO corroboration on the Experience path → `PREVIOUS_EVIDENCE_UNAVAILABLE`. With corroboration → should be `CONFIRMED_NO_ACTIVITY` / E=0 (not a hidden high previous score).
2. **RIO `previous` alias** is relative shorthand (OpenAPI), not Blizzard-bound; normalizer trusts array index `[1]`.
3. **Event-season trap:** unfiltered chronological RIO previous selects **Break-the-Meta** when MN2 becomes current; canonical/`is_main_season` filters select real MN1. Same-expansion bootstrap bind uses the unfiltered helper.
4. **Experience bootstrap is startup-scoped**; season authority TTL refreshes current, but previous RIO slug + population policy for the *new* previous season may not re-sync mid-process.
5. **Cutoffs:** `p999…p600` are provider-native; repo remaps to `topPercent` and interpolates (product wants native bands).

### Proven season algorithm
- Current = Blizzard `season_index.current_season` via `synchronizeSeasonAuthority` / `ensureBlizzardCurrentSeason`.
- Previous = latest same-region season by `startsAt` (never `id-1`). Live: current **17**, previous **15** (no 16 in index).
- RIO bind must use main-season filtering + exact slugs; do not trust `current:previous` alone.

### Deliverables
- `common/AGENT01_AUDIT.md`
- `common/AGENT01_WALLIDRIXE_RUNTIME.json`
- `apps/worker/src/orchestration/scoring/experience-season-rollover.audit.test.ts`
- optional diagnostic: `common/_wallidrixe-provider-audit.mjs`

### Recommendations for Agent 02
See audit § “Recommended minimal implementation”. First fix: season-correct RIO binding (prefer `is_main_season` / date match; exact season slugs; fail closed on unbound class rank).

### Blockers / questions for Agent 02
1. Exact-season regional class rank source on Raider.IO?
2. Treat `is_main_season:true` non-regex slugs (e.g. `season-tww-1-post`) as real seasons?
3. Remapped historical cutoffs usable for LKG policy?
4. Confirm refresh always supplies `raiderIoProfile` for Blizzard 404 corroboration.

## Baseline
Preserve P/S/U baseline in `AUDIT_BASELINE.md`. No formula changes in Agent 01.

## Start instruction for Agent 02
Read this handoff + `AGENT01_AUDIT.md` + `PRODUCT_DECISIONS.md`. Implement season-correct previous binding / RIO semantics only. Do not start Agent 03.
