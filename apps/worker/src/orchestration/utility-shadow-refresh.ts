/**
 * Worker: OBSERVED_CONTRIBUTION shadow pass during refresh.
 * Never mutates public Utility / Trust Score / last-known-good.
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

export interface UtilityShadowRefreshResult {
  shadow: UtilityShadowPassResult;
  /** Public Utility observations after stripping any accidental observed/research modes. */
  publicUtilitySafeObservations: MetricObservationDTO[];
}

/**
 * Strip research/observed modes from public observation list and record shadow status.
 * Full scoring from shared evidence is attempted only when bundles are provided.
 */
export function applyUtilityShadowRefreshBoundary(input: {
  observations: MetricObservationDTO[];
  hasPersistedSharedEvidence: boolean;
  shadowScoreInput?: Parameters<typeof runUtilityObservedShadowPass>[0];
}): UtilityShadowRefreshResult {
  const publicUtilitySafeObservations = filterOutObservedContributionFromPublicUtility(
    input.observations,
  );

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

  return { shadow, publicUtilitySafeObservations };
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
  // masterData lives on bundle.masterData
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
      altersPublicUtility: false,
      altersPublicTrustScore: false,
      replacesLastKnownGoodUtility: false,
      adminDiagnosticsOnly: true,
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
): Record<string, unknown> {
  return {
    analysisVersion: shadow.analysisVersion,
    publicationMode: shadow.publicationMode,
    status: shadow.status,
    altersPublicUtility: false,
    altersPublicTrustScore: false,
    adminDiagnosticsOnly: true,
    detailedWclEventCallsMade: shadow.detailedWclEventCallsMade,
    reliabilityAdjustedScore: shadow.score?.reliabilityAdjustedScore ?? null,
    confidence: shadow.score?.confidence ?? null,
    domainBreakdown: shadow.score?.domainBreakdown ?? null,
  };
}
