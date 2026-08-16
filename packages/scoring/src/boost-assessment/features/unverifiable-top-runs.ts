import { clamp01 } from "../../math.js";
import { exceptionalSignalScale, normalizeRate, BOOST_ASSESSMENT_POLICY } from "../policy.js";
import type { BoostDungeonContext, BoostFeatureComputeResult, SeasonHighKeyContext } from "../types.js";

export function computeTopRunPublicEvidenceUnavailable(args: {
  dungeonContexts: BoostDungeonContext[] | undefined;
  context: SeasonHighKeyContext;
}): BoostFeatureComputeResult {
  const contexts = args.dungeonContexts ?? [];
  if (contexts.length === 0) {
    return {
      status: "unavailable",
      reasonCode: "INSUFFICIENT_SAMPLE",
      summary: "No Blizzard highest-run comparison was supplied to Boost.",
      publicEvidence: { dungeonCount: 0 },
    };
  }
  const unverifiable = contexts.filter((c) => !c.topPublicEvidenceAvailable);
  const verifiable = contexts.length - unverifiable.length;
  const unavailableRate = unverifiable.length / contexts.length;
  const recurrence = normalizeRate(
    unavailableRate,
    BOOST_ASSESSMENT_POLICY.unavailableRateOnset,
    BOOST_ASSESSMENT_POLICY.unavailableRateSaturation,
  );
  const scale = exceptionalSignalScale(args.context.subjectMedianKeyPercentileBps);
  const value = clamp01(recurrence * scale);
  return {
    status: "computed",
    evidence: { value, confidence: 0.85, sampleSize: contexts.length, coverage: 1 },
    summary:
      unverifiable.length === 0
        ? "Highest timed Blizzard run per dungeon has public analysable WCL evidence."
        : `${unverifiable.length} of ${contexts.length} dungeon-best timed runs have no public analysable WCL evidence (TOP_RUN_PUBLIC_EVIDENCE_UNAVAILABLE).`,
    publicEvidence: {
      dungeonCount: contexts.length,
      verifiableTopRunCount: verifiable,
      unverifiableTopRunCount: unverifiable.length,
      unavailableRate: Number(unavailableRate.toFixed(4)),
      keyLevelGaps: unverifiable.map((c) => ({
        dungeonSlug: c.dungeonSlug,
        blizzardBestKeyLevel: c.blizzardBestKeyLevel,
        publicAnalysableBestKeyLevel: c.publicAnalysableBestKeyLevel,
        keyLevelVerificationGap: c.keyLevelVerificationGap,
        blizzardBestCompletedAt: c.blizzardBestCompletedAt,
      })),
    },
  };
}
