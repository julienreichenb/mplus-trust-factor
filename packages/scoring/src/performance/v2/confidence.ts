import { clamp01 } from "../../math.js";
import { PERFORMANCE_V2_MODEL_CONFIG } from "./constants.js";
import type { PerformanceRoleAdapterResultV2 } from "./types.js";

export interface PerformanceConfidenceInputV2 {
  expectedDungeonCount: number;
  dungeonsWithScore: number;
  expectedSlotCount: number;
  validDetailedSlotCount: number;
  twoRunDungeonCount: number;
  oneRunDungeonCount: number;
  hasProfile: boolean;
  roleAdapter: PerformanceRoleAdapterResultV2;
  partitionCompatible: boolean;
  logFreshness: number;
  policyConfidence: number;
  /** Displayed WCL run count — small contextual factor only. */
  totalLoggedRuns: number | null;
  sourcesUsed: "both" | "detailed" | "profile" | "none";
  config?: typeof PERFORMANCE_V2_MODEL_CONFIG;
}

/**
 * Independent Performance confidence in [0, 1].
 * Missing data lowers confidence; never invents scores.
 */
export function computePerformanceConfidenceV2(input: PerformanceConfidenceInputV2): {
  confidence: number;
  limits: string[];
  components: Record<string, number>;
} {
  const config = input.config ?? PERFORMANCE_V2_MODEL_CONFIG;
  const limits: string[] = [];

  if (input.sourcesUsed === "none" || !input.roleAdapter.runParseAllowed && !input.hasProfile) {
    if (input.roleAdapter.state !== "SUPPORTED") {
      limits.push(`role_adapter:${input.roleAdapter.reason ?? input.roleAdapter.state}`);
    }
    return {
      confidence: 0,
      limits: limits.length > 0 ? limits : ["no_performance_evidence"],
      components: {},
    };
  }

  const expectedDungeons = Math.max(1, input.expectedDungeonCount);
  const dungeonCoverage = clamp01(input.dungeonsWithScore / expectedDungeons);
  const expectedSlots = Math.max(1, input.expectedSlotCount);
  const slotCoverage = clamp01(input.validDetailedSlotCount / expectedSlots);
  const scoredDungeons = Math.max(0, input.dungeonsWithScore);
  const twoRunShare =
    scoredDungeons === 0 ? 0 : clamp01(input.twoRunDungeonCount / scoredDungeons);
  const profileAvailability = input.hasProfile ? 1 : 0;
  const adapterValidity = input.roleAdapter.state === "SUPPORTED" ? 1 : 0.25;
  const partitionCompatibility = input.partitionCompatible ? 1 : 0.35;
  const freshness = clamp01(input.logFreshness);
  const policyConfidence = clamp01(input.policyConfidence);

  const w = config.confidenceWeights;
  let base =
    w.dungeonCoverage * dungeonCoverage +
    w.slotCoverage * slotCoverage +
    w.twoRunShare * twoRunShare +
    w.profileAvailability * profileAvailability +
    w.adapterValidity * adapterValidity +
    w.partitionCompatibility * partitionCompatibility +
    w.freshness * freshness +
    w.policyConfidence * policyConfidence;

  // Small contextual boost from displayed run count — never substitutes slot coverage.
  const logged = input.totalLoggedRuns ?? 0;
  const loggedFactor =
    logged <= 0 ? 0 : clamp01(Math.log10(1 + logged) / Math.log10(1 + 40));
  base = clamp01(base + config.loggedRunCountContextualWeight * loggedFactor);

  if (!input.partitionCompatible) {
    limits.push("partition_mismatch");
    base *= 0.75;
  }

  if (input.roleAdapter.state !== "SUPPORTED") {
    limits.push(`role_adapter:${input.roleAdapter.reason ?? input.roleAdapter.state}`);
    base *= 0.5;
  }

  if (input.sourcesUsed === "profile") {
    limits.push("profile_only");
    base *= 0.7;
  } else if (input.sourcesUsed === "detailed") {
    limits.push("detailed_only");
    base *= 0.85;
  }

  if (input.oneRunDungeonCount > 0 && input.twoRunDungeonCount === 0) {
    limits.push("one_run_dungeons_only");
    base = Math.min(base, config.oneRunDungeonConfidenceCap);
  } else if (input.oneRunDungeonCount > 0) {
    limits.push("partial_one_run_dungeons");
    base = Math.min(base, 0.85);
  }

  const confidence = clamp01(base);
  return {
    confidence,
    limits,
    components: {
      dungeonCoverage,
      slotCoverage,
      twoRunShare,
      profileAvailability,
      adapterValidity,
      partitionCompatibility,
      freshness,
      policyConfidence,
      loggedFactor,
    },
  };
}
