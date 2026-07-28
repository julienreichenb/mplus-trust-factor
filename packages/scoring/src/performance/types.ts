import type { IsoDateTime } from "@mplus/contracts";

/** Per-dungeon WCL aggregate percentiles for one season (equal dungeon weight). */
export interface PerformanceDungeonAggregate {
  dungeonSlug: string;
  dungeonName: string;
  encounterId?: number | null;
  /** Peak execution — WCL best parse percentile (rankPercent). */
  bestParsePercentile: number | null;
  /** Consistency — WCL median parse percentile. */
  medianParsePercentile: number | null;
  loggedRunCount: number;
  /** Spec/role this aggregate was recorded for; used to filter historical seasons. */
  specSlug?: string | null;
  roleSlug?: string | null;
  latestObservedAt?: IsoDateTime | null;
  keystoneLevel?: number | null;
  throughputBracket?: number | null;
  ratingPoints?: number | null;
  scoreRank?: number | null;
  regionRank?: number | null;
  serverRank?: number | null;
  scoreRankPercent?: number | null;
  specialization?: string | null;
  bestDps?: number | null;
  completion?: {
    fastestKillRaw: number | null;
    speedRaw: number | null;
    fightMetadataRaw: number | null;
    leaderboardRaw: number | null;
    affixesRaw: number | null;
    completionTimeMs: null;
    encodingStatus: "unverified_not_emitted";
    encodingNote: string;
  } | null;
}

export interface HistoricalSeasonAggregateInput {
  seasonSlug: string;
  /** Recency rank: 1 = previous season, 2 = season-2, 3 = season-3. */
  recencyRank: 1 | 2 | 3;
  dungeons: PerformanceDungeonAggregate[];
  /** Must match active character spec/role or the season is excluded. */
  specSlug?: string | null;
  roleSlug?: string | null;
}

export interface PerformanceRunRefInput {
  runId: string;
  dungeonSlug: string;
  dungeonName?: string;
  keyLevel: number;
  completedAt: IsoDateTime;
  timed: boolean;
  /** Prefer WCL parse percentile when present; else scoreValue as weak proxy. */
  parsePercentile: number | null;
  scoreValue: number | null;
  hasWclSource: boolean;
}

export interface PerformanceExplanatoryRun {
  runId: string;
  kind: "BEST" | "LATEST" | "BOTH";
  dungeonSlug: string;
  dungeonName: string;
  keyLevel: number;
  completedAt: IsoDateTime;
  timed: boolean;
  parsePercentile: number | null;
  scoreValue: number | null;
}

export interface PerformanceDungeonSummary {
  dungeonSlug: string;
  dungeonName: string;
  encounterId?: number | null;
  bestParsePercentile: number | null;
  medianParsePercentile: number | null;
  loggedRunCount: number;
  keystoneLevel?: number | null;
  throughputBracket?: number | null;
  ratingPoints?: number | null;
  scoreRank?: number | null;
  regionRank?: number | null;
  serverRank?: number | null;
  scoreRankPercent?: number | null;
  specialization?: string | null;
  bestDps?: number | null;
  completion?: {
    fastestKillRaw: number | null;
    speedRaw: number | null;
    fightMetadataRaw: number | null;
    leaderboardRaw: number | null;
    affixesRaw: number | null;
    completionTimeMs: null;
    encodingStatus: "unverified_not_emitted";
    encodingNote: string;
  } | null;
  bestRun: PerformanceExplanatoryRun | null;
  latestRun: PerformanceExplanatoryRun | null;
}

export type PerformanceProvenance =
  | "AGGREGATE_ZONE_RANKINGS"
  | "FIGHT_BOUND_PARSES"
  | "NONE";

export interface PerformanceCurrentSeasonSummary {
  peakScore: number | null;
  consistencyScore: number | null;
  score: number | null;
  confidence: number;
  dungeonCount: number;
  availableDungeonCount?: number;
  expectedDungeonCount: number;
  totalMythicPlusScore?: number | null;
  totalLoggedRuns?: number;
  partition?: number | null;
  zoneId?: number | null;
  latestObservedAt: IsoDateTime | null;
  provenance?: PerformanceProvenance;
  specRanks?: Array<{
    spec: string | null;
    points: number | null;
    possiblePoints: number | null;
    rank: number | null;
    regionRank: number | null;
    serverRank: number | null;
    scoreRankPercent: number | null;
    total: number | null;
    partition: number | null;
  }>;
  diagnostics?: {
    ratingPointsExcludedFromScore: true;
    keystoneLevelExcludedFromScore: true;
    scoreRankPercentExcludedFromScore: true;
    throughputSampleCountUnavailable: true;
    performanceState?: string | null;
    unavailableEncounters?: Array<{
      encounterID: number;
      encounterName: string | null;
      dungeonSlug: string | null;
      reason: string;
    }>;
  };
  dungeons: PerformanceDungeonSummary[];
}

export interface PerformanceHistoricalSeasonSummary {
  seasonSlug: string;
  averageBestParsePercentile: number;
  dungeonCount: number;
}

export interface PerformanceHistoricalSummary {
  score: number;
  seasonsUsed: number;
  seasons: PerformanceHistoricalSeasonSummary[];
}

/** Public profile / explanation payload — no private report codes. */
export interface PerformanceSummaryDTO {
  currentSeason: PerformanceCurrentSeasonSummary;
  historical: PerformanceHistoricalSummary | null;
}

export interface ComputePerformanceInput {
  currentSeasonDungeons: PerformanceDungeonAggregate[];
  historicalSeasons?: HistoricalSeasonAggregateInput[];
  expectedDungeonCount: number;
  /** Active character specialization; historical seasons must match when provided. */
  activeSpecSlug?: string | null;
  activeRoleSlug?: string | null;
  hasResolvedSpecAndRole: boolean;
  selectedRunWclCoverage: number;
  /** Canonical current-season runs used only for explanatory best/latest selection. */
  explanatoryRuns?: PerformanceRunRefInput[];
  /** Freshness of the most recent WCL evidence (0–1). */
  logFreshness?: number;
  nowMs?: number;
}

export interface ComputePerformanceResult {
  summary: PerformanceSummaryDTO;
  /** 65% peak + 35% consistency (null when no valid current-season percentiles). */
  currentSeasonScore: number | null;
  /** Overall PERFORMANCE component before dimension confidence blend. */
  performanceScore: number | null;
  /** Independent PERFORMANCE confidence (0 when no current-season WCL percentiles). */
  confidence: number;
  observations: {
    peak: number | null;
    consistency: number | null;
    historical: number | null;
  };
}
