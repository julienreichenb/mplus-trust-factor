import type { IsoDateTime } from "@mplus/contracts";

/** Per-dungeon WCL aggregate percentiles for one season (equal dungeon weight). */
export interface PerformanceDungeonAggregate {
  dungeonSlug: string;
  dungeonName: string;
  /** Peak execution — WCL best parse percentile (rankPercent). */
  bestParsePercentile: number | null;
  /** Consistency — WCL median parse percentile. */
  medianParsePercentile: number | null;
  loggedRunCount: number;
  /** Spec/role this aggregate was recorded for; used to filter historical seasons. */
  specSlug?: string | null;
  roleSlug?: string | null;
  latestObservedAt?: IsoDateTime | null;
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
  /** v2: best parse; v3: selected-run execution percentile (same field for DTO compat). */
  bestParsePercentile: number | null;
  /** v2: median parse; unused as a v3 driver (may be null). */
  medianParsePercentile: number | null;
  loggedRunCount: number;
  bestRun: PerformanceExplanatoryRun | null;
  latestRun: PerformanceExplanatoryRun | null;
  /** Performance v3 — selected highest-key run execution percentile. */
  executionPercentile?: number | null;
  /** Performance v3 — season-relative key difficulty percentile. */
  keyDifficultyPercentile?: number | null;
  /** Performance v3 — 65% execution + 35% key difficulty. */
  runPerformance?: number | null;
  /** Per-dungeon confidence (missing detail lowers confidence, never invents zeros). */
  dungeonConfidence?: number | null;
  /** Provenance label for the dungeon score inputs. */
  source?: string | null;
  selectedKeyLevel?: number | null;
  canonicalRunId?: string | null;
}

export interface PerformanceCurrentSeasonSummary {
  /** v2 peak; v3 surfaces mean selected-run execution for explanation continuity. */
  peakScore: number | null;
  /** v2 consistency; v3 surfaces mean key-difficulty for explanation continuity. */
  consistencyScore: number | null;
  score: number | null;
  confidence: number;
  dungeonCount: number;
  expectedDungeonCount: number;
  latestObservedAt: IsoDateTime | null;
  dungeons: PerformanceDungeonSummary[];
  /** Present when summary was produced by Performance v3. */
  formulaVersion?: string | null;
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
