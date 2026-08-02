/**
 * Scoring V2 structured events + metric helpers.
 * Never pass raw character names, report codes, or provider secrets into these helpers
 * without going through sanitizeScoringV2LogFields / sanitizeSensitiveDeep.
 */

import type { Logger } from "pino";
import type { OBS_EVENTS, ObsEventName } from "./events.js";
import { getMetricsRegistry } from "./metrics.js";
import { fingerprintIdentifier, sanitizeSensitiveDeep } from "./security.js";

export const SCORING_V2_JOB_SCHEMA_VERSION = "2.0.0" as const;
export const SCORING_V2_EVIDENCE_MANIFEST_SCHEMA_VERSION = "2.0.0" as const;
export const SCORING_V2_ACQUISITION_PLAN_SCHEMA_VERSION = "2.0.0" as const;

export type ScoringV2EventName =
  | typeof OBS_EVENTS.scoringV2DiscoveryStarted
  | typeof OBS_EVENTS.scoringV2DiscoveryCompleted
  | typeof OBS_EVENTS.scoringV2ManifestFrozen
  | typeof OBS_EVENTS.scoringV2AdmissionAdmitted
  | typeof OBS_EVENTS.scoringV2AdmissionDeferred
  | typeof OBS_EVENTS.scoringV2AdmissionStopped
  | typeof OBS_EVENTS.scoringV2SlotStarted
  | typeof OBS_EVENTS.scoringV2SlotCompleted
  | typeof OBS_EVENTS.scoringV2SlotFailed
  | typeof OBS_EVENTS.scoringV2DatasetCacheHit
  | typeof OBS_EVENTS.scoringV2DatasetFetched
  | typeof OBS_EVENTS.scoringV2DatasetTruncated
  | typeof OBS_EVENTS.scoringV2FactSetWritten
  | typeof OBS_EVENTS.scoringV2BatchReady
  | typeof OBS_EVENTS.scoringV2BatchFinalized
  | typeof OBS_EVENTS.scoringV2PublicationCandidate
  | typeof OBS_EVENTS.scoringV2PublicationPublished
  | typeof OBS_EVENTS.scoringV2PublicationRejected
  | typeof OBS_EVENTS.scoringV2CalibrationStarted
  | typeof OBS_EVENTS.scoringV2CalibrationCompleted
  | typeof OBS_EVENTS.scoringV2ReferenceSliceStateChanged;

export interface ScoringV2CorrelationFields {
  correlationId?: string | null;
  analysisBatchId?: string | null;
  characterId?: string | null;
  seasonId?: string | null;
  slotId?: string | null;
  refreshGeneration?: number | null;
}

/** Safe log fields: fingerprint character ids already UUIDs; never emit raw names/codes. */
export function buildScoringV2LogContext(
  fields: ScoringV2CorrelationFields & Record<string, unknown>,
): Record<string, unknown> {
  const {
    characterId,
    correlationId,
    analysisBatchId,
    seasonId,
    slotId,
    refreshGeneration,
    ...rest
  } = fields;

  const base: Record<string, unknown> = {
    ...(correlationId != null ? { correlationId } : {}),
    ...(analysisBatchId != null ? { analysisBatchId } : {}),
    ...(seasonId != null ? { seasonId } : {}),
    ...(slotId != null ? { slotId } : {}),
    ...(refreshGeneration != null ? { refreshGeneration } : {}),
    ...(characterId != null && characterId.length > 0
      ? { characterIdFingerprint: fingerprintIdentifier(characterId) }
      : {}),
  };

  return sanitizeScoringV2LogFields({ ...base, ...rest });
}

export function sanitizeScoringV2LogFields(
  fields: Record<string, unknown>,
): Record<string, unknown> {
  return sanitizeSensitiveDeep(fields) as Record<string, unknown>;
}

export function emitScoringV2Event(
  logger: Pick<Logger, "info" | "warn" | "error">,
  event: ScoringV2EventName | ObsEventName,
  fields: ScoringV2CorrelationFields & Record<string, unknown> = {},
  level: "info" | "warn" | "error" = "info",
): void {
  const payload = {
    event,
    ...buildScoringV2LogContext(fields),
  };
  logger[level](payload, event);
}

export function recordManifestCoverage(input: {
  coverageState: string;
  selectedSlotCount: number;
  expectedSlotCount: number;
  fallbackDepth?: number;
}): void {
  const registry = getMetricsRegistry();
  registry.incrementCounter("scoring_v2_manifest_coverage_total", {
    coverageState: input.coverageState,
  });
  registry.observeHistogram("scoring_v2_slots_per_character", input.selectedSlotCount, {
    expected: String(input.expectedSlotCount),
  });
  if (input.fallbackDepth != null) {
    registry.observeHistogram("scoring_v2_fallback_depth", input.fallbackDepth);
  }
}

export function recordInvalidCandidateReason(reason: string): void {
  getMetricsRegistry().incrementCounter("scoring_v2_invalid_candidate_total", {
    reason: reason.slice(0, 64),
  });
}

export function recordDatasetOutcome(input: {
  outcome: "cache_hit" | "fetched" | "truncated";
  datasetKey?: string;
  wclPoints?: number;
  dimension?: string;
  bytes?: number;
  latencyMs?: number;
}): void {
  const registry = getMetricsRegistry();
  const labels = {
    outcome: input.outcome,
    ...(input.datasetKey ? { datasetKey: input.datasetKey.slice(0, 64) } : {}),
    ...(input.dimension ? { dimension: input.dimension } : {}),
  };
  registry.incrementCounter("scoring_v2_dataset_outcome_total", labels);
  if (input.wclPoints != null) {
    registry.incrementCounter(
      "scoring_v2_wcl_points_total",
      {
        ...(input.datasetKey ? { datasetKey: input.datasetKey.slice(0, 64) } : {}),
        ...(input.dimension ? { dimension: input.dimension } : {}),
      },
      input.wclPoints,
    );
  }
  if (input.bytes != null) {
    registry.observeHistogram("scoring_v2_artifact_bytes", input.bytes, {
      kind: "dataset",
    });
  }
  if (input.latencyMs != null) {
    registry.observeHistogram("scoring_v2_provider_latency_ms", input.latencyMs, {
      cacheHit: String(input.outcome === "cache_hit"),
    });
  }
}

export function recordFactSetWritten(input: { dimension?: string; bytes?: number }): void {
  const registry = getMetricsRegistry();
  registry.incrementCounter("scoring_v2_fact_set_written_total", {
    ...(input.dimension ? { dimension: input.dimension } : {}),
  });
  if (input.bytes != null) {
    registry.observeHistogram("scoring_v2_artifact_bytes", input.bytes, { kind: "fact_set" });
  }
}

export function recordSlotOutcome(outcome: "started" | "completed" | "failed", status?: string): void {
  getMetricsRegistry().incrementCounter("scoring_v2_slot_outcome_total", {
    outcome,
    ...(status ? { status: status.slice(0, 32) } : {}),
  });
}

export function recordBatchOutcome(outcome: "ready" | "finalized"): void {
  getMetricsRegistry().incrementCounter("scoring_v2_batch_outcome_total", { outcome });
}

export function recordAdmissionDecision(action: "admitted" | "deferred" | "stopped"): void {
  getMetricsRegistry().incrementCounter("scoring_v2_admission_total", { action });
}

export function recordPublicationDecision(
  action: "candidate" | "published" | "rejected",
  reason?: string,
): void {
  getMetricsRegistry().incrementCounter("scoring_v2_publication_total", {
    action,
    ...(reason ? { reason: reason.slice(0, 64) } : {}),
  });
}

export function recordScoreConfidenceSample(input: {
  score: number;
  confidence: number;
  modelKey?: string;
  source: "v1" | "v2";
}): void {
  const registry = getMetricsRegistry();
  const labels = {
    source: input.source,
    ...(input.modelKey ? { modelKey: input.modelKey } : {}),
  };
  registry.observeHistogram("scoring_v2_score_distribution", input.score, labels);
  registry.observeHistogram("scoring_v2_confidence_distribution", input.confidence * 100, labels);
}

export function recordV1V2Delta(deltaAbs: number): void {
  getMetricsRegistry().observeHistogram("scoring_v2_v1_v2_delta_abs", Math.abs(deltaAbs));
}

export function recordQueueSnapshot(input: { queue: string; depth: number; ageMs?: number }): void {
  const registry = getMetricsRegistry();
  registry.recordQueueDepth(input.queue, input.depth);
  if (input.ageMs != null) {
    registry.observeHistogram("scoring_v2_queue_age_ms", input.ageMs, { queue: input.queue });
  }
}

export function recordArtifactOrphan(count = 1): void {
  getMetricsRegistry().incrementCounter("scoring_v2_artifact_orphans_total", {}, count);
}

export function recordCalibrationOutcome(input: {
  phase: "started" | "completed";
  correlation?: number;
  outlierCount?: number;
}): void {
  const registry = getMetricsRegistry();
  registry.incrementCounter("scoring_v2_calibration_total", { phase: input.phase });
  if (input.correlation != null) {
    registry.observeHistogram(
      "scoring_v2_calibration_correlation",
      Math.round(input.correlation * 1000),
    );
  }
  if (input.outlierCount != null) {
    registry.incrementCounter(
      "scoring_v2_calibration_outliers_total",
      {},
      input.outlierCount,
    );
  }
}

export function recordReferenceSliceState(state: string): void {
  getMetricsRegistry().incrementCounter("scoring_v2_reference_slice_state_total", {
    state: state.slice(0, 64),
  });
}
