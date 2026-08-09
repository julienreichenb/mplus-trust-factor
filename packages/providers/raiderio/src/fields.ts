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

const EXACT_SEASON_SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/i;
const FORBIDDEN_SEASON_ALIASES = new Set(["current", "previous"]);

export function isValidRaiderIoSeasonSlug(seasonSlug: string): boolean {
  const slug = seasonSlug.trim();
  return EXACT_SEASON_SLUG_RE.test(slug) && !FORBIDDEN_SEASON_ALIASES.has(slug.toLowerCase());
}

/**
 * Exact-season Mythic+ score field only (no activity proof).
 * Prefer buildExactSeasonHistoricalEvidenceFields for Experience fallback.
 */
export function buildExactSeasonScoreFields(seasonSlug: string): string {
  const slug = seasonSlug.trim();
  if (!isValidRaiderIoSeasonSlug(slug)) {
    throw new Error(`invalid_raiderio_season_slug:${seasonSlug}`);
  }
  return `mythic_plus_scores_by_season:${slug}`;
}

/**
 * Exact-season Mythic+ historical evidence fields for Experience fallback.
 * OpenAPI v0.62.5:
 * - mythic_plus_scores_by_season:<slug> — exact season scores (not previous/current aliases)
 * - mythic_plus_dungeon_run_counts:<slug> — exact-season per-dungeon run totals (zero-filled)
 *
 * Run counts are required to distinguish score 0 with no activity vs score 0 with activity.
 * Best/recent runs are current-season only and must not be used for historical absence proof.
 */
export function buildExactSeasonHistoricalEvidenceFields(seasonSlug: string): string {
  const slug = seasonSlug.trim();
  if (!isValidRaiderIoSeasonSlug(slug)) {
    throw new Error(`invalid_raiderio_season_slug:${seasonSlug}`);
  }
  return [
    `mythic_plus_scores_by_season:${slug}`,
    `mythic_plus_dungeon_run_counts:${slug}`,
  ].join(",");
}
