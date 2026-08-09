/**
 * Score Explainability V1 — pure adapters over authoritative calculator outputs.
 * Provider-free: no Prisma, queues, clocks, or network.
 */

export {
  SCORE_EXPLAINABILITY_LABEL_CATALOG_VERSION,
  SCORE_EXPLAINABILITY_MATERIALITY_POLICY_VERSION,
  SCORE_EXPLAINABILITY_NEUTRAL_POINT,
  SCORE_EXPLAINABILITY_PRODUCT_MATERIALITY_FLOOR,
  presentConfidenceCause,
  presentConfidenceComponent,
  presentScoreDriver,
  resolveLabelEntry,
  type LabelEntry,
  type LabelPresentation,
  type LabelVisibility,
} from "./label-registry.js";

export {
  fingerprintScoreExplainability,
  fingerprintPayloadFromExplainability,
} from "./fingerprint.js";

export { buildScoreExplainabilityV1 } from "./build.js";
export type { BuildScoreExplainabilityV1Input } from "./build.js";

export {
  projectScoreExplainabilityAudit,
  projectScoreExplainabilityPublic,
  projectDimensionExplainabilityPublic,
} from "./project.js";

export {
  contributorsFromPublicScoreDrivers,
  contributorsFromLegacyConfidenceContext,
  tryParsePersistedScoreExplainability,
  productDimensionExplainabilityFields,
} from "./product-dto.js";
export type { LegacyDimensionContributors } from "./product-dto.js";

export {
  adaptPerformanceExplainability,
  adaptSurvivalExplainability,
  adaptUtilityExplainability,
  adaptExperienceExplainability,
  adaptCompositeExplainability,
} from "./adapters/index.js";

export { reconstructSurvivalComponentContributions } from "./adapters/survival.js";
