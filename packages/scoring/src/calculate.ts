import type { DimensionScoreDTO, ScoreModelConfig, ScoreSnapshotDTO } from "@mplus/contracts";
import { calculateAuthenticity } from "./authenticity.js";
import { calculateDimensionScores } from "./dimensions.js";
import { explainScore } from "./explain.js";
import { computeInputFingerprint } from "./fingerprint.js";
import { calculateMetricScores } from "./metrics.js";
import {
  createDefaultModelV1,
  createDefaultModelV2,
  createDefaultModelV3,
  createDefaultModelV4,
  createDefaultModelV5,
  createDefaultModelV6,
} from "./model/defaults.js";
import { presentDimensionScores } from "./present.js";
import type { CalculateScoreEngineInput, ScoreModelConfigV1, ScoringContext } from "./types.js";
import { calculateFinalTrust, calculateOverallConfidence, calculateSkillScore } from "./trust.js";
import { validateScoreModelConfig } from "./validate.js";
import { computeModelCoverage, filterPublicSkillDimensions } from "./model-coverage.js";

/** Backward-compatible placeholder input shape used by foundation stubs. */
export interface CalculateScoreInput {
  characterId: string;
  seasonSlug: string;
  model: ScoreModelConfigV1 | ScoreModelConfig;
  scopeType: CalculateScoreEngineInput["scopeType"];
  scopeKey: string | null;
  observations: CalculateScoreEngineInput["observations"];
  calculatedAt: string;
  inputFingerprint: string;
  context?: ScoringContext;
}

function coerceModel(model: CalculateScoreInput["model"]): ScoreModelConfigV1 {
  // Always merge through defaults so seeded/slim DB configs (metricWeights without
  // normalization/confidenceBlend/etc.) remain valid ScoreModelConfigV1 documents.
  const partial = model as Partial<ScoreModelConfigV1> & ScoreModelConfig;
  const version = partial.version ?? 1;
  const factory =
    version >= 6
      ? createDefaultModelV6
      : version >= 5
        ? createDefaultModelV5
        : version >= 4
          ? createDefaultModelV4
          : version >= 3
            ? createDefaultModelV3
            : version >= 2
              ? createDefaultModelV2
              : createDefaultModelV1;
  return factory({
    key: partial.key,
    version: partial.version,
    weights: partial.weights,
    authenticityBlend: partial.authenticityBlend,
    confidenceNeutralScore: partial.confidenceNeutralScore,
    gradeThresholds: partial.gradeThresholds,
    minConfidenceForGrade: partial.minConfidenceForGrade,
    ...(partial.metricWeights ? { metricWeights: partial.metricWeights } : {}),
  });
}

/**
 * Deterministic Trust Factor calculation.
 * Pure: no network, no database, no implicit clock.
 */
export function calculateScore(input: CalculateScoreInput): ScoreSnapshotDTO {
  const model = coerceModel(input.model);
  const validation = validateScoreModelConfig(model);
  if (!validation.ok) {
    throw new Error(`Invalid ScoreModelConfig: ${validation.errors.join("; ")}`);
  }

  const context: ScoringContext = input.context ?? {
    role: "DPS",
    freshness: 0.7,
    selectedRunCoverage: 0.5,
  };

  const engineInput: CalculateScoreEngineInput = {
    characterId: input.characterId,
    seasonSlug: input.seasonSlug,
    model,
    scopeType: input.scopeType,
    scopeKey: input.scopeKey,
    observations: input.observations,
    context,
    calculatedAt: input.calculatedAt,
    inputFingerprint: input.inputFingerprint,
  };

  return calculateScoreEngine(engineInput);
}

export function calculateScoreEngine(input: CalculateScoreEngineInput): ScoreSnapshotDTO {
  const { model, observations, context } = input;
  const validation = validateScoreModelConfig(model);
  if (!validation.ok) {
    throw new Error(`Invalid ScoreModelConfig: ${validation.errors.join("; ")}`);
  }

  const metricScores = calculateMetricScores(observations, model, context);
  const dimensions = calculateDimensionScores(observations, model, context, metricScores);
  const authenticity = calculateAuthenticity(context.authenticity, model);
  const skillScore = calculateSkillScore(dimensions);
  const confidence = calculateOverallConfidence(dimensions, model, context);
  const trust = calculateFinalTrust({
    skillScore,
    authenticityScore: authenticity.authenticityScore,
    confidence,
    model,
  });
  const modelCoverage = computeModelCoverage(dimensions, model);
  const finalTrust =
    modelCoverage.overallState === "PROVISIONAL" ? { ...trust, grade: "U" as const } : trust;
  const explanation = explainScore({
    dimensions,
    authenticity,
    trust: finalTrust,
    model,
    context,
    modelCoverage,
  });

  const fingerprint =
    input.inputFingerprint ??
    computeInputFingerprint({
      characterId: input.characterId,
      seasonSlug: input.seasonSlug,
      model,
      scopeType: input.scopeType,
      scopeKey: input.scopeKey,
      observations,
      context,
    });

  const dimensionDtos: DimensionScoreDTO[] = presentDimensionScores(
    filterPublicSkillDimensions(dimensions),
  );

  const redFlags = [...authenticity.redFlags];
  const minConfidence = model.minConfidenceForGrade ?? 0.35;
  if (confidence < minConfidence) {
    redFlags.push({
      key: "insufficient_data",
      label: "Insufficient data",
      severity: "INFO",
      confidence: 1 - confidence,
      public: true,
      evidence: { confidence, minConfidenceForGrade: minConfidence },
    });
  }
  if (modelCoverage.overallState === "PROVISIONAL") {
    redFlags.push({
      key: "provisional_score",
      label: "Provisional score",
      severity: "INFO",
      confidence: 1 - modelCoverage.modelCoverageRatio,
      public: true,
      evidence: {
        availableModelWeight: modelCoverage.availableModelWeight,
        totalModelWeight: modelCoverage.totalModelWeight,
        modelCoverageRatio: modelCoverage.modelCoverageRatio,
        reason: modelCoverage.provisionalReason,
      },
    });
  }

  // LOGS_HIDDEN only for explicit HIDDEN visibility — never infer from low coverage.
  const wclVisibility =
    typeof context.wclVisibility === "string"
      ? context.wclVisibility
      : observations
          .map((o) =>
            typeof o.context === "object" && o.context !== null
              ? (o.context as { wclVisibility?: string }).wclVisibility
              : undefined,
          )
          .find((v) => typeof v === "string");
  const explicitHidden =
    wclVisibility === "HIDDEN" ||
    observations.some(
      (o) =>
        typeof o.context === "object" &&
        o.context !== null &&
        (o.context as { logsHidden?: boolean }).logsHidden === true,
    );
  if (explicitHidden) {
    redFlags.push({
      key: "logs_hidden",
      label: "Logs hidden",
      severity: "MEDIUM",
      confidence: 0.9,
      public: true,
      evidence: { wclVisibility: wclVisibility ?? "HIDDEN" },
    });
  } else if (wclVisibility === "NO_PUBLIC_LOGS") {
    redFlags.push({
      key: "no_public_logs",
      label: "No public logs",
      severity: "LOW",
      confidence: 0.85,
      public: true,
      evidence: { wclVisibility },
    });
  } else if (wclVisibility === "UNAVAILABLE") {
    redFlags.push({
      key: "wcl_unavailable",
      label: "Warcraft Logs unavailable",
      severity: "INFO",
      confidence: 0.7,
      public: true,
      evidence: { wclVisibility },
    });
  } else if (wclVisibility === "RATE_LIMITED") {
    redFlags.push({
      key: "wcl_rate_limited",
      label: "Warcraft Logs rate limited",
      severity: "INFO",
      confidence: 0.7,
      public: true,
      evidence: { wclVisibility },
    });
  } else if (
    (wclVisibility === "PUBLIC" || wclVisibility === "NO_MATCHED_RUN") &&
    (context.selectedRunCoverage ?? 1) <= 0 &&
    (context.matchedWclRunCount ?? 0) === 0
  ) {
    redFlags.push({
      key: "no_matched_run",
      label: "No matched public run",
      severity: "LOW",
      confidence: 0.75,
      public: true,
      evidence: {
        wclVisibility,
        selectedRunCoverage: context.selectedRunCoverage ?? 0,
      },
    });
  }

  return {
    characterId: input.characterId,
    seasonSlug: input.seasonSlug,
    modelKey: model.key,
    modelVersion: model.version,
    scopeType: input.scopeType,
    scopeKey: input.scopeKey,
    overallScore: finalTrust.overallScore,
    grade: finalTrust.grade,
    skillScore: finalTrust.skillScore,
    authenticityScore: finalTrust.authenticityScore,
    confidence: finalTrust.confidence,
    overallState: modelCoverage.overallState,
    availableModelWeight: modelCoverage.availableModelWeight,
    totalModelWeight: modelCoverage.totalModelWeight,
    modelCoverageRatio: modelCoverage.modelCoverageRatio,
    provisionalReason: modelCoverage.provisionalReason,
    calculatedAt: input.calculatedAt,
    inputFingerprint: fingerprint,
    dimensions: dimensionDtos,
    redFlags: dedupeFlags(redFlags),
    explanation,
  };
}

function dedupeFlags(flags: ScoreSnapshotDTO["redFlags"]): ScoreSnapshotDTO["redFlags"] {
  const seen = new Set<string>();
  const out: ScoreSnapshotDTO["redFlags"] = [];
  for (const flag of flags) {
    if (seen.has(flag.key)) continue;
    seen.add(flag.key);
    out.push(flag);
  }
  return out;
}
