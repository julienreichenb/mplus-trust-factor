import {
  EXPERIENCE_V3_ELITE_CATALOG_VERSION,
  EXPERIENCE_V3_HISTORICAL_RANK_POLICY_VERSION,
  EXPERIENCE_V3_PREVIOUS_SEASON_POLICY_VERSION,
} from "./constants.js";
import type {
  EliteAchievementCatalogEntryV3,
  HistoricalRankPolicyV3,
  PreviousSeasonNormalizationPolicyV3,
} from "./types.js";

/**
 * Versioned elite Mythic+ achievement / title catalog (Phase 1 seed).
 * Percentiles are population-relative labels, not live cutoffs.
 */
export const ELITE_ACHIEVEMENT_CATALOG_V1: readonly EliteAchievementCatalogEntryV3[] =
  Object.freeze([
    Object.freeze({
      achievementId: 14_196,
      seasonIdOrSlug: "season-df-1",
      title: "Keystone Hero: Dragonflight Season 1",
      percentile: 1,
      regionScope: null,
      evidenceSemantics: "season_keystone_hero_title",
      version: EXPERIENCE_V3_ELITE_CATALOG_VERSION,
    }),
    Object.freeze({
      achievementId: 16_647,
      seasonIdOrSlug: "season-df-2",
      title: "Keystone Hero: Dragonflight Season 2",
      percentile: 1,
      regionScope: null,
      evidenceSemantics: "season_keystone_hero_title",
      version: EXPERIENCE_V3_ELITE_CATALOG_VERSION,
    }),
    Object.freeze({
      achievementId: 17_850,
      seasonIdOrSlug: "season-df-3",
      title: "Keystone Hero: Dragonflight Season 3",
      percentile: 1,
      regionScope: null,
      evidenceSemantics: "season_keystone_hero_title",
      version: EXPERIENCE_V3_ELITE_CATALOG_VERSION,
    }),
    Object.freeze({
      achievementId: 19_049,
      seasonIdOrSlug: "season-df-4",
      title: "Keystone Hero: Dragonflight Season 4",
      percentile: 1,
      regionScope: null,
      evidenceSemantics: "season_keystone_hero_title",
      version: EXPERIENCE_V3_ELITE_CATALOG_VERSION,
    }),
    Object.freeze({
      achievementId: 20_525,
      seasonIdOrSlug: "season-tww-1",
      title: "The War Within Keystone Master: Season One",
      percentile: 1,
      regionScope: null,
      evidenceSemantics: "season_keystone_master_title",
      version: EXPERIENCE_V3_ELITE_CATALOG_VERSION,
    }),
    Object.freeze({
      achievementId: 20_526,
      seasonIdOrSlug: "season-tww-1",
      title: "The War Within Keystone Hero: Season One",
      percentile: 0.1,
      regionScope: null,
      evidenceSemantics: "season_keystone_hero_title_top_0_1",
      version: EXPERIENCE_V3_ELITE_CATALOG_VERSION,
    }),
    Object.freeze({
      achievementId: 20_985,
      seasonIdOrSlug: "season-tww-2",
      title: "The War Within Keystone Master: Season Two",
      percentile: 1,
      regionScope: null,
      evidenceSemantics: "season_keystone_master_title",
      version: EXPERIENCE_V3_ELITE_CATALOG_VERSION,
    }),
    Object.freeze({
      achievementId: 20_986,
      seasonIdOrSlug: "season-tww-2",
      title: "The War Within Keystone Hero: Season Two",
      percentile: 0.1,
      regionScope: null,
      evidenceSemantics: "season_keystone_hero_title_top_0_1",
      version: EXPERIENCE_V3_ELITE_CATALOG_VERSION,
    }),
  ]);

export function getEliteCatalogEntry(
  achievementId: number,
  catalog: readonly EliteAchievementCatalogEntryV3[] = ELITE_ACHIEVEMENT_CATALOG_V1,
): EliteAchievementCatalogEntryV3 | null {
  return catalog.find((e) => e.achievementId === achievementId) ?? null;
}

/** Build a previous-season policy from absolute K thresholds. */
export function createPreviousSeasonPolicyV3(input: {
  id?: string;
  seasonId: string;
  seasonSlug: string;
  region: string;
  k50: number;
  k90: number;
  k99: number;
  source?: PreviousSeasonNormalizationPolicyV3["source"];
  sampleSize?: number | null;
  confidence?: number;
}): PreviousSeasonNormalizationPolicyV3 {
  return {
    id: input.id ?? `prev-season-${input.seasonSlug}-${input.region}`,
    version: EXPERIENCE_V3_PREVIOUS_SEASON_POLICY_VERSION,
    seasonId: input.seasonId,
    seasonSlug: input.seasonSlug,
    region: input.region,
    k50: input.k50,
    k90: input.k90,
    k99: input.k99,
    source: input.source ?? "MANUAL",
    sampleSize: input.sampleSize ?? null,
    confidence: input.confidence ?? 0.7,
  };
}

/** Default historical-rank policy (local → Blizzard → Raider.IO). */
export function createHistoricalRankPolicyV3(input?: {
  id?: string;
  confidence?: number;
  maxAgeSeasonsBeforeDecay?: number;
}): HistoricalRankPolicyV3 {
  return {
    id: input?.id ?? "historical-rank-default",
    version: EXPERIENCE_V3_HISTORICAL_RANK_POLICY_VERSION,
    sourcePriority: ["LOCAL_LEADERBOARD", "BLIZZARD", "RAIDER_IO"],
    maxAgeSeasonsBeforeDecay: input?.maxAgeSeasonsBeforeDecay ?? 4,
    confidence: input?.confidence ?? 0.65,
  };
}
