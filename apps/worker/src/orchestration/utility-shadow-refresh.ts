/**
 * Worker: OBSERVED_CONTRIBUTION shadow + publication boundary during refresh.
 */
import {
  getUtilityPublicationMode,
  runUtilityObservedShadowPass,
  filterOutObservedContributionFromPublicUtility,
  UTILITY_OBSERVED_SHADOW_ANALYSIS_VERSION,
  UTILITY_EVIDENCE_CONSUMERS,
  type UtilityShadowPassResult,
  type WclRunEvidenceBundle,
} from "@mplus/provider-warcraftlogs";
import type { MetricObservationDTO } from "@mplus/contracts";
import type { RunRepository } from "../persistence/run-repository.js";
import { applyUtilityPublicationBoundary } from "./utility-publication-refresh.js";

export interface UtilityShadowRefreshResult {
  shadow: UtilityShadowPassResult;
  /** Public Utility observations after publication boundary. */
  publicUtilitySafeObservations: MetricObservationDTO[];
  published: boolean;
  altersPublicUtility: boolean;
  altersPublicTrustScore: boolean;
  eligibilityReasons: string[];
  utilityPublicationEligible: boolean;
}

/**
 * Strip research modes / apply publication eligibility and emit public observations.
 */
export function applyUtilityShadowRefreshBoundary(input: {
  observations: MetricObservationDTO[];
  hasPersistedSharedEvidence: boolean;
  shadowScoreInput?: Parameters<typeof runUtilityObservedShadowPass>[0];
  coverage?: Parameters<typeof applyUtilityPublicationBoundary>[0]["coverage"];
  observedAt?: string;
  classSlug?: string | null;
  specSlug?: string | null;
}): UtilityShadowRefreshResult {
  const shadow = input.shadowScoreInput
    ? runUtilityObservedShadowPass(input.shadowScoreInput)
    : runUtilityObservedShadowPass({
        mode: getUtilityPublicationMode(),
        hasPersistedSharedEvidence: input.hasPersistedSharedEvidence,
        runs: [],
        rawByRunId: new Map(),
        masterByReport: new Map(),
        opportunities: [],
        detailedWclEventCallsMade: 0,
      });

  const publishedBoundary = applyUtilityPublicationBoundary({
    observations: input.observations,
    shadow,
    coverage: input.coverage ?? {
      candidateRunCount: 0,
      compatibleEvidenceCount: 0,
      analyzedRunCount: 0,
    },
    observedAt: input.observedAt ?? new Date().toISOString(),
    classSlug: input.classSlug,
    specSlug: input.specSlug,
  });

  return {
    shadow,
    publicUtilitySafeObservations: publishedBoundary.publicUtilitySafeObservations,
    published: publishedBoundary.published,
    altersPublicUtility: publishedBoundary.altersPublicUtility,
    altersPublicTrustScore: publishedBoundary.altersPublicTrustScore,
    eligibilityReasons: publishedBoundary.eligibility.reasons,
    utilityPublicationEligible: publishedBoundary.eligibility.eligible,
  };
}

export function utilityEvidenceCompleteness(
  bundle: WclRunEvidenceBundle | null | undefined,
): { complete: boolean; present: string[]; missing: string[] } {
  if (!bundle) {
    return {
      complete: false,
      present: [],
      missing: [...UTILITY_EVIDENCE_CONSUMERS],
    };
  }
  const present = UTILITY_EVIDENCE_CONSUMERS.filter((k) => {
    const ds = bundle.eventDatasets[k];
    return ds != null && (ds.state === "OK" || ds.state === "CACHED" || ds.state === "PERSISTED");
  });
  const missing = UTILITY_EVIDENCE_CONSUMERS.filter((k) => !present.includes(k));
  const masterOk = bundle.masterData != null;
  if (!masterOk && !present.includes("masterData")) {
    if (!missing.includes("masterData")) missing.push("masterData");
  }
  return {
    complete: missing.length === 0 || (masterOk && missing.every((m) => m === "masterData")),
    present: masterOk ? [...new Set([...present, "masterData"])] : present,
    missing: masterOk ? missing.filter((m) => m !== "masterData") : missing,
  };
}

export async function persistUtilityShadowDiagnostics(input: {
  runRepository: RunRepository;
  characterId: string;
  runId: string;
  shadow: UtilityShadowPassResult;
  now?: Date;
  published?: boolean;
  eligibilityReasons?: string[];
}): Promise<void> {
  const now = input.now ?? new Date();
  await input.runRepository.upsertRunAnalysis({
    runId: input.runId,
    characterId: input.characterId,
    analysisVersion: UTILITY_OBSERVED_SHADOW_ANALYSIS_VERSION,
    analyzedAt: now,
    coverage: input.shadow.score ? 1 : 0,
    summary: {
      schemaVersion: "1.0.0",
      analysisVersion: UTILITY_OBSERVED_SHADOW_ANALYSIS_VERSION,
      publicationMode: input.shadow.publicationMode,
      status: input.shadow.status,
      altersPublicUtility: input.published === true,
      altersPublicTrustScore: input.published === true,
      replacesLastKnownGoodUtility: false,
      adminDiagnosticsOnly: input.published !== true,
      published: input.published === true,
      eligibilityReasons: input.eligibilityReasons ?? [],
      detailedWclEventCallsMade: input.shadow.detailedWclEventCallsMade,
      score: input.shadow.score
        ? {
            rawBehaviorEstimate: input.shadow.score.rawBehaviorEstimate,
            reliabilityAdjustedScore: input.shadow.score.reliabilityAdjustedScore,
            confidence: input.shadow.score.confidence,
            domainBreakdown: input.shadow.score.domainBreakdown,
            context: input.shadow.score.context,
            denominatorChoice: input.shadow.score.denominatorChoice,
            explanations: input.shadow.score.explanations.slice(0, 80),
          }
        : null,
      semanticsVersion: input.shadow.semantics.version,
      scoreKind: input.shadow.semantics.scoreKind,
    },
    sourcePayloadIds: [],
  });
}

export function shadowDiagnosticsForScoreExplanation(
  shadow: UtilityShadowPassResult,
  coverage?: {
    candidateRunCount?: number;
    matchedReportCount?: number;
    compatibleEvidenceCount?: number;
    reusedEvidenceCount?: number;
    newlyFetchedEvidenceCount?: number;
    rejectedEvidenceCount?: number;
    analyzedRunCount?: number;
    applicableDomainCount?: number;
    observedDomainCount?: number;
    incompleteEvidenceCount?: number;
    missingMasterDataCount?: number;
    skipReasons?: string[];
    notes?: string[];
  },
  publication?: {
    published?: boolean;
    eligibilityReasons?: string[];
    utilityPublicationEligible?: boolean;
  },
): Record<string, unknown> {
  const domainBreakdown = shadow.score?.domainBreakdown ?? null;
  const domainEntries = Array.isArray(domainBreakdown) ? domainBreakdown : [];
  const applicableDomainCount = coverage?.applicableDomainCount ?? domainEntries.length;
  const observedDomainCount =
    coverage?.observedDomainCount ??
    domainEntries.filter((d) => {
      const rec = d as unknown as Record<string, unknown>;
      const events = typeof rec.events === "number" ? rec.events : 0;
      const attempts = typeof rec.attempts === "number" ? rec.attempts : 0;
      const successes = typeof rec.successes === "number" ? rec.successes : 0;
      const rawScore = typeof rec.rawScore === "number" ? rec.rawScore : 0;
      return events > 0 || attempts > 0 || successes > 0 || rawScore > 0;
    }).length;

  const published = publication?.published === true;

  return {
    analysisVersion: shadow.analysisVersion,
    publicationMode: shadow.publicationMode,
    status: shadow.status,
    altersPublicUtility: published,
    altersPublicTrustScore: published,
    adminDiagnosticsOnly: !published,
    published,
    utilityPublicationEligible: publication?.utilityPublicationEligible ?? false,
    eligibilityReasons: publication?.eligibilityReasons ?? [],
    detailedWclEventCallsMade: shadow.detailedWclEventCallsMade,
    reliabilityAdjustedScore: shadow.score?.reliabilityAdjustedScore ?? null,
    confidence: shadow.score?.confidence ?? null,
    domainBreakdown,
    candidateRunCount: coverage?.candidateRunCount ?? 0,
    matchedReportCount: coverage?.matchedReportCount ?? coverage?.candidateRunCount ?? 0,
    compatibleEvidenceCount: coverage?.compatibleEvidenceCount ?? 0,
    reusedEvidenceCount: coverage?.reusedEvidenceCount ?? 0,
    newlyFetchedEvidenceCount: coverage?.newlyFetchedEvidenceCount ?? 0,
    rejectedEvidenceCount: coverage?.rejectedEvidenceCount ?? 0,
    analyzedRunCount: coverage?.analyzedRunCount ?? (shadow.score ? 1 : 0),
    applicableDomainCount,
    observedDomainCount,
    incompleteEvidenceCount: coverage?.incompleteEvidenceCount ?? 0,
    missingMasterDataCount: coverage?.missingMasterDataCount ?? 0,
    skipReasons: coverage?.skipReasons ?? [],
    notes: coverage?.notes ?? [],
  };
}

/** @deprecated Prefer applyUtilityShadowRefreshBoundary which includes publication. */
export { filterOutObservedContributionFromPublicUtility };
