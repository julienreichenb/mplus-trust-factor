import { createHash } from "node:crypto";
import { clamp } from "../../math.js";
import { blendExperienceComponentsV3 } from "./blend.js";
import { computeExperienceConfidenceV3 } from "./confidence.js";
import {
  EXPERIENCE_V3_ALGORITHM_VERSION,
  EXPERIENCE_V3_CALIBRATION_STATUS,
  EXPERIENCE_V3_MODEL_CONFIG,
  EXPERIENCE_V3_MODEL_LABEL,
} from "./constants.js";
import { scoreEliteHistoryV3 } from "./elite-history.js";
import { scoreCurrentExposureV3 } from "./exposure.js";
import { scoreHistoricalRankV3 } from "./historical-rank.js";
import { scorePreviousSeasonStrengthV3 } from "./previous-season.js";
import type {
  ExperienceV3AccountBoostContract,
  ExperienceV3AvailabilityState,
  ExperienceV3ComputeInput,
  ExperienceV3ComputeResult,
  ExperienceV3ContributorDiagnostic,
  ExperienceV3Explanation,
} from "./types.js";

const PHASE2_ACCOUNT_BOOST: ExperienceV3AccountBoostContract = {
  enabled: false,
  linkedCharacterContribution: null,
  ownershipConfidence: null,
  note: "Phase 2 verified Battle.net-linked boost is not implemented; disabled.",
};

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

export function computeExperienceV3InputFingerprint(
  input: ExperienceV3ComputeInput,
): string {
  const payload = {
    algorithmVersion: EXPERIENCE_V3_ALGORITHM_VERSION,
    modelLabel: EXPERIENCE_V3_MODEL_LABEL,
    manifestContentHash: input.manifest.contentHash,
    selectorVersion: input.manifest.selectorVersion,
    highKeyPolicyId: input.manifest.highKeyPolicyId,
    currentExposure: {
      expectedDungeonCount: input.currentExposure.expectedDungeonCount,
      selectedRuns: [...input.currentExposure.selectedRuns]
        .map((r) => ({
          dungeonSlug: r.dungeonSlug,
          keyLevel: r.keyLevel,
          completedAt: r.completedAt,
        }))
        .sort((a, b) =>
          `${a.dungeonSlug}:${a.keyLevel}:${a.completedAt}`.localeCompare(
            `${b.dungeonSlug}:${b.keyLevel}:${b.completedAt}`,
          ),
        ),
      seasonRunCount: input.currentExposure.seasonRuns.length,
      priorSeasonCount: input.currentExposure.priorSeasonCount,
      priorSeasonSourceDepth: input.currentExposure.priorSeasonSourceDepth ?? null,
      provenance: input.currentExposure.provenance,
      observedAt: input.currentExposure.observedAt,
    },
    previousSeason: {
      evidenceState: input.previousSeason.evidenceState,
      score: input.previousSeason.score,
      seasonId: input.previousSeason.seasonId,
      source: input.previousSeason.source,
    },
    previousSeasonPolicy: {
      id: input.previousSeasonPolicy.id,
      version: input.previousSeasonPolicy.version,
      k50: input.previousSeasonPolicy.k50,
      k90: input.previousSeasonPolicy.k90,
      k99: input.previousSeasonPolicy.k99,
    },
    eliteHistory: {
      evidenceState: input.eliteHistory.evidenceState,
      achievements: [...input.eliteHistory.achievements]
        .map((a) => ({
          achievementId: a.achievementId,
          visibility: a.visibility,
          seasonsAgo: a.seasonsAgo,
        }))
        .sort((a, b) => a.achievementId - b.achievementId),
    },
    historicalRank: input.historicalRank
      ? {
          evidenceState: input.historicalRank.evidenceState,
          source: input.historicalRank.source,
          rank: input.historicalRank.rank,
          percentile: input.historicalRank.percentile,
          top10ClassSpecRegion: input.historicalRank.top10ClassSpecRegion,
          seasonId: input.historicalRank.seasonId,
        }
      : null,
    historicalRankPolicy: {
      id: input.historicalRankPolicy.id,
      version: input.historicalRankPolicy.version,
    },
  };
  return createHash("sha256").update(stableStringify(payload)).digest("hex");
}

function resolveAvailability(input: {
  score: number | null;
  componentsAvailable: number;
  componentsTotal: number;
  exposureAvailable: boolean;
}): ExperienceV3AvailabilityState {
  if (input.score == null || !input.exposureAvailable) return "UNAVAILABLE";
  if (input.componentsAvailable < input.componentsTotal) return "PARTIAL";
  return "AVAILABLE";
}

function collectMissingReasons(
  components: ExperienceV3ComputeResult["components"],
): string[] {
  const reasons: string[] = [];
  for (const c of components) {
    if (c.available) continue;
    const reason =
      typeof c.detail.reason === "string" ? c.detail.reason : `${c.key}_unavailable`;
    reasons.push(reason);
  }
  return reasons;
}

/**
 * Provider-free Experience V3 Phase 1 calculator.
 * Consumes frozen manifest identity + Blizzard/local/RIO history facts.
 * No WCL combat events, no current Performance parses, no public alt inference.
 */
export function computeExperienceV3(
  input: ExperienceV3ComputeInput,
): ExperienceV3ComputeResult {
  const config = input.config ?? EXPERIENCE_V3_MODEL_CONFIG;

  const exposure = scoreCurrentExposureV3(input.currentExposure, config);
  const previous = scorePreviousSeasonStrengthV3(
    input.previousSeason,
    input.previousSeasonPolicy,
    config,
  );
  const elite = scoreEliteHistoryV3(input.eliteHistory, config);
  const historical = scoreHistoricalRankV3(
    input.historicalRank,
    input.historicalRankPolicy,
    config,
  );

  const blended = blendExperienceComponentsV3(
    [exposure.component, previous, elite, historical],
    config,
  );

  // Primary exposure provider failure → dimension unavailable (LKG / no fabricate).
  // Secondary history alone must not publish a score when current-history feed failed.
  const exposureProviderFailed =
    input.currentExposure.provenance === "PROVIDER_FAILURE";

  const score =
    exposureProviderFailed ||
    blended.score == null ||
    !Number.isFinite(blended.score)
      ? null
      : clamp(blended.score, 0, 100);

  const conf = computeExperienceConfidenceV3({
    currentExposure: input.currentExposure,
    previousSeason: input.previousSeason,
    previousSeasonPolicy: input.previousSeasonPolicy,
    eliteHistory: input.eliteHistory,
    historicalRank: input.historicalRank,
    historicalRankPolicy: input.historicalRankPolicy,
    components: blended.components,
    config,
  });

  const effectiveConfidence = score == null ? 0 : clamp(conf.confidence, 0, 1);
  const availableCount = blended.components.filter((c) => c.available).length;
  const state = resolveAvailability({
    score,
    componentsAvailable: availableCount,
    componentsTotal: blended.components.length,
    exposureAvailable: exposure.component.available && !exposureProviderFailed,
  });

  const missingEvidenceReasons = collectMissingReasons(blended.components);

  const contributors: ExperienceV3ContributorDiagnostic[] = blended.components.map(
    (c) => ({
      key: `experience.${c.key}`,
      value: c.score,
      weight: c.effectiveWeight,
      note: c.available
        ? blended.renormalized && c.effectiveWeight !== c.weight
          ? "weight_renormalized"
          : null
        : typeof c.detail.reason === "string"
          ? c.detail.reason
          : "unavailable",
    }),
  );

  const eliteDetail = elite.detail;
  const explanation: ExperienceV3Explanation = {
    algorithmVersion: EXPERIENCE_V3_ALGORITHM_VERSION,
    modelLabel: EXPERIENCE_V3_MODEL_LABEL,
    calibrationStatus: EXPERIENCE_V3_CALIBRATION_STATUS,
    components: blended.components,
    currentExposure: {
      score: exposure.component.score,
      v2Components: exposure.v2Components.map((c) => ({
        metricKey: c.metricKey,
        normalizedValue: c.normalizedValue,
        confidence: c.confidence,
      })),
      evidence: exposure.v2Result.evidence as unknown as Record<string, unknown>,
    },
    previousSeason: {
      evidenceState: input.previousSeason.evidenceState,
      source: input.previousSeason.source,
      rawScore: input.previousSeason.score,
      normalizedScore: previous.score,
      policyId: input.previousSeasonPolicy.id,
      policyVersion: input.previousSeasonPolicy.version,
    },
    eliteHistory: {
      evidenceState: input.eliteHistory.evidenceState,
      confirmedTitleCount:
        typeof eliteDetail.confirmedTitleCount === "number"
          ? eliteDetail.confirmedTitleCount
          : 0,
      accountVisibleOnlyCount:
        typeof eliteDetail.accountVisibleOnlyCount === "number"
          ? eliteDetail.accountVisibleOnlyCount
          : 0,
      catalogVersion: config.eliteCatalogVersion,
      normalizedScore: elite.score,
      ambiguityNotes: Array.isArray(eliteDetail.ambiguityNotes)
        ? (eliteDetail.ambiguityNotes as string[])
        : [],
    },
    historicalRank: {
      evidenceState: input.historicalRank?.evidenceState ?? "UNKNOWN",
      source: input.historicalRank?.source ?? "UNKNOWN",
      percentile: input.historicalRank?.percentile ?? null,
      rank: input.historicalRank?.rank ?? null,
      seasonSlug: input.historicalRank?.seasonSlug ?? null,
      normalizedScore: historical.score,
      optional: true,
    },
    accountLinkedBoost: PHASE2_ACCOUNT_BOOST,
    missingEvidenceReasons,
    confidenceLimits: conf.limits,
    noWclDependency: true,
    noCurrentPerformanceLeakage: true,
    noPublicAccountLinkInference: true,
    phase2State: "INACTIVE",
    contributors,
  };

  const inputFingerprint = computeExperienceV3InputFingerprint(input);

  const metrics: Record<string, unknown> = {
    algorithmVersion: EXPERIENCE_V3_ALGORITHM_VERSION,
    modelLabel: EXPERIENCE_V3_MODEL_LABEL,
    calibrationStatus: EXPERIENCE_V3_CALIBRATION_STATUS,
    manifestContentHash: input.manifest.contentHash,
    manifestSchemaVersion: input.manifest.schemaVersion,
    selectorVersion: input.manifest.selectorVersion,
    highKeyPolicyId: input.manifest.highKeyPolicyId,
    previousSeasonPolicyId: input.previousSeasonPolicy.id,
    previousSeasonPolicyVersion: input.previousSeasonPolicy.version,
    eliteCatalogVersion: config.eliteCatalogVersion,
    historicalRankPolicyId: input.historicalRankPolicy.id,
    historicalRankPolicyVersion: input.historicalRankPolicy.version,
    componentScores: Object.fromEntries(
      blended.components.map((c) => [c.key, c.score]),
    ),
    effectiveWeights: Object.fromEntries(
      blended.components.map((c) => [c.key, c.effectiveWeight]),
    ),
    availableWeightSum: blended.availableWeightSum,
    renormalized: blended.renormalized,
    confidenceComponents: conf.components,
    publicationBlocked: true,
    noWclDependency: true,
    phase2AccountBoostEnabled: false,
  };

  return {
    score,
    confidence: effectiveConfidence,
    state: score == null ? "UNAVAILABLE" : state,
    algorithmVersion: EXPERIENCE_V3_ALGORITHM_VERSION,
    modelLabel: EXPERIENCE_V3_MODEL_LABEL,
    calibrationStatus: EXPERIENCE_V3_CALIBRATION_STATUS,
    inputFingerprint,
    components: blended.components,
    explanation,
    metrics,
  };
}

/**
 * Shadow DimensionComputation payload builder (persistence wiring is worker-owned).
 */
export function toExperienceV3ShadowDimensionPayload(input: {
  characterId: string;
  seasonId: string;
  manifestId: string;
  scoreModelId: string;
  result: ExperienceV3ComputeResult;
  computedAt: Date;
}): {
  characterId: string;
  seasonId: string;
  manifestId: string;
  scoreModelId: string;
  dimension: "EXPERIENCE";
  algorithmVersion: string;
  inputFingerprint: string;
  score: number | null;
  confidence: number;
  state: "SHADOW";
  metrics: Record<string, unknown>;
  explanation: ExperienceV3Explanation;
  computedAt: Date;
} {
  return {
    characterId: input.characterId,
    seasonId: input.seasonId,
    manifestId: input.manifestId,
    scoreModelId: input.scoreModelId,
    dimension: "EXPERIENCE",
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
