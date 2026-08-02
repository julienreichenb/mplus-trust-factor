import {
  EXPERIENCE_V2_METRIC_WEIGHTS,
  computeExperienceV2,
  type ExperienceV2Component,
  type ExperienceV2Result,
} from "../v2/index.js";
import type { ExperienceV3ModelConfig } from "./constants.js";
import type {
  ExperienceEvidenceStateV3,
  ExperienceV3ComponentResult,
  ExperienceV3CurrentExposureFact,
} from "./types.js";

function provenanceToEvidenceState(
  provenance: ExperienceV3CurrentExposureFact["provenance"],
): ExperienceEvidenceStateV3 {
  switch (provenance) {
    case "HAS_HISTORY":
      return "HAS_VALUE";
    case "CONFIRMED_ABSENCE":
      return "CONFIRMED_NO_ACTIVITY";
    case "PARTIAL_SOURCES":
      return "PARTIAL";
    case "PROVIDER_FAILURE":
      return "PROVIDER_FAILURE";
    default:
      return "UNKNOWN";
  }
}

/**
 * Weighted Experience V2 durable-exposure score (0–100).
 * Uses V2 metric weights; excludes zero-confidence components from the blend.
 */
export function scoreCurrentExposureV3(
  fact: ExperienceV3CurrentExposureFact,
  _config: ExperienceV3ModelConfig,
): {
  component: ExperienceV3ComponentResult;
  v2Result: ExperienceV2Result;
  v2Components: ExperienceV2Component[];
} {
  const v2Result = computeExperienceV2({
    expectedDungeonCount: fact.expectedDungeonCount,
    selectedRuns: fact.selectedRuns,
    seasonRuns: fact.seasonRuns,
    priorSeasonCount: fact.priorSeasonCount,
    priorSeasonSourceDepth: fact.priorSeasonSourceDepth,
    observedAt: fact.observedAt,
    provenance: fact.provenance,
  });

  const weightByKey = new Map<string, number>(
    EXPERIENCE_V2_METRIC_WEIGHTS.map((w) => [w.metricKey, w.weight]),
  );

  let weightedSum = 0;
  let weightTotal = 0;
  let confidenceSum = 0;
  let confidenceN = 0;

  for (const c of v2Result.components) {
    const w = weightByKey.get(c.metricKey) ?? 0;
    if (w <= 0) continue;
    // Provider failure on provenance zeros confidence — treat exposure as unavailable.
    if (c.confidence <= 0 && fact.provenance === "PROVIDER_FAILURE") continue;
    weightedSum += c.normalizedValue * w;
    weightTotal += w;
    confidenceSum += c.confidence;
    confidenceN += 1;
  }

  const evidenceState = provenanceToEvidenceState(fact.provenance);
  const available =
    fact.provenance !== "PROVIDER_FAILURE" && weightTotal > 0 && Number.isFinite(weightedSum);
  const score = available ? weightedSum / weightTotal : null;
  const confidence = available
    ? confidenceN > 0
      ? confidenceSum / confidenceN
      : 0
    : 0;

  return {
    v2Result,
    v2Components: v2Result.components,
    component: {
      key: "currentExposure",
      available,
      score,
      confidence,
      weight: 0, // filled by blend
      effectiveWeight: 0,
      evidenceState,
      detail: {
        provenance: fact.provenance,
        evidence: v2Result.evidence,
        metricCount: v2Result.components.length,
        independentOfWclDetails: true,
        independentOfCurrentPerformance: true,
      },
    },
  };
}
