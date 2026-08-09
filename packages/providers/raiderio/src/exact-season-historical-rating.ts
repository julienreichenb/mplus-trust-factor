/**
 * Exact-season historical rating extraction from raw Raider.IO character profile.
 * OpenAPI v0.62.5 — does not treat scores.all === 0 as absence by itself.
 */

import type { RaiderIoExactSeasonHistoricalRating } from "@mplus/contracts";
import type { RawCharacterProfileResponse, RawDungeonRunCount } from "./raw-types.js";
import { isValidRaiderIoSeasonSlug } from "./fields.js";

function sumSeasonRunsTotal(counts: RawDungeonRunCount[] | undefined): number | null {
  if (!Array.isArray(counts)) return null;
  let total = 0;
  for (const row of counts) {
    const n = row.season_runs_total;
    if (typeof n !== "number" || !Number.isFinite(n) || n < 0) return null;
    total += n;
  }
  return total;
}

/**
 * Extract exact-season score + activity proof from a raw profile payload.
 * Rejects wrong-season payloads (requested slug not present in scores array).
 */
export function extractExactSeasonHistoricalRatingFromRaw(
  raw: RawCharacterProfileResponse,
  requestedSeasonSlug: string,
): RaiderIoExactSeasonHistoricalRating {
  const slug = requestedSeasonSlug.trim();
  if (!isValidRaiderIoSeasonSlug(slug)) {
    return {
      requestedSeasonSlug: slug,
      seasonFound: false,
      scoreAll: null,
      activityProof: "UNKNOWN",
      totalSeasonRuns: null,
    };
  }

  const seasons = raw.mythic_plus_scores_by_season ?? [];
  const match = seasons.find((s) => typeof s?.season === "string" && s.season.trim() === slug);
  if (!match) {
    return {
      requestedSeasonSlug: slug,
      seasonFound: false,
      scoreAll: null,
      activityProof: "UNKNOWN",
      totalSeasonRuns: null,
    };
  }

  const rawScore = match.scores?.all;
  const scoreAll =
    typeof rawScore === "number" && Number.isFinite(rawScore) ? rawScore : null;

  const totalSeasonRuns = sumSeasonRunsTotal(raw.mythic_plus_dungeon_run_counts);
  let activityProof: RaiderIoExactSeasonHistoricalRating["activityProof"] = "UNKNOWN";
  if (totalSeasonRuns != null) {
    activityProof = totalSeasonRuns > 0 ? "PROVEN_ACTIVITY" : "PROVEN_NONE";
  }

  return {
    requestedSeasonSlug: slug,
    seasonFound: true,
    scoreAll,
    activityProof,
    totalSeasonRuns,
  };
}
