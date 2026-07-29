/**
 * Ranking eligibility — profiles scored on incompatible dimension sets must not
 * compete in the complete ranking (no imputed Utility).
 */
import type { DimensionScoreDTO, OverallScoreState } from "@mplus/contracts";

export interface RankingEligibilityDTO {
  eligible: boolean;
  scoreModelVersion: number;
  utilityEligible: boolean;
  reasons: string[];
}

export interface BuildRankingEligibilityInput {
  scoreModelVersion: number;
  dimensions: DimensionScoreDTO[];
  overallState?: OverallScoreState;
  provisionalReason?: string | null;
  /** Explicit Utility publication eligibility from refresh boundary. */
  utilityPublicationEligible?: boolean;
  utilityPublicationReasons?: string[];
}

const MIN_RANKING_MODEL_VERSION = 6;

export function buildRankingEligibility(
  input: BuildRankingEligibilityInput,
): RankingEligibilityDTO {
  const reasons: string[] = [];
  const utilityDim = input.dimensions.find((d) => d.dimension === "UTILITY");
  const utilityAvailable =
    utilityDim != null &&
    utilityDim.score != null &&
    (utilityDim.state === "AVAILABLE" || utilityDim.state === "PARTIAL");

  const utilityEligible =
    input.utilityPublicationEligible === true ||
    (input.utilityPublicationEligible !== false && utilityAvailable);

  if (input.scoreModelVersion < MIN_RANKING_MODEL_VERSION) {
    reasons.push(`MODEL_VERSION_BELOW_V${MIN_RANKING_MODEL_VERSION}`);
  }
  if (!utilityEligible) {
    reasons.push("UTILITY_NOT_ELIGIBLE");
    for (const r of input.utilityPublicationReasons ?? []) {
      reasons.push(`UTILITY:${r}`);
    }
    if (utilityDim?.state === "UNAVAILABLE") {
      reasons.push("UTILITY_UNAVAILABLE");
    }
  }
  if (input.overallState === "PROVISIONAL" && input.provisionalReason) {
    // Model-coverage provisional still blocks complete ranking.
    if (input.provisionalReason.includes("MODEL_COVERAGE")) {
      reasons.push("MODEL_COVERAGE_PROVISIONAL");
    }
  }

  const eligible =
    input.scoreModelVersion >= MIN_RANKING_MODEL_VERSION &&
    utilityEligible &&
    !reasons.includes("MODEL_COVERAGE_PROVISIONAL");

  return {
    eligible,
    scoreModelVersion: input.scoreModelVersion,
    utilityEligible,
    reasons: [...new Set(reasons)],
  };
}
