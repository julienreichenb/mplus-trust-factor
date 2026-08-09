import {
  SCORE_EXPLAINABILITY_V1_SCHEMA_VERSION,
  type ScoreExplainabilityV1,
} from "@mplus/contracts";
import type { PartialCompositeResult } from "../composite/partial-composite.js";
import type { ExperiencePhase1Result } from "../experience/phase1/calculate.js";
import type { PerformancePhase2ComputeResult } from "../performance/phase2/types.js";
import type { SurvivalV2ComputeResult } from "../survival/v2/types.js";
import type { UtilityV2ComputeResult } from "../utility/v2/types.js";
import {
  adaptCompositeExplainability,
  adaptExperienceExplainability,
  adaptPerformanceExplainability,
  adaptSurvivalExplainability,
  adaptUtilityExplainability,
} from "./adapters/index.js";
import { fingerprintScoreExplainability } from "./fingerprint.js";
import {
  SCORE_EXPLAINABILITY_LABEL_CATALOG_VERSION,
  SCORE_EXPLAINABILITY_MATERIALITY_POLICY_VERSION,
} from "./label-registry.js";

export interface BuildScoreExplainabilityV1Input {
  performance: PerformancePhase2ComputeResult | null | undefined;
  survival: SurvivalV2ComputeResult | null | undefined;
  utility: UtilityV2ComputeResult | null | undefined;
  experience: ExperiencePhase1Result | null | undefined;
  composite: PartialCompositeResult | null | undefined;
}

/**
 * Pure builder: calculator outputs → canonical ScoreExplainabilityV1.
 * Does not call providers, repositories, Prisma, queues, or clocks.
 */
export function buildScoreExplainabilityV1(
  input: BuildScoreExplainabilityV1Input,
): ScoreExplainabilityV1 {
  const withoutFingerprint = {
    schemaVersion: SCORE_EXPLAINABILITY_V1_SCHEMA_VERSION,
    labelCatalogVersion: SCORE_EXPLAINABILITY_LABEL_CATALOG_VERSION,
    materialityPolicyVersion: SCORE_EXPLAINABILITY_MATERIALITY_POLICY_VERSION,
    dimensions: {
      PERFORMANCE: adaptPerformanceExplainability(input.performance),
      SURVIVAL: adaptSurvivalExplainability(input.survival),
      UTILITY: adaptUtilityExplainability(input.utility),
      EXPERIENCE: adaptExperienceExplainability(input.experience),
    },
    composite: adaptCompositeExplainability(input.composite),
  } as const;

  return {
    ...withoutFingerprint,
    fingerprint: fingerprintScoreExplainability(withoutFingerprint),
  };
}
