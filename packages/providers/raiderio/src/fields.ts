/**
 * Wave 3 minimum explicit character profile fields.
 * Verified against OpenAPI v0.62.5 fields parameter documentation (2026-07-27).
 */
export const MINIMAL_CHARACTER_FIELDS = [
  "gear",
  "talents",
  // current + previous in one profile call (no extra request) for Experience continuity.
  "mythic_plus_scores_by_season:current:previous",
  "mythic_plus_ranks",
  // Previous-season ranks (incl. regional class rank) on the same profile call.
  "previous_mythic_plus_ranks",
  "mythic_plus_recent_runs",
  "mythic_plus_best_runs",
] as const;

export function buildMinimalCharacterFields(): string {
  return MINIMAL_CHARACTER_FIELDS.join(",");
}
