/**
 * Publish eligible OBSERVED_CONTRIBUTION Utility into public Trust observations.
 */
import type { MetricObservationDTO } from "@mplus/contracts";
import {
  evaluateUtilityPublicationEligibility,
  normalizeUtilityConfidence,
  parseUtilityPublicationGates,
  UTILITY_PUBLICATION_METRIC_KEY,
  type UtilityPublicationCoverageInput,
  type UtilityPublicationEligibilityResult,
  type UtilityShadowPassResult,
  filterOutObservedContributionFromPublicUtility,
  stripAllUtilityObservations,
  getUtilityPublicationMode,
} from "@mplus/provider-warcraftlogs";

export interface UtilityPublicationBoundaryResult {
  shadow: UtilityShadowPassResult;
  publicUtilitySafeObservations: MetricObservationDTO[];
  eligibility: UtilityPublicationEligibilityResult;
  published: boolean;
  altersPublicUtility: boolean;
  altersPublicTrustScore: boolean;
}

export function applyUtilityPublicationBoundary(input: {
  observations: MetricObservationDTO[];
  shadow: UtilityShadowPassResult;
  coverage: UtilityPublicationCoverageInput;
  observedAt: string;
  classSlug?: string | null;
  specSlug?: string | null;
}): UtilityPublicationBoundaryResult {
  const mode = input.shadow.publicationMode ?? getUtilityPublicationMode();
  const domainBreakdown = input.shadow.score?.domainBreakdown ?? [];
  const observedDomainCount =
    input.coverage.observedDomainCount ??
    domainBreakdown.filter((d) => d.applicable && (d.events ?? 0) > 0).length;

  const eligibility = evaluateUtilityPublicationEligibility({
    publicationMode: mode,
    shadowStatus: input.shadow.status,
    reliabilityAdjustedScore: input.shadow.score?.reliabilityAdjustedScore ?? null,
    confidence: input.shadow.score?.confidence ?? null,
    coverage: {
      ...input.coverage,
      observedDomainCount,
      classSlug: input.classSlug ?? input.coverage.classSlug,
      specSlug: input.specSlug ?? input.coverage.specSlug,
      evidenceAnalysisVersion: input.coverage.evidenceAnalysisVersion ?? "wcl-run-evidence-v1",
    },
    gates: parseUtilityPublicationGates(),
  });

  // Always strip accidental research / unapproved observed modes first.
  let next = filterOutObservedContributionFromPublicUtility(input.observations);

  if (mode === "published") {
    // Never mix legacy combat-facts Utility with published observed contribution.
    next = stripAllUtilityObservations(next);

    if (eligibility.eligible && input.shadow.score) {
      const score = input.shadow.score.reliabilityAdjustedScore;
      const confidence01 = normalizeUtilityConfidence(input.shadow.score.confidence);
      const publishedObs: MetricObservationDTO = {
        metricKey: UTILITY_PUBLICATION_METRIC_KEY,
        dimension: "UTILITY",
        rawValue: score,
        normalizedValue: score,
        confidence: confidence01,
        observedAt: input.observedAt,
        sourceProvider: "warcraftlogs",
        coverage: {
          present: eligibility.analyzedRunCount,
          expected: Math.max(input.coverage.candidateRunCount ?? eligibility.analyzedRunCount, 1),
          ratio: eligibility.evidenceCoverage,
        },
        context: {
          utilityScoringMode: "OBSERVED_CONTRIBUTION",
          utilityPublicationApproved: true,
          utilityPublicationVersion: "utility-observed-public-v1",
          reliabilityAdjustedScore: score,
          rawBehaviorEstimate: input.shadow.score.rawBehaviorEstimate,
          domainBreakdown: input.shadow.score.domainBreakdown,
          analyzedRunCount: eligibility.analyzedRunCount,
          evidenceCoverage: eligibility.evidenceCoverage,
          observedDomainCount: eligibility.observedDomainCount,
          gates: eligibility.gates,
        },
      };
      next.push(publishedObs);
      return {
        shadow: input.shadow,
        publicUtilitySafeObservations: next,
        eligibility,
        published: true,
        altersPublicUtility: true,
        altersPublicTrustScore: true,
      };
    }

    // Ineligible published mode: Utility stays UNAVAILABLE — no fabricated neutral/zero.
    return {
      shadow: input.shadow,
      publicUtilitySafeObservations: next,
      eligibility,
      published: false,
      altersPublicUtility: false,
      altersPublicTrustScore: false,
    };
  }

  // shadow / off — public Utility path unchanged (combat-facts only; no observed modes).
  return {
    shadow: input.shadow,
    publicUtilitySafeObservations: next,
    eligibility,
    published: false,
    altersPublicUtility: false,
    altersPublicTrustScore: false,
  };
}
