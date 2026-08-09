import { clamp01 } from "../../math.js";
import { PERFORMANCE_V2_MODEL_CONFIG, type PerformanceV2ModelConfig } from "./constants.js";
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
  config?: PerformanceV2ModelConfig;
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
  const hardLimits: string[] = [];

  if (input.sourcesUsed === "none" || !input.roleAdapter.runParseAllowed && !input.hasProfile) {
    if (input.roleAdapter.state !== "SUPPORTED") {
      hardLimits.push(`role_adapter:${input.roleAdapter.reason ?? input.roleAdapter.state}`);
    }
    return {
      confidence: 0,
      limits: hardLimits.length > 0 ? hardLimits : ["no_performance_evidence"],
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
    hardLimits.push("partition_mismatch");
    base *= 0.75;
  }

  if (input.roleAdapter.state !== "SUPPORTED") {
    hardLimits.push(`role_adapter:${input.roleAdapter.reason ?? input.roleAdapter.state}`);
    base *= 0.5;
  }

  if (input.sourcesUsed === "profile") {
    hardLimits.push("profile_only");
    base *= 0.7;
  } else if (input.sourcesUsed === "detailed") {
    hardLimits.push("detailed_only");
    base *= 0.85;
  }

  if (input.oneRunDungeonCount > 0 && input.twoRunDungeonCount === 0) {
    hardLimits.push("one_run_dungeons_only");
    base = Math.min(base, config.oneRunDungeonConfidenceCap);
  } else if (input.oneRunDungeonCount > 0) {
    hardLimits.push("partial_one_run_dungeons");
    base = Math.min(base, 0.85);
  }

  const softLimits: string[] = [];
  // Explicit coverage causes (machine-readable) when evidence is incomplete.
  if (dungeonCoverage < 1) softLimits.push("incomplete_dungeon_coverage");
  if (slotCoverage < 1) softLimits.push("incomplete_detailed_slot_coverage");
  if (twoRunShare < 1 && scoredDungeons > 0) softLimits.push("incomplete_two_run_coverage");
  if (!input.hasProfile) softLimits.push("missing_profile_aggregate");
  if (freshness < 1) softLimits.push("stale_log_freshness");
  if (policyConfidence < 1) softLimits.push("difficulty_policy_confidence_reduced");

  const confidence = clamp01(base);
  // Soft coverage tags only when they actually leave confidence imperfect.
  // Hard multipliers/caps above always emit regardless (they force conf < 1 when applied).
  const limits =
    confidence < 1
      ? [...new Set([...hardLimits, ...softLimits])]
      : [...new Set(hardLimits)];
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
