/**
 * Publish eligible OBSERVED_CONTRIBUTION Utility into public Trust observations.
 * Dimension-scoped: never removes Performance / Survival / Experience observations.
 */
import type { MetricObservationDTO } from "@mplus/contracts";
import {
  evaluateUtilityPublicationEligibility,
  normalizeUtilityConfidence,
  readUtilityPublicationGatesFromModelConfig,
  UTILITY_PUBLICATION_METRIC_KEY,
  type UtilityPublicationCoverageInput,
  type UtilityPublicationEligibilityInput,
  type UtilityPublicationEligibilityResult,
  type UtilityPublicationGateConfig,
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

function isUtilityObservation(o: { dimension?: string; metricKey: string }): boolean {
  return o.dimension === "UTILITY" || o.metricKey.startsWith("utility.");
}

/**
 * Replace only Utility observations; preserve every unrelated dimension observation.
 */
export function replaceUtilityObservationsDimensionScoped(
  observations: MetricObservationDTO[],
  nextUtilityObservations: MetricObservationDTO[],
): MetricObservationDTO[] {
  const preserved = observations.filter((o) => !isUtilityObservation(o));
  const utilityOnly = nextUtilityObservations.filter((o) => isUtilityObservation(o));
  return [...preserved, ...utilityOnly];
}

export function applyUtilityPublicationBoundary(input: {
  observations: MetricObservationDTO[];
  shadow: UtilityShadowPassResult;
  coverage: UtilityPublicationCoverageInput;
  observedAt: string;
  classSlug?: string | null;
  specSlug?: string | null;
  /** Active score model config (gates read from utilityPublicationEligibility). */
  scoreModelConfig?: unknown;
  /** Explicit gates (tests); otherwise read from scoreModelConfig. */
  gates?: UtilityPublicationGateConfig | null;
  /** Agent 06/07 baseline classifier — Option A: only PUBLISHABLE publishes. */
  baselineState?: UtilityPublicationEligibilityInput["baselineState"];
}): UtilityPublicationBoundaryResult {
  const mode = input.shadow.publicationMode ?? getUtilityPublicationMode();
  const domainBreakdown = input.shadow.score?.domainBreakdown ?? [];
  const observedDomainCount =
    input.coverage.observedDomainCount ??
    domainBreakdown.filter((d) => d.applicable && (d.events ?? 0) > 0).length;
  const attributableEvents =
    input.coverage.attributableEvents ??
    (typeof input.shadow.score?.context?.attributableEvents === "number"
      ? input.shadow.score.context.attributableEvents
      : null);

  const gates =
    input.gates !== undefined
      ? input.gates
      : readUtilityPublicationGatesFromModelConfig(input.scoreModelConfig);

  const eligibility = evaluateUtilityPublicationEligibility({
    publicationMode: mode,
    shadowStatus: input.shadow.status,
    reliabilityAdjustedScore: input.shadow.score?.reliabilityAdjustedScore ?? null,
    confidence: input.shadow.score?.confidence ?? null,
    coverage: {
      ...input.coverage,
      observedDomainCount,
      attributableEvents,
      classSlug: input.classSlug ?? input.coverage.classSlug,
      specSlug: input.specSlug ?? input.coverage.specSlug,
      evidenceAnalysisVersion: input.coverage.evidenceAnalysisVersion ?? "wcl-run-evidence-v1",
    },
    gates,
    baselineState: input.baselineState,
  });

  // Strip accidental research / unapproved observed modes from Utility only.
  const utilityStripped = filterOutObservedContributionFromPublicUtility(
    input.observations.filter((o) => isUtilityObservation(o)),
  );
  let nextUtility = utilityStripped;

  if (mode === "published") {
    nextUtility = stripAllUtilityObservations(nextUtility);

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
      nextUtility = [publishedObs];
      return {
        shadow: input.shadow,
        publicUtilitySafeObservations: replaceUtilityObservationsDimensionScoped(
          input.observations,
          nextUtility,
        ),
        eligibility,
        published: true,
        altersPublicUtility: true,
        altersPublicTrustScore: true,
      };
    }

    // Ineligible published mode: Utility stays UNAVAILABLE — no fabricated neutral/zero.
    return {
      shadow: input.shadow,
      publicUtilitySafeObservations: replaceUtilityObservationsDimensionScoped(
        input.observations,
        nextUtility,
      ),
      eligibility,
      published: false,
      altersPublicUtility: false,
      altersPublicTrustScore: false,
    };
  }

  // shadow / off — public Utility path unchanged (combat-facts only; no observed modes).
  return {
    shadow: input.shadow,
    publicUtilitySafeObservations: replaceUtilityObservationsDimensionScoped(
      input.observations,
      nextUtility,
    ),
    eligibility,
    published: false,
    altersPublicUtility: false,
    altersPublicTrustScore: false,
  };
}
