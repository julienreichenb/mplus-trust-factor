import type { BoostAssessmentIsolationGuarantees, BoostAssessmentResult } from "./types.js";

export const BOOST_ASSESSMENT_ISOLATION: BoostAssessmentIsolationGuarantees = {
  altersCharacterScore: false,
  altersCompositeScore: false,
  altersContextualScore: false,
  altersSkillDimensions: false,
  altersGrade: false,
  altersScoringConfidence: false,
  altersEligibility: false,
  altersPublishedScoreSelection: false,
  altersRefreshStatus: false,
  writesRedFlags: false,
  usesAuthenticityScore: false,
  fetchesProviders: false,
};

const FORBIDDEN_PUBLIC_KEYS = [
  "authenticityScore",
  "overallScore",
  "boost_suspected",
  "reportCode",
  "reportcode",
] as const;

export function assertBoostAssessmentIsolation(result: BoostAssessmentResult): void {
  const blob = JSON.stringify(result);
  for (const key of FORBIDDEN_PUBLIC_KEYS) {
    if (blob.includes(key)) {
      throw new Error(`Boost assessment must not contain forbidden key: ${key}`);
    }
  }
  if (blob.includes("battletag") || blob.includes("BattleTag")) {
    throw new Error("Boost assessment must not contain BattleTag");
  }
}
