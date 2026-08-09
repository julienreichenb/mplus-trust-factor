# Latest Handoff

## Step
Agent 03 complete (amended) — immutable historical Experience evidence + dedicated exact-season RIO fallback + A/B/C absence semantics.

## Product decisions locked
See `PRODUCT_DECISIONS.md` (unchanged). Agent 02 season binding remains authoritative.

## Agent 03 outcomes

### Persistence architecture
- Dedicated model `CharacterExperienceEvidence` (unchanged from first Agent 03 land).
- Population policy remains on `Season.metadata.experiencePopulationPolicy`.

### Durable evidence keys
`@@unique([characterId, seasonId, evidenceKind, compatibilityVersion])` — unchanged.

### Blizzard / RIO fallback (production-grade)
Acquisition order:
1. compatible persisted evidence
2. Blizzard exact historical season
3. **Dedicated** Raider.IO exact historical season HTTP (not optional)
4. unavailable

Exact RIO request (OpenAPI v0.62.5):

```text
GET /api/v1/characters/profile
fields=mythic_plus_scores_by_season:<exact-slug>,mythic_plus_dungeon_run_counts:<exact-slug>
```

- Provider method: `getCharacterExactSeasonHistoricalRating`
- Rejects `current` / `previous` aliases; matches requested slug in scores array (not array index).
- Preloaded refresh profile may be reused **only** when it already proves the exact slug **and** score > 0.
- Score 0/null from a preloaded profile alone does **not** skip the dedicated call (no activity proof).
- Successful Blizzard → dedicated RIO rating calls = 0.
- Persist successful fallback with `source = RAIDERIO_FALLBACK`.

### Exact zero/null semantics (locked A/B/C)
OpenAPI defines `scores.all` as a required number and does **not** document `0` as “no activity”.
Activity proof uses `mythic_plus_dungeon_run_counts:<slug>` (zero-filled dungeon pool):

| Case | Result |
|------|--------|
| score > 0 | `HAS_VALUE` / RAIDERIO_FALLBACK |
| score 0/null + `PROVEN_NONE` (total season runs = 0) | `CONFIRMED_NO_ACTIVITY` |
| score 0 + `PROVEN_ACTIVITY` (total season runs > 0) | `CONTRADICTORY_PAYLOAD` → unavailable |
| score 0/null + `UNKNOWN` (counts absent) | `UNRESOLVED` → unavailable, **not** E=0 |

### Wallidrixe
Agent 01: Blizzard previous 404 + exact `season-tww-3` score 0 (score-only).
Under amended Agent 03 rules, score 0 alone is **not** forced to E=0.
With the dedicated fallback (scores + dungeon run counts):
- if RIO returns zero-filled counts totaling 0 → `CONFIRMED_NO_ACTIVITY` / E=0 available;
- if counts are missing/unusable → remains unavailable (evidence-correct).
No special-case by character name. Live re-probe of run counts was not required to land the contract.

### Class-rank / population / elite
Unchanged from first Agent 03 land (class-rank fail-closed; season-level policy; elite persist by current season + catalog).

### Cold / warm / replay call counts
| Path | Blizzard rating | Achievements | Dedicated RIO historical |
|------|-----------------|--------------|--------------------------|
| Cold miss + Blizzard OK | 1 | 1 | 0 |
| Cold miss + Blizzard fail + no usable preload | 1 | 1 | 1 |
| Warm / replay after success | 0 | 0 | 0 |

### Files / migrations
Same persistence migration as before, plus:
- `packages/contracts` — `RaiderIoExactSeasonHistoricalRating` + provider method
- `packages/providers/raiderio` — fields, extract, `getCharacterExactSeasonHistoricalRating`
- `experience-phase1` / `experience-previous-season-evidence` — dedicated fallback + A/B/C
- refresh-bridge wires `raiderIoExactSeason`

### Tests run
Worker persist/phase1/previous-season — **52 passed**.
RaiderIO fields/extract/normalize — **24 passed**.

## Blockers / questions for Agent 04
1. Native cutoff band standing mapping (Agent 04).
2. Class-rank floor still unavailable without exact-season rank source.
3. Remapped historical cutoffs / LKG standing path.
4. Deploy migration `20260809180000_character_experience_evidence`.
5. Do **not** change P/S/U formulas.

## Baseline
Preserve P/S/U baseline in `AUDIT_BASELINE.md`.

## Start instruction for Agent 04
Read this handoff + `PRODUCT_DECISIONS.md`. Implement native cutoff standing mapping / edge-case scoring only. Do not start Agent 05.
