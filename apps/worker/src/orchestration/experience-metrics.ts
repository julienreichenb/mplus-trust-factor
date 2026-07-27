import type {
  ExperienceSummaryDTO,
  MetricObservationDTO,
  RaiderIoCharacterProfile,
  RaiderIoSeasonCutoffs,
} from "@mplus/contracts";
import {
  computeExperienceDimension,
  EXPERIENCE_V3_METRIC_KEYS,
  normalizeScoreAgainstTop25Cutoff,
  type ExperienceCharacterHistory,
  type ExperienceSeasonFact,
} from "@mplus/scoring";

export interface BuildExperienceObservationsInput {
  characterKey: string;
  displayName: string | null;
  raiderIoProfile: RaiderIoCharacterProfile | null;
  /** Blizzard current-season Mythic+ rating when available. */
  blizzardMythicRating: number | null;
  cutoffs: RaiderIoSeasonCutoffs | null;
  /** Distinct current-season dungeons with a canonical / best run. */
  currentSeasonDungeonCount: number | null;
  expectedDungeonCount: number;
  observedAt: string;
  /**
   * Reserved for future verified-account mode. Public refresh must leave this empty
   * and never pass roster-inferred characters.
   */
  verifiedLinkedCharacters?: ExperienceCharacterHistory[];
  accountLinkageVerified?: boolean;
}

export interface BuildExperienceObservationsResult {
  observations: MetricObservationDTO[];
  summary: ExperienceSummaryDTO;
  confidence: number;
  experienceScore: number | null;
  /** Patch onto active model metricWeights.EXPERIENCE when Agent 27 activates default@3. */
  experienceMetricWeights: Array<{ metricKey: string; weight: number }>;
}

function normalizeSeasonScore(
  rawScore: number | null,
  cutoffs: RaiderIoSeasonCutoffs | null,
  /** Only apply current-season cutoffs to the current season row. */
  isCurrentSeason: boolean,
): { seasonNormalizedScore: number | null; normalization: string; quality: "HIGH" | "LOW" } {
  if (rawScore == null || !Number.isFinite(rawScore)) {
    return { seasonNormalizedScore: null, normalization: "missing_raw", quality: "LOW" };
  }
  const top25 = isCurrentSeason ? (cutoffs?.top25Percent?.score ?? null) : null;
  if (top25 != null && top25 > 0) {
    return {
      seasonNormalizedScore: normalizeScoreAgainstTop25Cutoff(rawScore, top25),
      normalization: "season_cutoff_top25",
      quality: "HIGH",
    };
  }
  // Transparent heuristic: keeps the season usable with PARTIAL quality.
  // Agent 27 should replace with per-season calibrated ceilings/cutoffs.
  // Still never compares raw cross-era values directly.
  const heuristicCeiling = 3600;
  return {
    seasonNormalizedScore: Math.min(100, Math.max(0, (rawScore / heuristicCeiling) * 100)),
    normalization: isCurrentSeason
      ? "transparent_heuristic_ceiling"
      : "historical_heuristic_ceiling_pending_calibration",
    quality: "LOW",
  };
}

function buildPublicCharacterHistory(input: BuildExperienceObservationsInput): ExperienceCharacterHistory {
  const seasons: ExperienceSeasonFact[] = [];
  const rioSeasons = input.raiderIoProfile?.seasons?.length
    ? input.raiderIoProfile.seasons
    : [
        input.raiderIoProfile?.currentSeason,
        input.raiderIoProfile?.previousSeason,
      ].filter((s): s is NonNullable<typeof s> => s != null);

  if (rioSeasons.length > 0) {
    rioSeasons.forEach((entry, index) => {
      const isCurrent = index === 0 || entry.isCurrentSeason;
      const rawScore = entry.scores.all;
      const { seasonNormalizedScore, normalization, quality } = normalizeSeasonScore(
        rawScore,
        input.cutoffs,
        isCurrent,
      );
      seasons.push({
        seasonSlug: entry.seasonSlug,
        seasonsAgo: index,
        rawScore,
        seasonNormalizedScore,
        dungeonCount: isCurrent ? input.currentSeasonDungeonCount : null,
        active: rawScore > 0,
        sourceProvider: "raiderio",
        fieldStatus: {
          availability: quality === "HIGH" ? "AVAILABLE" : "PARTIAL",
          reason: normalization,
        },
      });
    });
  } else if (input.blizzardMythicRating != null) {
    const { seasonNormalizedScore, normalization, quality } = normalizeSeasonScore(
      input.blizzardMythicRating,
      input.cutoffs,
      true,
    );
    seasons.push({
      seasonSlug: input.cutoffs?.seasonSlug ?? "current",
      seasonsAgo: 0,
      rawScore: input.blizzardMythicRating,
      seasonNormalizedScore,
      dungeonCount: input.currentSeasonDungeonCount,
      active: input.blizzardMythicRating > 0,
      sourceProvider: "blizzard",
      fieldStatus: {
        availability: quality === "HIGH" ? "AVAILABLE" : "PARTIAL",
        reason: normalization,
      },
    });
  }

  // Prefer Blizzard current rating for current-season peak when both exist (same season scale).
  if (input.blizzardMythicRating != null && seasons[0] != null && seasons[0].seasonsAgo === 0) {
    const { seasonNormalizedScore, normalization, quality } = normalizeSeasonScore(
      input.blizzardMythicRating,
      input.cutoffs,
      true,
    );
    if (seasonNormalizedScore != null) {
      seasons[0] = {
        ...seasons[0],
        rawScore: input.blizzardMythicRating,
        seasonNormalizedScore,
        sourceProvider: "blizzard",
        fieldStatus: {
          availability: quality === "HIGH" ? "AVAILABLE" : "PARTIAL",
          reason: `blizzard_rating:${normalization}`,
        },
      };
    }
  }

  return {
    characterKey: input.characterKey,
    displayName: input.displayName,
    verified: false,
    seasons,
  };
}

/**
 * Build Experience v3 observations for the public character path.
 * Does not infer alts. Verified account mode only when explicit linked characters are supplied.
 */
export function buildExperienceObservations(
  input: BuildExperienceObservationsInput,
): BuildExperienceObservationsResult {
  const publicHistory = buildPublicCharacterHistory(input);
  const verified = (input.verifiedLinkedCharacters ?? []).filter((c) => c.verified);
  const accountLinkageVerified = Boolean(input.accountLinkageVerified && verified.length > 0);

  const computed = computeExperienceDimension({
    characters: accountLinkageVerified ? verified : [publicHistory],
    expectedDungeonCount: input.expectedDungeonCount,
    accountLinkageVerified,
    linkageSource: accountLinkageVerified ? "USER_CLAIM" : "NONE",
  });

  const observations: MetricObservationDTO[] = [];
  const conf = computed.confidence;
  const summaryContext = {
    mode: computed.summary.mode,
    label: computed.summary.label,
    formulaVersion: computed.summary.formulaVersion,
    accountGraph: computed.summary.accountGraph,
    missingMetrics: computed.summary.missingMetrics,
    effectiveWeights: computed.effectiveWeights,
  };

  const push = (
    metricKey: string,
    value: number | null,
    extra: Record<string, unknown> = {},
  ): void => {
    if (value == null) return;
    observations.push({
      metricKey,
      dimension: "EXPERIENCE",
      rawValue: value,
      normalizedValue: value,
      confidence: conf,
      observedAt: input.observedAt,
      sourceProvider: input.raiderIoProfile ? "raiderio" : "blizzard",
      coverage: {
        present: [
          computed.observations.currentPeak,
          computed.observations.currentBreadth,
          computed.observations.historicalPeak,
          computed.observations.longevity,
        ].filter((v) => v != null).length,
        expected: 4,
        ratio: conf,
      },
      context: { ...summaryContext, ...extra },
    });
  };

  // v3 keys for Agent 27 default@3
  push(EXPERIENCE_V3_METRIC_KEYS.currentPeak, computed.observations.currentPeak, {
    contributor: "current_peak",
  });
  push(EXPERIENCE_V3_METRIC_KEYS.currentBreadth, computed.observations.currentBreadth, {
    contributor: "current_breadth",
    diminishingReturns: true,
  });
  push(EXPERIENCE_V3_METRIC_KEYS.historicalPeak, computed.observations.historicalPeak, {
    contributor: "historical_peak",
    ageDecayApplied: true,
  });
  push(EXPERIENCE_V3_METRIC_KEYS.longevity, computed.observations.longevity, {
    contributor: "longevity",
  });

  // Bridge into active default@2 metric keys (no model weight change here).
  push("experience.dungeon_breadth", computed.observations.currentBreadth, {
    bridgedFrom: EXPERIENCE_V3_METRIC_KEYS.currentBreadth,
  });
  push("experience.historical_seasons", computed.observations.historicalPeak, {
    bridgedFrom: EXPERIENCE_V3_METRIC_KEYS.historicalPeak,
    note: "Season-normalized + age-decayed peak; not a raw cross-era score",
  });

  return {
    observations,
    summary: computed.summary,
    confidence: computed.confidence,
    experienceScore: computed.experienceScore,
    experienceMetricWeights: [
      { metricKey: EXPERIENCE_V3_METRIC_KEYS.currentPeak, weight: 0.45 },
      { metricKey: EXPERIENCE_V3_METRIC_KEYS.currentBreadth, weight: 0.25 },
      { metricKey: EXPERIENCE_V3_METRIC_KEYS.historicalPeak, weight: 0.2 },
      { metricKey: EXPERIENCE_V3_METRIC_KEYS.longevity, weight: 0.1 },
    ],
  };
}
