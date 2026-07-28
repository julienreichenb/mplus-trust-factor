/**
 * Character profile fields for live refresh + Experience v3 public history.
 * Verified against OpenAPI v0.62.5 fields parameter documentation (2026-07-27).
 * Wave 4 Experience needs current + previous season scores (never raw cross-era compare).
 */
export const MINIMAL_CHARACTER_FIELDS = [
  "gear",
  "talents",
  "mythic_plus_scores_by_season:current:previous",
  "mythic_plus_ranks",
  "mythic_plus_recent_runs",
  "mythic_plus_best_runs",
] as const;

export function buildMinimalCharacterFields(): string {
  return MINIMAL_CHARACTER_FIELDS.join(",");
}
