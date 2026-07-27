# Agent 22 — Performance v3

Work from Agent 21's merged foundation on `integration/wave4`.

Implement Performance using only the eight selected highest-key current-season runs.

Formula baseline:

- per dungeon: 65% selected-run WCL execution percentile + 35% season-relative key difficulty percentile;
- equal dungeon weighting;
- coverage/freshness affect confidence, not skill points;
- missing dungeon detail is unavailable, never zero.

Requirements:

1. Tie WCL parse data to the selected canonical run; do not substitute character-wide best parses.
2. Prefer bracket-aware WCL rankings when valid.
3. Normalize key difficulty from active-season regional data/cutoffs, with a documented bounded fallback.
4. Expose per-dungeon inputs, output, confidence and source.
5. Retire v2 current-season peak/median as the v3 driver; keep v2 snapshots intact.
6. Do not compare raw scores between seasons.
7. Add model-v3 observations and tests proving a strong high-key parse can outrank an excellent medium-key parse.
8. Validate all eight Wallidrixe runs and return before/after payloads.

Do not change other dimensions or UI layout.
