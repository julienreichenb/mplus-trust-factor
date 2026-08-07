/**
 * Scoring V2 structured events + metric helpers.
 * Never pass raw character names, report codes, or provider secrets into these helpers
 * without going through sanitizeScoringLogFields / sanitizeSensitiveDeep.
 *
 * Deferred: cost-source metric classification (frozen / provider-estimated / unknown)
 * is not added here to avoid changing existing `scoring_wcl_points_total` label
 * contracts. Revisit when a dedicated cost-source series is introduced.
 */

import type { Logger } from "pino";
import type { OBS_EVENTS, ObsEventName } from "./events.js";
import { getMetricsRegistry } from "./metrics.js";
import {
  fingerprintIdentifier,
  normalizeOperationalError,
  sanitizeFreeText,
  sanitizeSensitiveDeep,
} from "./security.js";

export const SCORING_JOB_SCHEMA_VERSION = "2.0.0" as const;
export const SCORING_EVIDENCE_MANIFEST_SCHEMA_VERSION = "2.0.0" as const;
export const SCORING_ACQUISITION_PLAN_SCHEMA_VERSION = "2.0.0" as const;

export type ScoringEventName =
  | typeof OBS_EVENTS.scoringDiscoveryStarted
  | typeof OBS_EVENTS.scoringDiscoveryCompleted
  | typeof OBS_EVENTS.scoringManifestFrozen
  | typeof OBS_EVENTS.scoringAdmissionAdmitted
  | typeof OBS_EVENTS.scoringAdmissionDeferred
  | typeof OBS_EVENTS.scoringAdmissionStopped
  | typeof OBS_EVENTS.scoringSlotStarted
  | typeof OBS_EVENTS.scoringSlotCompleted
  | typeof OBS_EVENTS.scoringSlotFailed
  | typeof OBS_EVENTS.scoringDatasetCacheHit
  | typeof OBS_EVENTS.scoringDatasetFetched
  | typeof OBS_EVENTS.scoringDatasetTruncated
  | typeof OBS_EVENTS.scoringFactSetWritten
  | typeof OBS_EVENTS.scoringBatchReady
  | typeof OBS_EVENTS.scoringBatchFinalized
  | typeof OBS_EVENTS.scoringPublicationCandidate
  | typeof OBS_EVENTS.scoringPublicationPublished
  | typeof OBS_EVENTS.scoringPublicationRejected
  | typeof OBS_EVENTS.scoringCalibrationStarted
  | typeof OBS_EVENTS.scoringCalibrationCompleted
  | typeof OBS_EVENTS.scoringReferenceSliceStateChanged
  | typeof OBS_EVENTS.scoringAdminEvidenceExportRequested
  | typeof OBS_EVENTS.scoringAdminEvidenceExportStarted
  | typeof OBS_EVENTS.scoringAdminEvidenceExportCompleted
  | typeof OBS_EVENTS.scoringAdminEvidenceExportFailed
  | typeof OBS_EVENTS.scoringAdminBundleFrozen
  | typeof OBS_EVENTS.scoringAdminConcurrencyUpdated
  | typeof OBS_EVENTS.scoringConcurrencyPermitAcquired
  | typeof OBS_EVENTS.scoringConcurrencyPermitReleased
  | typeof OBS_EVENTS.scoringConcurrencyLimitReached
  | typeof OBS_EVENTS.scoringFinalizationClaimReleased
  | typeof OBS_EVENTS.scoringFinalizationClaimLost
  | typeof OBS_EVENTS.scoringFinalizationReclaim;

export interface ScoringCorrelationFields {
  correlationId?: string | null;
  analysisBatchId?: string | null;
  characterId?: string | null;
  seasonId?: string | null;
  slotId?: string | null;
  refreshGeneration?: number | null;
}

/**
 * Run telemetry without ever altering pipeline success/failure.
 * Swallow all exceptions; never recurse into further telemetry reporting.
 */
export function runSafeTelemetry(fn: () => void): void {
  try {
    fn();
  } catch {
    // Intentionally empty — telemetry must not fail jobs or recurse.
  }
}

/** Safe log fields: fingerprint character ids already UUIDs; never emit raw names/codes. */
export function buildScoringLogContext(
  fields: ScoringCorrelationFields & Record<string, unknown>,
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

  return sanitizeScoringLogFields({ ...base, ...rest });
}

export function sanitizeScoringLogFields(
  fields: Record<string, unknown>,
): Record<string, unknown> {
  return sanitizeSensitiveDeep(fields) as Record<string, unknown>;
}

/** Bound a free-form reason for events (never raw provider messages). */
export function boundOperationalReason(reason: string, maxLen = 64): string {
  return sanitizeFreeText(reason, maxLen);
}

export function emitScoringEvent(
  logger: Pick<Logger, "info" | "warn" | "error">,
  event: ScoringEventName | ObsEventName,
  fields: ScoringCorrelationFields & Record<string, unknown> = {},
  level: "info" | "warn" | "error" = "info",
): void {
  runSafeTelemetry(() => {
    const payload = {
      event,
      ...buildScoringLogContext(fields),
    };
    logger[level](payload, event);
  });
}

export function recordManifestCoverage(input: {
  coverageState: string;
  selectedSlotCount: number;
  expectedSlotCount: number;
  fallbackDepth?: number;
}): void {
  runSafeTelemetry(() => {
    const registry = getMetricsRegistry();
    registry.incrementCounter("scoring_manifest_coverage_total", {
      coverageState: input.coverageState,
    });
    registry.observeHistogram("scoring_slots_per_character", input.selectedSlotCount, {
      expected: String(input.expectedSlotCount),
    });
    if (input.fallbackDepth != null) {
      registry.observeHistogram("scoring_fallback_depth", input.fallbackDepth);
    }
  });
}

export function recordInvalidCandidateReason(reason: string): void {
  runSafeTelemetry(() => {
    getMetricsRegistry().incrementCounter("scoring_invalid_candidate_total", {
      reason: boundOperationalReason(reason, 64),
    });
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
  runSafeTelemetry(() => {
    const registry = getMetricsRegistry();
    const labels = {
      outcome: input.outcome,
      ...(input.datasetKey ? { datasetKey: input.datasetKey.slice(0, 64) } : {}),
      ...(input.dimension ? { dimension: input.dimension } : {}),
    };
    registry.incrementCounter("scoring_dataset_outcome_total", labels);
    if (input.wclPoints != null) {
      registry.incrementCounter(
        "scoring_wcl_points_total",
        {
          ...(input.datasetKey ? { datasetKey: input.datasetKey.slice(0, 64) } : {}),
          ...(input.dimension ? { dimension: input.dimension } : {}),
        },
        input.wclPoints,
      );
    }
    if (input.bytes != null) {
      registry.observeHistogram("scoring_artifact_bytes", input.bytes, {
        kind: "dataset",
      });
    }
    if (input.latencyMs != null) {
      registry.observeHistogram("scoring_provider_latency_ms", input.latencyMs, {
        cacheHit: String(input.outcome === "cache_hit"),
      });
    }
  });
}

export function recordFactSetWritten(input: { dimension?: string; bytes?: number }): void {
  runSafeTelemetry(() => {
    const registry = getMetricsRegistry();
    registry.incrementCounter("scoring_fact_set_written_total", {
      ...(input.dimension ? { dimension: input.dimension } : {}),
    });
    if (input.bytes != null) {
      registry.observeHistogram("scoring_artifact_bytes", input.bytes, { kind: "fact_set" });
    }
  });
}

export type SlotOutcomeKind =
  | "started"
  | "completed"
  | "failed"
  | "unavailable"
  | "cancelled";

export function recordSlotOutcome(outcome: SlotOutcomeKind, status?: string): void {
  runSafeTelemetry(() => {
    getMetricsRegistry().incrementCounter("scoring_slot_outcome_total", {
      outcome,
      ...(status ? { status: status.slice(0, 32) } : {}),
    });
  });
}

export function recordBatchOutcome(outcome: "ready" | "finalized"): void {
  runSafeTelemetry(() => {
    getMetricsRegistry().incrementCounter("scoring_batch_outcome_total", { outcome });
  });
}

export function recordAdmissionDecision(action: "admitted" | "deferred" | "stopped"): void {
  runSafeTelemetry(() => {
    getMetricsRegistry().incrementCounter("scoring_admission_total", { action });
  });
}

export function recordPublicationDecision(
  action: "candidate" | "published" | "rejected",
  reason?: string,
): void {
  runSafeTelemetry(() => {
    getMetricsRegistry().incrementCounter("scoring_publication_total", {
      action,
      ...(reason ? { reason: boundOperationalReason(reason, 64) } : {}),
    });
  });
}

export function recordFinalizationRecovery(
  action: "claim_released" | "claim_lost" | "reclaim",
): void {
  runSafeTelemetry(() => {
    // Labels are bounded enums only — never batch IDs.
    getMetricsRegistry().incrementCounter("scoring_finalization_recovery_total", { action });
  });
}

export function recordScoreConfidenceSample(input: {
  score: number;
  confidence: number;
  modelKey?: string;
  source: "v1" | "v2";
}): void {
  runSafeTelemetry(() => {
    const registry = getMetricsRegistry();
    const labels = {
      source: input.source,
      ...(input.modelKey ? { modelKey: input.modelKey } : {}),
    };
    registry.observeHistogram("scoring_score_distribution", input.score, labels);
    registry.observeHistogram("scoring_confidence_distribution", input.confidence * 100, labels);
  });
}

export function recordV1V2Delta(deltaAbs: number): void {
  runSafeTelemetry(() => {
    getMetricsRegistry().observeHistogram("scoring_v1_v2_delta_abs", Math.abs(deltaAbs));
  });
}

export function recordQueueSnapshot(input: { queue: string; depth: number; ageMs?: number }): void {
  runSafeTelemetry(() => {
    const registry = getMetricsRegistry();
    registry.recordQueueDepth(input.queue, input.depth);
    if (input.ageMs != null) {
      registry.observeHistogram("scoring_queue_age_ms", input.ageMs, { queue: input.queue });
    }
  });
}

export function recordArtifactOrphan(count = 1): void {
  runSafeTelemetry(() => {
    getMetricsRegistry().incrementCounter("scoring_artifact_orphans_total", {}, count);
  });
}

export function recordCalibrationOutcome(input: {
  phase: "started" | "completed";
  correlation?: number;
  outlierCount?: number;
}): void {
  runSafeTelemetry(() => {
    const registry = getMetricsRegistry();
    registry.incrementCounter("scoring_calibration_total", { phase: input.phase });
    if (input.correlation != null) {
      registry.observeHistogram(
        "scoring_calibration_correlation",
        Math.round(input.correlation * 1000),
      );
    }
    if (input.outlierCount != null) {
      registry.incrementCounter(
        "scoring_calibration_outliers_total",
        {},
        input.outlierCount,
      );
    }
  });
}

export function recordReferenceSliceState(state: string): void {
  runSafeTelemetry(() => {
    getMetricsRegistry().incrementCounter("scoring_reference_slice_state_total", {
      state: boundOperationalReason(state, 64),
    });
  });
}

export { normalizeOperationalError };
