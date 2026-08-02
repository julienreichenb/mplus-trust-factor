import { createHash } from "node:crypto";
import { clamp } from "../../math.js";
import { blendPerformanceSources, computeDetailedWeight } from "./blend.js";
import { computePerformanceConfidenceV2 } from "./confidence.js";
import {
  PERFORMANCE_V2_ALGORITHM_VERSION,
  PERFORMANCE_V2_CALIBRATION_STATUS,
  PERFORMANCE_V2_MODEL_CONFIG,
  PERFORMANCE_V2_MODEL_LABEL,
} from "./constants.js";
import { computeDetailedSeasonPerformance } from "./dungeon.js";
import {
  computeEqualDungeonProfilePerformance,
  computeProfilePerformance,
} from "./profile.js";
import { resolvePerformanceRoleAdapter } from "./role-adapter.js";
import type {
  PerformanceContributorDiagnosticV2,
  PerformanceExplanationV2,
  PerformanceV2AvailabilityState,
  PerformanceV2ComputeInput,
  PerformanceV2ComputeResult,
} from "./types.js";

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => stableStringify(v)).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

export function computePerformanceV2InputFingerprint(
  input: PerformanceV2ComputeInput,
): string {
  const payload = {
    algorithmVersion: PERFORMANCE_V2_ALGORITHM_VERSION,
    modelLabel: PERFORMANCE_V2_MODEL_LABEL,
    manifestContentHash: input.manifest.contentHash,
    selectorVersion: input.manifest.selectorVersion,
    highKeyPolicyId: input.manifest.highKeyPolicyId,
    difficultyPolicy: {
      id: input.difficultyPolicy.id,
      version: input.difficultyPolicy.version,
      k50: input.difficultyPolicy.k50,
      k90: input.difficultyPolicy.k90,
      k99: input.difficultyPolicy.k99,
    },
    expectedPartition: input.expectedPartition,
    runParseFacts: [...input.runParseFacts]
      .map((f) => ({
        slotId: f.slotId,
        dungeonSlug: f.dungeonSlug,
        keyLevel: f.keyLevel,
        parsePercentile: f.parsePercentile,
        semantic: f.semantic,
        partition: f.partition,
      }))
      .sort((a, b) => a.slotId.localeCompare(b.slotId)),
    profile: input.profileAggregate
      ? {
          best: input.profileAggregate.bestDpsPercentileAverage,
          median: input.profileAggregate.medianDpsPercentileAverage,
          partition: input.profileAggregate.partition,
          totalLoggedRuns: input.profileAggregate.totalLoggedRuns,
        }
      : null,
  };
  return createHash("sha256").update(stableStringify(payload)).digest("hex");
}

function evaluatePartitionCompatibility(input: PerformanceV2ComputeInput): boolean {
  if (input.expectedPartition == null) return true;
  if (
    input.profileAggregate?.partition != null &&
    input.profileAggregate.partition !== input.expectedPartition
  ) {
    return false;
  }
  for (const fact of input.runParseFacts) {
    if (fact.partition != null && fact.partition !== input.expectedPartition) {
      return false;
    }
  }
  return true;
}

function resolveAvailability(input: {
  score: number | null;
  sourcesUsed: "both" | "detailed" | "profile" | "none";
  roleAdapterSupported: boolean;
  validDetailedSlotCount: number;
  expectedSlotCount: number;
}): PerformanceV2AvailabilityState {
  if (input.score == null) return "UNAVAILABLE";
  if (!input.roleAdapterSupported && input.sourcesUsed === "profile") return "PARTIAL";
  if (input.sourcesUsed === "profile" || input.sourcesUsed === "detailed") return "PARTIAL";
  if (input.validDetailedSlotCount < input.expectedSlotCount) return "PARTIAL";
  return "AVAILABLE";
}

/**
 * Provider-free Performance V2 Phase 1 calculator.
 * Consumes a frozen manifest identity + bound parse/profile facts only.
 * Does not call providers, reselect runs, or mutate public snapshots.
 */
export function computePerformanceV2(
  input: PerformanceV2ComputeInput,
): PerformanceV2ComputeResult {
  const config = PERFORMANCE_V2_MODEL_CONFIG;
  const roleAdapter = resolvePerformanceRoleAdapter({
    role: input.manifest.role,
    specSlug: input.manifest.specSlug,
    config,
  });

  const partitionCompatible = evaluatePartitionCompatibility(input);

  // Unsupported / unverified roles must not fabricate scores from DPS parse or
  // DPS profile aggregates (no raw HPS / unscoped DPS fallback).
  const evidenceAllowed = roleAdapter.state === "SUPPORTED";

  const detailed = computeDetailedSeasonPerformance({
    runParseFacts: input.runParseFacts,
    activeDungeonSlugs: input.manifest.activeDungeonSlugs,
    difficultyPolicy: input.difficultyPolicy,
    runParseAllowed: evidenceAllowed && roleAdapter.runParseAllowed,
    config,
  });

  const profilePerformance = evidenceAllowed
    ? computeProfilePerformance(input.profileAggregate, config)
    : null;
  const profileEqualDungeonPerformance =
    evidenceAllowed && input.profileAggregate
      ? computeEqualDungeonProfilePerformance(
          input.profileAggregate.perDungeon,
          input.manifest.activeDungeonSlugs,
          config,
        )
      : null;

  const profileDisagreement =
    profilePerformance != null && profileEqualDungeonPerformance != null
      ? Math.abs(profilePerformance - profileEqualDungeonPerformance)
      : null;

  const { slotCoverage, detailedWeight } = computeDetailedWeight(
    detailed.validDetailedSlotCount,
    input.manifest.expectedSlotCount,
    config,
  );

  const blended = blendPerformanceSources({
    detailedSeasonPerformance: detailed.detailedSeasonPerformance,
    profilePerformance,
    detailedWeight,
  });

  const score =
    blended.score == null || !Number.isFinite(blended.score)
      ? null
      : clamp(blended.score, 0, 100);

  const conf = computePerformanceConfidenceV2({
    expectedDungeonCount: input.manifest.activeDungeonSlugs.length,
    dungeonsWithScore: detailed.dungeons.length,
    expectedSlotCount: input.manifest.expectedSlotCount,
    validDetailedSlotCount: detailed.validDetailedSlotCount,
    twoRunDungeonCount: detailed.twoRunDungeonCount,
    oneRunDungeonCount: detailed.oneRunDungeonCount,
    hasProfile: profilePerformance != null,
    roleAdapter,
    partitionCompatible,
    logFreshness: input.logFreshness,
    policyConfidence: input.difficultyPolicy.confidence,
    totalLoggedRuns: input.profileAggregate?.totalLoggedRuns ?? null,
    sourcesUsed: blended.sourcesUsed,
    config,
  });

  const effectiveScore = evidenceAllowed ? score : null;
  const effectiveConfidence =
    effectiveScore == null ? 0 : clamp(conf.confidence, 0, 1);

  const state = resolveAvailability({
    score: effectiveScore,
    sourcesUsed: blended.sourcesUsed,
    roleAdapterSupported: roleAdapter.state === "SUPPORTED",
    validDetailedSlotCount: detailed.validDetailedSlotCount,
    expectedSlotCount: input.manifest.expectedSlotCount,
  });

  const activeSet = new Set(input.manifest.activeDungeonSlugs);
  const scoredSet = new Set(detailed.dungeons.map((d) => d.dungeonSlug));
  const missingDungeons = input.manifest.activeDungeonSlugs.filter((s) => !scoredSet.has(s));
  const missingSlots = Math.max(
    0,
    input.manifest.expectedSlotCount - detailed.validDetailedSlotCount,
  );

  const contributors: PerformanceContributorDiagnosticV2[] = [
    {
      key: "performance.detailed_season",
      value: detailed.detailedSeasonPerformance,
      weight: blended.effectiveDetailedWeight,
      note: null,
    },
    {
      key: "performance.profile_stabilizer",
      value: profilePerformance,
      weight: 1 - blended.effectiveDetailedWeight,
      note: null,
    },
    {
      key: "performance.slot_coverage",
      value: slotCoverage * 100,
      weight: null,
      note: null,
    },
    {
      key: "performance.profile_disagreement",
      value: profileDisagreement,
      weight: null,
      note:
        profileDisagreement != null &&
        profileDisagreement >= config.profileDisagreementDiagnosticThreshold
          ? "large_profile_vs_equal_dungeon_disagreement"
          : null,
    },
    ...detailed.dungeons.map((d) => ({
      key: `performance.dungeon.${d.dungeonSlug}`,
      value: d.dungeonPerformance,
      weight: null as number | null,
      note: d.oneRunConfidenceCapped ? "one_run_confidence_capped" : null,
    })),
  ];

  const selectedRuns = [...input.runParseFacts]
    .filter((f) => activeSet.has(f.dungeonSlug))
    .sort((a, b) => a.slotId.localeCompare(b.slotId))
    .map((f) => {
      const matched = detailed.dungeons
        .flatMap((d) => d.runs)
        .find((r) => r.slotId === f.slotId);
      return {
        slotId: f.slotId,
        dungeonSlug: f.dungeonSlug,
        keyLevel: f.keyLevel,
        rawParsePercentile: matched?.rawParsePercentile ?? f.parsePercentile,
        adjustedParse: matched?.adjustedParse ?? null,
        semantic: f.semantic,
      };
    });

  const explanation: PerformanceExplanationV2 = {
    algorithmVersion: PERFORMANCE_V2_ALGORITHM_VERSION,
    modelLabel: PERFORMANCE_V2_MODEL_LABEL,
    calibrationStatus: PERFORMANCE_V2_CALIBRATION_STATUS,
    difficultyPolicy: {
      id: input.difficultyPolicy.id,
      version: input.difficultyPolicy.version,
      k50: input.difficultyPolicy.k50,
      k90: input.difficultyPolicy.k90,
      k99: input.difficultyPolicy.k99,
      source: input.difficultyPolicy.source,
      confidence: input.difficultyPolicy.confidence,
    },
    roleAdapter,
    selectedRuns,
    dungeons: detailed.dungeons,
    detailedSeasonPerformance: detailed.detailedSeasonPerformance,
    profilePerformance,
    profileEqualDungeonPerformance,
    profileDisagreement,
    slotCoverage,
    detailedWeight: blended.effectiveDetailedWeight,
    missingSlots,
    missingDungeons,
    partitionCompatible,
    confidenceLimits: conf.limits,
    phase2State: "INACTIVE",
    phase3State: "INACTIVE",
    contributors,
  };

  const inputFingerprint = computePerformanceV2InputFingerprint(input);

  const metrics: Record<string, unknown> = {
    algorithmVersion: PERFORMANCE_V2_ALGORITHM_VERSION,
    modelLabel: PERFORMANCE_V2_MODEL_LABEL,
    calibrationStatus: PERFORMANCE_V2_CALIBRATION_STATUS,
    manifestContentHash: input.manifest.contentHash,
    manifestSchemaVersion: input.manifest.schemaVersion,
    selectorVersion: input.manifest.selectorVersion,
    difficultyPolicyId: input.difficultyPolicy.id,
    difficultyPolicyVersion: input.difficultyPolicy.version,
    highKeyPolicyId: input.manifest.highKeyPolicyId,
    detailedSeasonPerformance: detailed.detailedSeasonPerformance,
    profilePerformance,
    detailedWeight: blended.effectiveDetailedWeight,
    slotCoverage,
    validDetailedSlotCount: detailed.validDetailedSlotCount,
    expectedSlotCount: input.manifest.expectedSlotCount,
    twoRunDungeonCount: detailed.twoRunDungeonCount,
    oneRunDungeonCount: detailed.oneRunDungeonCount,
    sourcesUsed: blended.sourcesUsed,
    partitionCompatible,
    roleAdapterState: roleAdapter.state,
    confidenceComponents: conf.components,
    publicationBlocked: true,
  };

  return {
    score: effectiveScore,
    confidence: effectiveConfidence,
    state: effectiveScore == null ? "UNAVAILABLE" : state,
    algorithmVersion: PERFORMANCE_V2_ALGORITHM_VERSION,
    modelLabel: PERFORMANCE_V2_MODEL_LABEL,
    calibrationStatus: PERFORMANCE_V2_CALIBRATION_STATUS,
    inputFingerprint,
    detailedSeasonPerformance: detailed.detailedSeasonPerformance,
    profilePerformance,
    detailedWeight: blended.effectiveDetailedWeight,
    slotCoverage,
    dungeons: detailed.dungeons,
    roleAdapter,
    explanation,
    metrics,
  };
}

/**
 * Shadow DimensionComputation payload builder (persistence wiring is shared/worker-owned).
 */
export function toPerformanceV2ShadowDimensionPayload(input: {
  characterId: string;
  seasonId: string;
  manifestId: string;
  scoreModelId: string;
  result: PerformanceV2ComputeResult;
  computedAt: Date;
}): {
  characterId: string;
  seasonId: string;
  manifestId: string;
  scoreModelId: string;
  dimension: "PERFORMANCE";
  algorithmVersion: string;
  inputFingerprint: string;
  score: number | null;
  confidence: number;
  state: "SHADOW";
  metrics: Record<string, unknown>;
  explanation: PerformanceExplanationV2;
  computedAt: Date;
} {
  return {
    characterId: input.characterId,
    seasonId: input.seasonId,
    manifestId: input.manifestId,
    scoreModelId: input.scoreModelId,
    dimension: "PERFORMANCE",
    algorithmVersion: input.result.algorithmVersion,
    inputFingerprint: input.result.inputFingerprint,
    score: input.result.score,
    confidence: input.result.confidence,
    state: "SHADOW",
    metrics: input.result.metrics,
    explanation: input.result.explanation,
    computedAt: input.computedAt,
  };
}
