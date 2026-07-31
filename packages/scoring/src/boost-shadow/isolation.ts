import type {
  BoostFeatureFactsV1,
  BoostShadowIsolationGuarantees,
} from "./types.js";

/** Compile-time + runtime isolation: Phase 1 never touches production scoring surfaces. */
export const BOOST_SHADOW_ISOLATION: BoostShadowIsolationGuarantees = {
  altersAuthenticityScore: false,
  writesAuthenticityFeatureInput: false,
  altersRedFlags: false,
  altersTrustScore: false,
  altersGrades: false,
  altersConfidence: false,
  altersEligibility: false,
  affectsRefreshPublication: false,
  emitsPublicExplanations: false,
  emitsAddonBits: false,
  persistsToDatabase: false,
  infersOwnershipFromNamesGuildsIpsOrRoster: false,
};

const FORBIDDEN_PUBLIC_KEYS = [
  "boost_suspected",
  "atypical_progression",
  "confirmed_reroll",
  "probable_reroll",
  "AuthenticityFeatureInput",
  "authenticityScore",
  "overallScore",
] as const;

/**
 * Runtime check that facts stay private and free of public/account leakage fields.
 */
export function assertShadowOnlyFacts(facts: BoostFeatureFactsV1): void {
  const blob = JSON.stringify(facts);
  for (const key of FORBIDDEN_PUBLIC_KEYS) {
    if (blob.includes(key)) {
      throw new Error(`Boost shadow facts must not contain public key: ${key}`);
    }
  }
  if (blob.includes("battletag") || blob.includes("BattleTag")) {
    throw new Error("Boost shadow facts must not contain BattleTag");
  }
}

export function isOmittedNotZero(
  facts: BoostFeatureFactsV1,
  featureKey: keyof BoostFeatureFactsV1["features"],
): boolean {
  return facts.features[featureKey] === undefined;
}
