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

/**
 * Public combat-log coverage for a selected scoring run.
 * Never invent zeros for unavailable detail.
 */
export type CombatCoverageState = "AVAILABLE" | "PARTIAL" | "UNAVAILABLE";

/** Match confidence attached when a WCL candidate was compared to the canonical run. */
export type ScoringWclMatchConfidence = "HIGH" | "MEDIUM" | "LOW" | "NONE";

/** Sanitized match evidence for a selected scoring run (no roster dump). */
export interface ScoringWclMatchEvidence {
  dungeonMatch: boolean;
  keyLevelMatch: boolean;
  timeDeltaMs: number | null;
  durationDeltaMs: number | null;
  rosterOverlapRatio: number | null;
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
  /** Sanitized WCL report identity when an accepted match/source exists. */
  wclReportFingerprint: string | null;
  wclFightId: number | null;
  matchConfidence: ScoringWclMatchConfidence | null;
  matchEvidence: ScoringWclMatchEvidence | null;
  combatCoverageState: CombatCoverageState;
}

/**
 * Frozen per-dungeon selection row exposed on the public character profile.
 * Replaces Agent 26 web-only SelectedRunView fields.
 */
export interface ScoringSelectedRunProfileDTO {
  canonicalRunId: string;
  dungeonSlug: string;
  dungeonName: string;
  keyLevel: number;
  completedAt: IsoDateTime;
  timed: boolean | null;
  durationMs: number | null;
  raiderIoScore: number | null;
  selectionReason: ScoringRunSelectionReason;
  combatCoverageState: CombatCoverageState;
  /** Explicit reason when combat detail is missing or incomplete. */
  unavailableReason: string | null;
  wclReportMatched: boolean;
  wclCoverageRatio: number | null;
  /** Performance summary fields when available (null when missing — never coerced to 0). */
  parsePercentile: number | null;
  keyDifficultyPercentile: number | null;
  evidenceSummary: string | null;
  missingMetrics: string[];
}

/**
 * Frozen ScoringRunSelection projection on CharacterProfileResponse.
 */
export interface ScoringRunSelectionProfileDTO {
  seasonSlug: string;
  expectedDungeonCount: number;
  expectedDungeonSlugs: string[];
  selectedRuns: ScoringSelectedRunProfileDTO[];
  missingDungeonSlugs: string[];
  selectionConfidence: number | null;
  observedAt: IsoDateTime | null;
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
