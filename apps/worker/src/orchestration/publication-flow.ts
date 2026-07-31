import type { MetricObservationDTO, ScoreSnapshotDTO } from "@mplus/contracts";
import type { ScoreModelConfig } from "@mplus/contracts";
import {
  mergeObservationsWithLastKnownGood,
  validateCoherence,
  type CoherenceValidationResult,
} from "@mplus/scoring";
import type { ScoreRepository } from "../persistence/score-repository.js";
import type { MetricRepository } from "../persistence/metric-repository.js";

export interface PublicationAttemptInput {
  characterId: string;
  seasonId: string;
  scoreModelId: string;
  model: ScoreModelConfig;
  candidate: ScoreSnapshotDTO;
  incomingObservations: MetricObservationDTO[];
  persistedObservations: MetricObservationDTO[];
  failedDimensions: Set<string>;
  refreshedMetricKeys: Set<string>;
  refreshContractHash: string;
  providerDataAsOf: Date | null;
  analysisBatchId?: string | null;
  scoreRepository: ScoreRepository;
  metricRepository: MetricRepository;
  /** Atomic cancel + contract barrier inside the publish transaction. */
  publicationGuard?: {
    ingestionJobId: string;
  };
}

export interface PublicationAttemptResult {
  published: boolean;
  coherence: CoherenceValidationResult;
  rejectionReason?: string;
  cancelled?: boolean;
  mergedObservations: MetricObservationDTO[];
  finalCandidate: ScoreSnapshotDTO;
}

/**
 * Merge observations with last-known-good, persist, validate coherence, and publish atomically.
 */
export async function attemptPublication(
  input: PublicationAttemptInput,
): Promise<PublicationAttemptResult> {
  const mergedObservations = mergeObservationsWithLastKnownGood({
    incoming: input.incomingObservations,
    persisted: input.persistedObservations,
    failedDimensions: input.failedDimensions,
    refreshedMetricKeys: input.refreshedMetricKeys,
  });

  await input.metricRepository.upsertObservations(
    input.characterId,
    input.seasonId,
    mergedObservations,
  );

  const publishedSnapshot = await input.scoreRepository.getPublishedSnapshot(
    input.characterId,
    input.seasonId,
    input.scoreModelId,
  );

  const publishedDto = publishedSnapshot
    ? mapDbSnapshotToDto(publishedSnapshot)
    : null;

  const coherence = validateCoherence({
    candidate: input.candidate,
    published: publishedDto,
    model: input.model,
    refreshContractHash: input.refreshContractHash,
    expectedModelKey: input.model.key,
    expectedModelVersion: input.model.version,
    observations: mergedObservations,
    isFirstCalculation: publishedDto == null,
  });

  const result = await input.scoreRepository.publishOrRejectCandidate({
    characterId: input.characterId,
    seasonId: input.seasonId,
    scoreModelId: input.scoreModelId,
    scopeType: "CHARACTER",
    scopeKey: null,
    snapshot: input.candidate,
    analysisBatchId: input.analysisBatchId,
    refreshContractHash: input.refreshContractHash,
    providerDataAsOf: input.providerDataAsOf,
    coverageState: coherence.coverageState,
    coherence,
    publicationGuard: input.publicationGuard,
  });

  return {
    published: result.published,
    coherence,
    rejectionReason: result.rejectionReason,
    cancelled: result.cancelled,
    mergedObservations,
    finalCandidate: input.candidate,
  };
}

export function mapDbSnapshotToDto(
  snapshot: NonNullable<Awaited<ReturnType<ScoreRepository["getPublishedSnapshot"]>>>,
): ScoreSnapshotDTO {
  return {
    characterId: snapshot.characterId,
    seasonSlug: snapshot.season.slug,
    modelKey: snapshot.scoreModel.key,
    modelVersion: snapshot.scoreModel.version,
    scopeType: snapshot.scopeType,
    scopeKey: snapshot.scopeKey,
    overallScore: Number(snapshot.overallScore),
    grade: snapshot.grade as ScoreSnapshotDTO["grade"],
    skillScore: Number(snapshot.skillScore),
    authenticityScore: Number(snapshot.authenticityScore),
    confidence: Number(snapshot.confidence),
    calculatedAt: snapshot.calculatedAt.toISOString(),
    inputFingerprint: snapshot.inputFingerprint,
    dimensions: snapshot.dimensionScores.map((d) => ({
      dimension: d.dimension,
      score: d.score != null ? Number(d.score) : null,
      confidence: Number(d.confidence),
      weight: Number(d.weight),
      state: d.state as ScoreSnapshotDTO["dimensions"][0]["state"],
      reason: d.reason,
      contributors: d.contributors,
    })),
    redFlags: [],
    explanation: snapshot.explanation,
    availableModelWeight: 0,
    totalModelWeight: 0,
    modelCoverageRatio: 0,
    overallState: "DEFINITIVE",
    provisionalReason: null,
  };
}
