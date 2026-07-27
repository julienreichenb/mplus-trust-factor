/**
 * Minimal Raider.IO character profile fields for a single stale refresh.
 * Verified against OpenAPI v0.62.5 fields parameter documentation.
 */
export const MINIMAL_CHARACTER_FIELDS = [
  "mythic_plus_scores_by_season:current:previous",
  "mythic_plus_ranks",
  "mythic_plus_recent_runs",
  "mythic_plus_best_runs",
  "mythic_plus_highest_level_runs",
  "raid_progression:current-expansion",
] as const;

export function buildMinimalCharacterFields(): string {
  return MINIMAL_CHARACTER_FIELDS.join(",");
}
