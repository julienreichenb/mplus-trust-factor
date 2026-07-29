import { approxEqual, sum } from "./math.js";
import type { ScoreModelConfigV1, ValidationResult } from "./types.js";
import { SKILL_DIMENSIONS } from "./types.js";

const SUPPORTED_NORM = new Set([
  "identity",
  "percentile",
  "logistic",
  "piecewise",
  "winsorize",
  "season_decay",
]);

export function validateScoreModelConfig(config: ScoreModelConfigV1): ValidationResult {
  const errors: string[] = [];

  if (!config.key) errors.push("key is required");
  if (!Number.isInteger(config.version) || config.version < 1) {
    errors.push("version must be an integer >= 1");
  }

  const w = config.weights;
  const weightSum =
    w.performance + w.survival + w.utility + w.experienceConsistency + w.mythicRaid;
  if (!approxEqual(weightSum, 1)) {
    errors.push(`dimension weights must sum to 1 (got ${weightSum})`);
  }
  for (const [name, value] of Object.entries(w)) {
    if (!(value >= 0 && value <= 1)) errors.push(`weights.${name} out of range`);
  }

  const blend = config.authenticityBlend.skillWeight + config.authenticityBlend.authenticityWeight;
  if (!approxEqual(blend, 1)) {
    errors.push(`authenticityBlend weights must sum to 1 (got ${blend})`);
  }

  const g = config.gradeThresholds;
  if (!(g.S > g.A && g.A > g.B && g.B > g.C && g.C >= 0 && g.S <= 100)) {
    errors.push("gradeThresholds must be ordered S > A > B > C with valid ranges");
  }

  if (!(config.confidenceNeutralScore >= 0 && config.confidenceNeutralScore <= 100)) {
    errors.push("confidenceNeutralScore must be 0–100");
  }

  for (const dim of SKILL_DIMENSIONS) {
    const defs = config.metricWeights[dim];
    if (!defs || defs.length === 0) {
      errors.push(`metricWeights.${dim} must be non-empty`);
      continue;
    }
    const mSum = sum(defs.map((d) => d.weight));
    if (!approxEqual(mSum, 1)) {
      errors.push(`metricWeights.${dim} must sum to 1 (got ${mSum})`);
    }
    for (const def of defs) {
      if (!(def.weight >= 0)) errors.push(`${def.metricKey} weight must be >= 0`);
      if (!def.metricKey) errors.push("metricKey is required");
    }
  }

  for (const [key, spec] of Object.entries(config.normalization)) {
    if (!SUPPORTED_NORM.has(spec.type)) {
      errors.push(`normalization.${key}: unsupported type ${spec.type}`);
    }
    if (spec.type === "logistic") {
      if (spec.midpoint == null || spec.steepness == null) {
        errors.push(`normalization.${key}: logistic requires midpoint and steepness`);
      }
    }
    if (spec.type === "piecewise") {
      if (!spec.points || spec.points.length < 2) {
        errors.push(`normalization.${key}: piecewise requires points`);
      }
    }
  }

  const decay =
    config.historicalDecay.currentSeason +
    config.historicalDecay.previousSeason +
    config.historicalDecay.olderSeasons;
  if (!approxEqual(decay, 1)) {
    errors.push(`historicalDecay weights must sum to 1 (got ${decay})`);
  }

  const cb = config.confidenceBlend;
  const cbSum =
    cb.dimensionConfidence + cb.sourceCoverage + cb.freshness + cb.selectedRunCoverage;
  if (!approxEqual(cbSum, 1)) {
    errors.push(`confidenceBlend weights must sum to 1 (got ${cbSum})`);
  }

  const tags = config.authenticityTags;
  if (!(tags.boostSuspectedBelow < tags.atypicalBelow)) {
    errors.push("authenticityTags: boostSuspectedBelow must be < atypicalBelow");
  }

  if (!(config.minCoverageForExtreme >= 0 && config.minCoverageForExtreme <= 1)) {
    errors.push("minCoverageForExtreme must be 0–1");
  }
  if (!(config.extremeCapLow < config.extremeCapHigh)) {
    errors.push("extremeCapLow must be < extremeCapHigh");
  }

  if (
    config.overallFormula != null &&
    config.overallFormula !== "LEGACY_AUTHENTICITY_CONFIDENCE_BLEND" &&
    config.overallFormula !== "WEIGHTED_DIMENSIONS"
  ) {
    errors.push(`overallFormula unsupported: ${String(config.overallFormula)}`);
  }
  if (config.version >= 6 && config.overallFormula !== "WEIGHTED_DIMENSIONS") {
    errors.push("model version >= 6 requires overallFormula=WEIGHTED_DIMENSIONS");
  }

  return { ok: errors.length === 0, errors };
}
