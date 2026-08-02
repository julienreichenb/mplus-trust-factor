import { randomUUID } from "node:crypto";
import type {
  EvidenceAcquisitionPlanV2,
  EvidenceCandidateMetadataV2,
  EvidenceRole,
  EvidenceSelectionScope,
  EvidenceV2EnabledConsumer,
} from "@mplus/contracts";
import {
  buildWclRateLimitFetchContext,
  hasWarcraftLogsRateLimitCapability,
} from "@mplus/contracts";
import {
  planCandidateDiscovery,
  previewRateBudgetForPlan,
  toCandidateMetadataV2,
  type DiscoverySourceRow,
} from "@mplus/provider-warcraftlogs";
import { buildEvidenceAcquisitionPlanV2 } from "@mplus/scoring";
import {
  OBS_EVENTS,
  emitScoringV2Event,
  recordAdmissionDecision,
  recordPublicationDecision,
} from "@mplus/observability";
import type { WorkerContainer } from "../../container.js";
import {
  assertPublicationBlocked,
  isScoringV2ShadowOrchestrationEnabled,
  resolveEnabledConsumers,
  ScoringV2RateDeferError,
} from "./acquisition.js";

export interface StartEvidenceV2ShadowPipelineInput {
  characterId: string;
  seasonId: string;
  seasonSlug: string;
  role: EvidenceRole;
  /** Frozen class slug for catalog-dependent extractors; null = unknown. */
  classSlug: string | null;
  specSlug: string | null;
  refreshContractHash: string;
  evidenceCutoffAt: string;
  highKeyPolicyId: string;
  activeDungeonSlugs: string[];
  /** Optional pre-built candidate metadata; otherwise discovery rows are mapped. */
  candidates?: EvidenceCandidateMetadataV2[];
  discoveryRows?: DiscoverySourceRow[];
  scoreModelId: string;
  parentIngestionJobId: string | null;
  correlationId?: string | null;
  refreshGeneration: number;
  region: string;
  /** When set, used as ScoreAnalysisBatch.refreshId (must be UUID). */
  v2RefreshId?: string;
}

export interface StartEvidenceV2ShadowPipelineResult {
  skipped: boolean;
  reason?: string;
  analysisBatchId?: string;
  acquisitionPlanContentHash?: string;
  enqueuedSlotJobs?: number;
  deferred?: boolean;
}

/**
 * Shadow orchestration entry: build acquisition plan → rate preview → fan-out slot jobs.
 * No-op when Scoring V2 flags are off. Never mutates the public score pointer.
 */
export async function startEvidenceV2ShadowPipeline(
  container: WorkerContainer,
  input: StartEvidenceV2ShadowPipelineInput,
  enqueue: {
    enqueueAnalyzeEvidenceSlot: (job: {
      analysisBatchId: string;
      acquisitionPlanContentHash: string;
      slotId: string;
      enabledConsumers: EvidenceV2EnabledConsumer[];
      refreshGeneration: number;
      requestedAt?: string;
      correlationId?: string | null;
    }) => Promise<{ jobId: string }>;
  },
): Promise<StartEvidenceV2ShadowPipelineResult> {
  if (!isScoringV2ShadowOrchestrationEnabled(container.env)) {
    return { skipped: true, reason: "scoring_v2_flags_off" };
  }
  if (container.env.SCORING_V2_PUBLICATION_ENABLED) {
    recordPublicationDecision("rejected", "publication_must_stay_blocked");
    emitScoringV2Event(
      container.logger,
      OBS_EVENTS.scoringV2PublicationRejected,
      {
        characterId: input.characterId,
        correlationId: input.correlationId,
        reason: "publication_must_stay_blocked",
      },
      "error",
    );
  }
  assertPublicationBlocked(container.env);

  const enabledConsumers = resolveEnabledConsumers(container.env);
  const plannedAt = new Date().toISOString();

  emitScoringV2Event(container.logger, OBS_EVENTS.scoringV2DiscoveryStarted, {
    characterId: input.characterId,
    seasonId: input.seasonId,
    correlationId: input.correlationId,
    refreshGeneration: input.refreshGeneration,
  });

  let candidates = input.candidates ?? [];
  if (candidates.length === 0 && input.discoveryRows && input.discoveryRows.length > 0) {
    const discovery = planCandidateDiscovery({
      zoneRankingCandidates: input.discoveryRows,
      activeDungeonSlugs: input.activeDungeonSlugs,
    });
    candidates = discovery.candidates.map((c) => toCandidateMetadataV2(c));
  }

  emitScoringV2Event(container.logger, OBS_EVENTS.scoringV2DiscoveryCompleted, {
    characterId: input.characterId,
    seasonId: input.seasonId,
    correlationId: input.correlationId,
    candidateCount: candidates.length,
  });

  const scope: EvidenceSelectionScope = {
    characterId: input.characterId,
    seasonId: input.seasonId,
    seasonSlug: input.seasonSlug,
    specializationId: null,
    classSlug: input.classSlug,
    specSlug: input.specSlug,
    role: input.role,
    refreshContractHash: input.refreshContractHash,
    evidenceCutoffAt: input.evidenceCutoffAt,
    highKeyPolicyId: input.highKeyPolicyId,
    activeDungeonSlugs: input.activeDungeonSlugs,
    selectorVersion: "evidence-selector-v2.0.0",
  };

  const { plan } = buildEvidenceAcquisitionPlanV2({
    scope,
    candidates,
    plannedAt,
  });

  // Rate-budget preview — insufficient budget defers the whole plan (no partial fan-out).
  const deferred = await maybeDeferForRateBudget(container, plan);
  if (deferred) {
    const refreshId = input.v2RefreshId ?? randomUUID();
    const { batch } = await container.repositories.evidenceV2Batch.createBatch({
      characterId: input.characterId,
      seasonId: input.seasonId,
      refreshId,
      scoreModelId: input.scoreModelId,
      acquisitionPlan: plan,
      refreshGeneration: input.refreshGeneration,
      parentIngestionJobId: input.parentIngestionJobId,
      correlationId: input.correlationId ?? null,
      enabledConsumers,
    });
    await container.repositories.evidenceV2Batch.markAdmissionDeferred(
      batch.id,
      deferred.reason,
    );
    const action = deferred.reason.includes("rate_budget_stop") ? "stopped" : "deferred";
    recordAdmissionDecision(action);
    emitScoringV2Event(
      container.logger,
      action === "stopped"
        ? OBS_EVENTS.scoringV2AdmissionStopped
        : OBS_EVENTS.scoringV2AdmissionDeferred,
      {
        characterId: input.characterId,
        analysisBatchId: batch.id,
        correlationId: input.correlationId,
        reason: deferred.reason,
      },
      "warn",
    );
    return {
      skipped: false,
      deferred: true,
      reason: deferred.reason,
      analysisBatchId: batch.id,
      acquisitionPlanContentHash: plan.contentHash,
      enqueuedSlotJobs: 0,
    };
  }

  const refreshId = input.v2RefreshId ?? randomUUID();
  const view = await container.repositories.evidenceV2Batch.createBatch({
    characterId: input.characterId,
    seasonId: input.seasonId,
    refreshId,
    scoreModelId: input.scoreModelId,
    acquisitionPlan: plan,
    refreshGeneration: input.refreshGeneration,
    parentIngestionJobId: input.parentIngestionJobId,
    correlationId: input.correlationId ?? null,
    enabledConsumers,
  });

  await container.repositories.evidenceV2Batch.markAnalyzing(view.batch.id);

  recordAdmissionDecision("admitted");
  emitScoringV2Event(container.logger, OBS_EVENTS.scoringV2AdmissionAdmitted, {
    characterId: input.characterId,
    analysisBatchId: view.batch.id,
    correlationId: input.correlationId,
    expectedSlotCount: plan.expectedSlotCount,
    enabledConsumers,
  });

  let enqueued = 0;
  for (const slot of plan.slots) {
    await enqueue.enqueueAnalyzeEvidenceSlot({
      analysisBatchId: view.batch.id,
      acquisitionPlanContentHash: plan.contentHash,
      slotId: slot.slotId,
      enabledConsumers,
      refreshGeneration: input.refreshGeneration,
      correlationId: input.correlationId ?? null,
    });
    enqueued += 1;
  }

  // Zero-slot plans are immediately finalizable — caller should enqueue finalize.
  return {
    skipped: false,
    analysisBatchId: view.batch.id,
    acquisitionPlanContentHash: plan.contentHash,
    enqueuedSlotJobs: enqueued,
  };
}

async function maybeDeferForRateBudget(
  container: WorkerContainer,
  plan: EvidenceAcquisitionPlanV2,
): Promise<{ reason: string } | null> {
  const wcl = container.providers.warcraftlogs;
  if (!hasWarcraftLogsRateLimitCapability(wcl) || !container.env.WCL_ENABLED) {
    return null;
  }
  try {
    const decision = await wcl.fetchRateLimit(buildWclRateLimitFetchContext());
    const estimatedPoints = Math.max(10, plan.expectedSlotCount * 25);
    const snapshot = {
      pointsSpentThisHour: Math.max(
        0,
        decision.snapshot.pointsLimit - decision.snapshot.pointsRemaining,
      ),
      limitPerHour: decision.snapshot.pointsLimit,
      pointsRemaining: decision.snapshot.pointsRemaining,
      resetAt: decision.snapshot.resetAt,
      fetchedAt: decision.snapshot.fetchedAt,
    };
    const preview = previewRateBudgetForPlan(
      snapshot,
      { kind: "KNOWN", points: estimatedPoints },
      {
        warnPercent: container.env.WCL_RATE_WARN_PERCENT,
        deferPercent: container.env.WCL_RATE_DEFER_PERCENT,
        stopPercent: container.env.WCL_RATE_STOP_PERCENT,
      },
    );
    if (preview.decision.action === "DEFER" || preview.decision.action === "STOP") {
      return {
        reason: `rate_budget_${preview.decision.action.toLowerCase()}:${preview.note}`,
      };
    }
  } catch (error) {
    container.logger.warn(
      { err: error, event: "scoring_v2_rate_preview_failed" },
      "scoring v2 rate preview failed — continuing without defer",
    );
  }
  return null;
}

export function throwIfRateDeferred(reason: string): never {
  throw new ScoringV2RateDeferError(reason);
}
