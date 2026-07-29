/** Per-dungeon survival behavioral aggregate (median of run scores). */
export interface SurvivalDungeonAggregate {
  dungeonSlug: string;
  dungeonName?: string;
  /** Median of per-run behavioral survival scores (0–100). */
  medianBehavioralScore: number | null;
  /** Median outcome-only scores when behavioral coverage is thin. */
  medianOutcomeOnlyScore?: number | null;
  medianOutcomeScore?: number | null;
  medianDefensiveResponseScore?: number | null;
  medianEmergencyRecoveryScore?: number | null;
  runCount: number;
  latestObservedAt?: string | null;
}

export interface SurvivalCoverageCounts {
  covered: number;
  missed: number;
  na: number;
}

export interface SurvivalRequestCost {
  wclRequestCount?: number;
  estimatedPageCountIncreaseVsCalibrationDamageTaken?: number | null;
  notes?: string[];
}

export interface SurvivalExplanatoryRun {
  runId: string;
  dungeonSlug: string;
  dungeonName?: string;
  keyLevel: number | null;
  behavioralSurvivalScore: number | null;
  deathCount: number;
  pressureClusterCount?: number;
  hasWclSource: boolean;
}

export interface SurvivalDungeonSummary {
  dungeonSlug: string;
  dungeonName?: string;
  medianBehavioralScore: number | null;
  runCount: number;
  bestRun: SurvivalExplanatoryRun | null;
}

/** Public profile / explanation payload for SURVIVAL. */
export interface SurvivalSummaryDTO {
  score: number | null;
  confidence: number;
  availableDungeonCount: number;
  expectedDungeonCount: number;
  scoreMode: "FULL_BEHAVIORAL" | "PARTIAL_BEHAVIORAL" | "OUTCOME_ONLY" | null;
  analyzedRunCount?: number;
  cachedRunCount?: number;
  newlyFetchedRunCount?: number;
  components?: {
    outcome: number | null;
    defensiveResponse: number | null;
    emergencyRecovery: number | null;
  };
  pressureClusterCount?: number;
  deathCount?: number;
  defensiveCounts?: SurvivalCoverageCounts;
  recoveryCounts?: SurvivalCoverageCounts;
  maxHpDiagnostics?: {
    invalidOutlierCount: number;
    baselineResolvedRunCount: number;
  };
  dungeons: SurvivalDungeonSummary[];
  notes: string[];
  requestCost?: SurvivalRequestCost;
}

export interface ComputeSurvivalInput {
  dungeons: SurvivalDungeonAggregate[];
  expectedDungeonCount: number;
  scoreMode?: SurvivalSummaryDTO["scoreMode"];
  componentMedians?: {
    outcome: number | null;
    defensiveResponse: number | null;
    emergencyRecovery: number | null;
  };
  explanatoryRuns?: SurvivalExplanatoryRun[];
  analyzedRunCount?: number;
  cachedRunCount?: number;
  newlyFetchedRunCount?: number;
  pressureClusterCount?: number;
  deathCount?: number;
  defensiveCounts?: SurvivalCoverageCounts;
  recoveryCounts?: SurvivalCoverageCounts;
  maxHpDiagnostics?: SurvivalSummaryDTO["maxHpDiagnostics"];
  requestCost?: SurvivalRequestCost;
  /** 0–1 freshness / coverage hint from WCL selection. */
  selectedRunWclCoverage?: number;
  logFreshness?: number;
}

export interface ComputeSurvivalResult {
  summary: SurvivalSummaryDTO;
  survivalScore: number | null;
  confidence: number;
  observations: {
    /** Normalized 0–100 identity observation keys for the score model. */
    "survival.outcome": number | null;
    "survival.defensive_response": number | null;
    "survival.emergency_recovery": number | null;
  };
  /** Optional component breakdown when callers supply per-component dungeon medians. */
  componentMedians?: {
    outcome: number | null;
    defensiveResponse: number | null;
    emergencyRecovery: number | null;
  };
}

export const SURVIVAL_OUTCOME_WEIGHT = 0.55;
export const SURVIVAL_DEFENSIVE_RESPONSE_WEIGHT = 0.3;
export const SURVIVAL_EMERGENCY_RECOVERY_WEIGHT = 0.15;
