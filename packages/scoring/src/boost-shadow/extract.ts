import {
  BOOST_EXTRACTOR_VERSION,
  BOOST_FEATURE_SCHEMA_VERSION,
  HIGH_KEY_POLICY_VERSION,
} from "./constants.js";
import { selectHighKeySet } from "./high-key-policy.js";
import { computeHighKeyGroupConcentration } from "./high-key-group-concentration.js";
import { computeProgressionVelocity } from "./progression-velocity.js";
import { computeRepeatedStrongerTeammateCohort } from "./repeated-stronger-cohort.js";
import { computeTeammateScoreGap } from "./teammate-score-gap.js";
import { computeVerifiedAltExperienceMitigation } from "./verified-alt-mitigation.js";
import {
  BOOST_SHADOW_ISOLATION,
  assertShadowOnlyFacts,
} from "./isolation.js";
import type {
  BoostFeatureDiagnosticsV1,
  BoostFeatureExtractorInput,
  BoostFeatureFactsV1,
  BoostFeatureMissingV1,
  FeatureComputeResult,
} from "./types.js";

function applyFeature(
  key: BoostFeatureMissingV1["featureKey"],
  result: FeatureComputeResult,
  features: BoostFeatureFactsV1["features"],
  missing: BoostFeatureMissingV1[],
  diagnostics: BoostFeatureDiagnosticsV1,
): void {
  if (result.diagnostics) {
    Object.assign(diagnostics, result.diagnostics);
  }
  if (result.status === "omitted") {
    missing.push({ featureKey: key, reasonCode: result.reasonCode });
    return;
  }
  features[key] = result.evidence;
}

/**
 * Pure BoostFeatureExtractor — in-memory / offline only.
 * Does not write AuthenticityFeatureInput, DB, red flags, or public surfaces.
 */
export function extractBoostFeatureFactsV1(
  input: BoostFeatureExtractorInput,
): BoostFeatureFactsV1 {
  const highKey = selectHighKeySet(input.runs, input.seasonId);
  const features: BoostFeatureFactsV1["features"] = {};
  const missing: BoostFeatureMissingV1[] = [];
  const diagnostics: BoostFeatureDiagnosticsV1 = {};

  const runSourceCounts: Record<string, number> = {};
  for (const run of input.runs) {
    const src = run.source ?? "in_memory";
    runSourceCounts[src] = (runSourceCounts[src] ?? 0) + 1;
  }

  applyFeature(
    "progressionVelocity",
    computeProgressionVelocity({
      runs: input.runs,
      seasonId: input.seasonId,
    }),
    features,
    missing,
    diagnostics,
  );

  applyFeature(
    "teammateScoreGap",
    computeTeammateScoreGap({
      highKeyRuns: highKey.eligible,
      subjectCharacterId: input.subjectCharacterId,
      seasonId: input.seasonId,
      ratingSnapshots: input.ratingSnapshots,
    }),
    features,
    missing,
    diagnostics,
  );

  applyFeature(
    "repeatedStrongerTeammateCohort",
    computeRepeatedStrongerTeammateCohort({
      highKeyRuns: highKey.eligible,
      subjectCharacterId: input.subjectCharacterId,
      seasonId: input.seasonId,
      ratingSnapshots: input.ratingSnapshots,
    }),
    features,
    missing,
    diagnostics,
  );

  applyFeature(
    "highKeyGroupConcentration",
    computeHighKeyGroupConcentration({
      highKeyRuns: highKey.eligible,
      subjectCharacterId: input.subjectCharacterId,
    }),
    features,
    missing,
    diagnostics,
  );

  applyFeature(
    "verifiedAltExperienceMitigation",
    computeVerifiedAltExperienceMitigation({
      subjectCharacterId: input.subjectCharacterId,
      regionId: input.regionId,
      seasonId: input.seasonId,
      calculatedAt: input.calculatedAt,
      ownershipEvidence: input.ownershipEvidence ?? [],
    }),
    features,
    missing,
    diagnostics,
  );

  const facts: BoostFeatureFactsV1 = {
    schemaVersion: BOOST_FEATURE_SCHEMA_VERSION,
    extractorVersion: BOOST_EXTRACTOR_VERSION,
    highKeyPolicyVersion: HIGH_KEY_POLICY_VERSION,
    subjectCharacterId: input.subjectCharacterId,
    seasonId: input.seasonId,
    calculatedAt: input.calculatedAt,
    sourceProvenance: input.sourceProvenance ?? {
      primary: "in_memory",
      runSourceCounts,
    },
    highKeySet: {
      runsEligible: highKey.runsEligible,
      runsExcluded: highKey.runsExcluded,
      exclusionReasonCounts: highKey.exclusionReasonCounts,
    },
    features,
    missing,
    diagnostics,
  };

  assertShadowOnlyFacts(facts);
  return facts;
}

export { BOOST_SHADOW_ISOLATION };
