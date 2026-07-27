import type { MetricObservationDTO, ScoreDimension } from "@mplus/contracts";
import { clamp01, safeDivide } from "./math.js";
import { normalizeRawValue, sampleSizeConfidence } from "./normalize.js";
import type {
  MetricScoreResult,
  MetricWeightDef,
  Role,
  ScoreModelConfigV1,
  ScoringContext,
} from "./types.js";
import { SKILL_DIMENSIONS } from "./types.js";

function isMetricAllowed(
  def: MetricWeightDef,
  role: Role,
  model: ScoreModelConfigV1,
): boolean {
  if (def.roles && !def.roles.includes(role)) return false;
  if (def.excludeRoles?.includes(role)) return false;
  const excluded = model.roleMetricExclusions[role] ?? [];
  if (excluded.includes(def.metricKey)) return false;
  return true;
}

function observationFor(
  observations: MetricObservationDTO[],
  metricKey: string,
): MetricObservationDTO | undefined {
  return observations.find((o) => o.metricKey === metricKey);
}

function resolveNormalized(
  obs: MetricObservationDTO | undefined,
  model: ScoreModelConfigV1,
  metricKey: string,
): number | null {
  if (!obs) return null;
  if (obs.normalizedValue != null && Number.isFinite(obs.normalizedValue)) {
    return obs.normalizedValue;
  }
  if (obs.rawValue == null || !Number.isFinite(obs.rawValue)) return null;
  const spec = model.normalization[metricKey] ?? model.normalization.default;
  return normalizeRawValue(obs.rawValue, spec);
}

export function calculateMetricScores(
  observations: MetricObservationDTO[],
  model: ScoreModelConfigV1,
  context: ScoringContext,
): MetricScoreResult[] {
  const results: MetricScoreResult[] = [];

  for (const dimension of SKILL_DIMENSIONS) {
    for (const def of model.metricWeights[dimension]) {
      if (!isMetricAllowed(def, context.role, model)) {
        results.push({
          metricKey: def.metricKey,
          dimension,
          rawValue: null,
          normalizedValue: null,
          weight: def.weight,
          available: false,
          confidence: 0,
          contribution: null,
          sourceProvider: null,
        });
        continue;
      }

      const obs = observationFor(observations, def.metricKey);
      const normalized = resolveNormalized(obs, model, def.metricKey);
      const available = normalized != null;
      const providerConf = obs ? clamp01(obs.confidence) : 0;
      const sample =
        typeof obs?.context === "object" &&
        obs.context !== null &&
        "sampleSize" in obs.context &&
        typeof (obs.context as { sampleSize?: unknown }).sampleSize === "number"
          ? (obs.context as { sampleSize: number }).sampleSize
          : available
            ? model.sampleSizeHalfLife
            : 0;
      const sampleConf = sampleSizeConfidence(sample, model.sampleSizeHalfLife);
      const confidence = available ? clamp01(0.6 * providerConf + 0.4 * sampleConf) : 0;

      results.push({
        metricKey: def.metricKey,
        dimension,
        rawValue: obs?.rawValue ?? null,
        normalizedValue: available ? normalized : null,
        weight: def.weight,
        available,
        confidence,
        contribution: available ? normalized! * def.weight : null,
        sourceProvider: obs?.sourceProvider ?? null,
      });
    }
  }

  return results;
}

export function dimensionConfiguredWeight(
  metrics: MetricScoreResult[],
  dimension: ScoreDimension,
): number {
  return metrics.filter((m) => m.dimension === dimension).reduce((s, m) => s + m.weight, 0);
}

export function coverageRatio(metrics: MetricScoreResult[], dimension: ScoreDimension): number {
  const configured = metrics.filter((m) => m.dimension === dimension);
  const total = configured.reduce((s, m) => s + m.weight, 0);
  const available = configured.filter((m) => m.available).reduce((s, m) => s + m.weight, 0);
  return safeDivide(available, total, 0);
}
