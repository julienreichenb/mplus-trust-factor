import type { IsoDateTime } from "./identity.js";

/** Why a run won the per-dungeon canonical selection. */
export type ScoringRunSelectionReason =
  | "HIGHEST_KEY"
  | "HIGHEST_SCORE_TIEBREAK"
  | "LATEST_TIEBREAK";

/**
 * Shared eight-run set for Scoring v3 current-season dimensions.
 * One canonical run per active-season dungeon. Does not change score weights.
 */
export interface ScoringRunSelection {
  seasonSlug: string;
  expectedDungeonCount: number;
  expectedDungeonSlugs: string[];
  selectedRuns: ScoringSelectedRun[];
  missingDungeonSlugs: string[];
  selectionConfidence: number;
  observedAt: IsoDateTime;
}

export interface ScoringSelectedRun {
  dungeonSlug: string;
  canonicalRunId: string;
  keyLevel: number;
  timed: boolean | null;
  completedAt: IsoDateTime;
  durationMs: number | null;
  raiderIoScore: number | null;
  wclReportMatched: boolean;
  wclCoverageRatio: number | null;
  /** Detail unavailable when the highest run has no WCL match — never demote to a lower logged run. */
  detailAvailable: boolean;
  selectionReason: ScoringRunSelectionReason;
  rejectionReasons: string[];
}

/** Provenance required on every persisted raw fact. */
export interface RawFactProvenance {
  sourceProvider: "blizzard" | "raiderio" | "warcraftlogs" | "catalog" | "derived";
  canonicalRunId: string | null;
  dungeonSlug: string | null;
  formulaVersion: string;
  abilityCatalogVersion: string | null;
  mechanicCatalogVersion: string | null;
  observedAt: IsoDateTime;
}

export type MetricAvailability = "AVAILABLE" | "PARTIAL" | "BLOCKED" | "MISSING";

export interface RawFactFieldStatus {
  availability: MetricAvailability;
  reason: string | null;
}

/** Raw Survival facts before scoring weights are applied. */
export interface SurvivalRawFacts {
  provenance: RawFactProvenance;
  deaths: number | null;
  totalDamageTaken: number | null;
  avoidableDamageTaken: number | null;
  avoidableDamageCoverageRatio: number | null;
  maxHealth: number | null;
  personalDefensiveCasts: number | null;
  selfHealEffective: number | null;
  selfHealOverheal: number | null;
  healthPotionCasts: number | null;
  fieldStatus: Record<string, RawFactFieldStatus>;
}

/** Raw Utility facts before scoring weights are applied. */
export interface UtilityRawFacts {
  provenance: RawFactProvenance;
  kickCasts: number | null;
  successfulInterrupts: number | null;
  effectiveKickCooldownMs: number | null;
  distinctCcTargets: number | null;
  groupSupportCasts: number | null;
  defensiveDispels: number | null;
  offensiveDispels: number | null;
  fieldStatus: Record<string, RawFactFieldStatus>;
}

/** Performance collection inputs (no score formula). */
export interface PerformanceRawInputs {
  provenance: RawFactProvenance;
  parsePercentile: number | null;
  keyDifficultyInputs: {
    keyLevel: number | null;
    timed: boolean | null;
    seasonSlug: string | null;
    region: string | null;
  };
  fieldStatus: Record<string, RawFactFieldStatus>;
}

/** Sanitized per-dungeon smoke / coverage row for the eight-run set. */
export interface ScoringRunRawFactRow {
  dungeonSlug: string;
  canonicalRunFingerprint: string;
  keyLevel: number;
  durationMs: number | null;
  timed: boolean | null;
  selectionReason: ScoringRunSelectionReason;
  wclReportFingerprint: string | null;
  wclFightId: number | null;
  detailAvailable: boolean;
  performance: PerformanceRawInputs;
  survival: SurvivalRawFacts;
  utility: UtilityRawFacts;
  missingDataReasons: string[];
  rejectionReasons: string[];
  apiPointCost: number | null;
}

export interface ScoringDataFoundationSnapshot {
  seasonSlug: string;
  expectedDungeonCount: number;
  selection: ScoringRunSelection;
  rows: ScoringRunRawFactRow[];
  aggregateCoverage: {
    selectedDungeonCount: number;
    detailAvailableCount: number;
    wclMatchedCount: number;
  };
  providerPointCost: number | null;
  pagination: {
    maxEventPages: number;
    maxEventsPerCategory: number;
    truncatedCategoriesObserved: string[];
  };
  formulaVersion: string;
  abilityCatalogVersion: string;
  mechanicCatalogVersion: string;
  observedAt: IsoDateTime;
}

export const SCORING_V3_FORMULA_VERSION = "scoring-v3-raw-facts-v1";
