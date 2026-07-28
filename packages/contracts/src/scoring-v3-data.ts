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

/** Experience history scope — never infer alts without verified linkage. */
export type ExperienceHistoryMode = "CHARACTER_HISTORY" | "VERIFIED_ACCOUNT_HISTORY";

/** How a verified account character list was established. */
export type ExperienceLinkageSource =
  | "NONE"
  | "USER_CLAIM"
  | "BLIZZARD_OAUTH"
  | "PROVIDER_PUBLIC_LINK";

/**
 * Season-scoped Mythic+ progression inputs for Experience v3.
 * Raw scores from different seasons are never comparable — normalize first.
 */
export interface ExperienceSeasonFact {
  seasonSlug: string;
  /** 0 = current season, 1 = previous, 2+ = older. */
  seasonsAgo: number;
  /** Provider raw score/rating for the season (Raider.IO all-score or Blizzard rating). */
  rawScore: number | null;
  /**
   * Season-local 0–100 scale (percentile, rank-derived, or cutoff-normalized).
   * Required for cross-season comparison; null → season omitted from peak math.
   */
  seasonNormalizedScore: number | null;
  /** Distinct dungeons with a qualifying run this season (breadth). */
  dungeonCount: number | null;
  /** True when this season had meaningful M+ activity. */
  active: boolean;
  sourceProvider: "blizzard" | "raiderio" | "derived";
  fieldStatus?: RawFactFieldStatus;
}

/** One character's season history for Experience aggregation. */
export interface ExperienceCharacterHistory {
  characterKey: string;
  displayName: string | null;
  seasons: ExperienceSeasonFact[];
  /** Explicit verified membership only — never inferred from roster/guild/logs. */
  verified: boolean;
}

/**
 * Public Experience explanation / profile payload.
 * Missing account graph is labelled unavailable — it must not lower the score.
 */
export interface ExperienceSummaryDTO {
  mode: ExperienceHistoryMode;
  linkageSource: ExperienceLinkageSource;
  label: "CHARACTER_HISTORY" | "VERIFIED_ACCOUNT_HISTORY";
  currentPeak: number | null;
  currentBreadth: number | null;
  historicalPeak: number | null;
  longevity: number | null;
  score: number | null;
  confidence: number;
  formulaVersion: string;
  contributors: {
    currentPeakWeight: number;
    currentBreadthWeight: number;
    historicalPeakWeight: number;
    longevityWeight: number;
  };
  seasonsUsed: Array<{
    seasonSlug: string;
    seasonsAgo: number;
    seasonNormalizedScore: number | null;
    decayedScore: number | null;
    active: boolean;
    characterKey: string;
  }>;
  accountGraph: {
    availability: MetricAvailability;
    reason: string;
    verifiedCharacterCount: number;
  };
  missingMetrics: string[];
}

export const EXPERIENCE_V3_FORMULA_VERSION = "experience-v3-v1";
