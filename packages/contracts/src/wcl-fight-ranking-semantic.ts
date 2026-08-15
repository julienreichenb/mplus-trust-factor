/**
 * Fight-local WCL Report.rankings semantic used by Boost Key % evidence.
 * Distinct from character zoneRankings(compare: Parses) used by Trust Score discovery.
 */

export const WCL_FIGHT_RANKING_SEMANTIC_V1 = {
  rankingAcquisitionVersion: "wcl-fight-rankings-v1",
  semantic: "WCL_REPORT_RANKINGS_PARSES_DEFAULT",
  compare: "Parses",
  playerMetric: null,
  timeframe: null,
  rankPercentSemantic: "PARSE_PERCENT",
  bracketPercentSemantic: "UNVERIFIED_PERCENT",
} as const;

export const WCL_FIGHT_RANKING_SEMANTIC_V2_UI_KEY_PERCENT = {
  rankingAcquisitionVersion: "wcl-fight-ranking-v2-ui-key-percent",
  semantic: "WCL_REPORT_DAMAGE_DONE_KEY_PERCENT",
  compare: "Rankings",
  playerMetric: "dps",
  timeframe: "Today",
  rankPercentSemantic: "PARSE_PERCENT",
  bracketPercentSemantic: "KEY_PERCENT",
} as const;

/** Current Boost-compatible fight ranking acquisition. */
export const WCL_FIGHT_RANKING_ACQUISITION_VERSION =
  WCL_FIGHT_RANKING_SEMANTIC_V2_UI_KEY_PERCENT.rankingAcquisitionVersion;

export const WCL_FIGHT_RANKING_LEGACY_ACQUISITION_VERSION =
  WCL_FIGHT_RANKING_SEMANTIC_V1.rankingAcquisitionVersion;

export type WclFightRankingSemanticV2 = typeof WCL_FIGHT_RANKING_SEMANTIC_V2_UI_KEY_PERCENT;
