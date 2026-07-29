/**
 * Shared Warcraft Logs DTOs (CR-14).
 * Full event arrays / actor Maps remain provider-local; persist this shape.
 */

/**
 * Character profile visibility on Warcraft Logs.
 * Matching / coverage outcomes must never be stored here — use `WclDataState`.
 */
export type WclVisibilityState = "PUBLIC" | "HIDDEN";

/**
 * Ingestion / matching / coverage outcome for WCL enrichment.
 * Independent from whether the character profile itself is public or hidden.
 */
export type WclDataState =
  | "MATCHED_COMBAT_LOGS"
  | "RANKINGS_ONLY"
  | "NO_MATCHED_RUN"
  | "NO_PUBLIC_LOGS"
  | "UNAVAILABLE"
  | "RATE_LIMITED";

/** How WCL contributed observations to the current score snapshot. */
export type WclContributionType =
  "ZONE_RANKINGS" | "COMBAT_FACTS" | "COMBAT_EVENTS" | "PERFORMANCE" | "SURVIVAL";

export interface WclProvenance {
  /** Explicit profile visibility; null when discovery failed / unknown. */
  visibility: WclVisibilityState | null;
  /** Matching / rankings / availability outcome. */
  dataState: WclDataState | null;
}

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
  /** Displayed contextual run count — confidence input only. */
  loggedRunCount: number;
  specSlug: string | null;
  roleSlug: string | null;
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

export interface WclCharacterSummaryDTO {
  visibility: WclVisibilityState | null;
  dataState: WclDataState;
  warnings: string[];
  dungeonAggregates: WclDungeonPerformanceAggregateDTO[];
  /** Complete raw points_and_damage payload when fetched. */
  rawZoneRankingsPointsAndDamage?: unknown;
  performanceState?: "OK" | "ERROR" | "SCHEMA_UNSUPPORTED" | "SKIPPED" | "EMPTY" | null;
}

/**
 * Map legacy persisted visibility strings (pre-split) into visibility + dataState.
 * `NO_MATCHED_RUN` / rankings outcomes are never treated as visibility.
 */
export function normalizeWclProvenance(
  rawVisibility: string | null | undefined,
  rawDataState?: string | null | undefined,
): WclProvenance {
  const dataFromRaw = parseWclDataState(rawDataState);
  switch (rawVisibility) {
    case "PUBLIC":
      return { visibility: "PUBLIC", dataState: dataFromRaw };
    case "HIDDEN":
      return { visibility: "HIDDEN", dataState: dataFromRaw ?? "NO_PUBLIC_LOGS" };
    case "NO_MATCHED_RUN":
      return { visibility: "PUBLIC", dataState: dataFromRaw ?? "NO_MATCHED_RUN" };
    case "NO_PUBLIC_LOGS":
    case "PRIVATE_SKIPPED":
      return { visibility: "PUBLIC", dataState: dataFromRaw ?? "NO_PUBLIC_LOGS" };
    case "RATE_LIMITED":
      return { visibility: null, dataState: dataFromRaw ?? "RATE_LIMITED" };
    case "UNAVAILABLE":
      return { visibility: null, dataState: dataFromRaw ?? "UNAVAILABLE" };
    default:
      return { visibility: null, dataState: dataFromRaw };
  }
}

export function parseWclDataState(value: unknown): WclDataState | null {
  if (
    value === "MATCHED_COMBAT_LOGS" ||
    value === "RANKINGS_ONLY" ||
    value === "NO_MATCHED_RUN" ||
    value === "NO_PUBLIC_LOGS" ||
    value === "UNAVAILABLE" ||
    value === "RATE_LIMITED"
  ) {
    return value;
  }
  return null;
}

/**
 * Refine data-state after combat matching / zone-ranking aggregation.
 * Never changes an established PUBLIC/HIDDEN visibility.
 */
export function refineWclDataState(input: {
  visibility: WclVisibilityState | null;
  baseDataState: WclDataState | null;
  combatFactsCount: number;
  dungeonAggregateCount: number;
}): WclDataState | null {
  const { visibility, baseDataState, combatFactsCount, dungeonAggregateCount } = input;
  if (baseDataState === "RATE_LIMITED" || baseDataState === "UNAVAILABLE") {
    return baseDataState;
  }
  if (visibility === "HIDDEN") {
    return "NO_PUBLIC_LOGS";
  }
  if (baseDataState === "NO_PUBLIC_LOGS") {
    return "NO_PUBLIC_LOGS";
  }
  if (visibility === "PUBLIC" || visibility == null) {
    if (combatFactsCount > 0) return "MATCHED_COMBAT_LOGS";
    if (dungeonAggregateCount > 0) return "RANKINGS_ONLY";
    if (visibility === "PUBLIC") return "NO_MATCHED_RUN";
  }
  return baseDataState;
}

/** Infer public-safe WCL contribution kinds from score observations. */
export function deriveWclContributionTypes(
  observations: Array<{
    sourceProvider?: string | null;
    context?: unknown;
    metricKey?: string | null;
  }>,
): WclContributionType[] {
  const types = new Set<WclContributionType>();
  for (const obs of observations) {
    if (obs.sourceProvider !== "warcraftlogs") continue;
    const derivedFrom =
      obs.context && typeof obs.context === "object"
        ? (obs.context as { derivedFrom?: unknown }).derivedFrom
        : null;
    const key = obs.metricKey ?? "";
    if (
      key.startsWith("performance.") ||
      (typeof derivedFrom === "string" && derivedFrom.includes("wcl_zone_rankings"))
    ) {
      types.add("PERFORMANCE");
      types.add("ZONE_RANKINGS");
      continue;
    }
    if (
      key === "survival.outcome" ||
      key === "survival.defensive_response" ||
      key === "survival.emergency_recovery"
    ) {
      types.add("SURVIVAL");
      types.add("COMBAT_EVENTS");
      continue;
    }
    if (
      key.startsWith("survival.") ||
      key.startsWith("utility.") ||
      (typeof derivedFrom === "string" && derivedFrom.includes("combat"))
    ) {
      types.add("COMBAT_FACTS");
      types.add("COMBAT_EVENTS");
    }
  }
  return [...types];
}
