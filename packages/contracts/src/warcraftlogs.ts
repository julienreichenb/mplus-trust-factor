/**
 * Shared Warcraft Logs DTOs (CR-14).
 * Full event arrays / actor Maps remain provider-local; persist this shape.
 */

export type WclVisibilityState =
  | "PUBLIC"
  | "HIDDEN"
  | "NO_PUBLIC_LOGS"
  | "PRIVATE_SKIPPED"
  | "NO_MATCHED_RUN"
  | "UNAVAILABLE"
  | "RATE_LIMITED";

export interface RunCombatFactsCoverage {
  casts: boolean;
  interrupts: boolean;
  deaths: boolean;
  damageTaken: boolean;
  auras: boolean;
  dispels: boolean;
  healing: boolean;
  combatantInfo: boolean;
}

export interface RunCombatFactsLimitations {
  missingCategories: string[];
  truncatedPages: string[];
  notes: string[];
}

/** Stable normalized combat evidence for persistence and scoring fusion. */
export interface RunCombatFacts {
  reportCode: string;
  fightId: number;
  revision: number;
  targetSourceId: number;
  coverage: RunCombatFactsCoverage;
  limitations: RunCombatFactsLimitations;
}

/** Per-dungeon WCL Best%/Median% used for PERFORMANCE (no private report codes). */
export interface WclDungeonPerformanceAggregateDTO {
  dungeonSlug: string;
  dungeonName: string;
  encounterId: number | null;
  bestParsePercentile: number | null;
  medianParsePercentile: number | null;
  loggedRunCount: number;
  specSlug: string | null;
  roleSlug: string | null;
}

export interface WclCharacterSummaryDTO {
  visibility: WclVisibilityState;
  warnings: string[];
  dungeonAggregates: WclDungeonPerformanceAggregateDTO[];
}
