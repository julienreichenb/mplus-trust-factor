/**
 * Pure shadow / predict admission decision (no Redis I/O).
 */

import {
  computeEmergencyAvailablePoints,
  computeEmergencyReservePoints,
  computeNormalAvailablePoints,
  deriveWclWindowId,
  isRefreshAdmissionRedisMutationEnabled,
  isWclSnapshotFresh,
  type RefreshAdmissionConfig,
} from "@mplus/config";
import type {
  RefreshAdmissionDecisionReason,
  RefreshAdmissionLane,
  RefreshAdmissionPredictInput,
  RefreshAdmissionPrediction,
} from "./types.js";

function basePrediction(
  config: RefreshAdmissionConfig,
  input: RefreshAdmissionPredictInput,
  partial: Omit<
    RefreshAdmissionPrediction,
    "mode" | "wouldMutateRedis" | "serialRealityWouldProceed" | "shadowDivergence" | "metadata"
  > & { metadata?: Record<string, unknown> },
): RefreshAdmissionPrediction {
  const serialRealityWouldProceed =
    !input.providerStop &&
    (input.schedulingState ?? "RUNNING") === "RUNNING" &&
    (!input.wclRequired ||
      (input.snapshot != null &&
        Number.isFinite(input.snapshot.pointsLimit) &&
        input.snapshot.pointsLimit > 0));

  const shadowDivergence =
    config.mode === "shadow" && partial.admitted !== serialRealityWouldProceed;

  return {
    mode: config.mode,
    wouldMutateRedis: false,
    ...partial,
    serialRealityWouldProceed,
    shadowDivergence,
    metadata: {
      foundationBranch: "feat/refresh-admission-foundation",
      redisMutationEnabled: isRefreshAdmissionRedisMutationEnabled(config),
      ...partial.metadata,
    },
  };
}

export function predictRefreshAdmission(
  config: RefreshAdmissionConfig,
  input: RefreshAdmissionPredictInput,
): RefreshAdmissionPrediction {
  const nowMs = input.nowMs ?? Date.now();
  const lane: RefreshAdmissionLane = !input.wclRequired
    ? "non_wcl"
    : input.emergencyOverride
      ? "emergency"
      : "normal";

  const emptyAvail = {
    emergencyReservePoints: 0,
    normalAvailablePoints: 0,
    emergencyAvailablePoints: 0,
    globalSlotsRemaining: Math.max(0, config.globalConcurrency - input.activeGlobalSlots),
  };

  if (config.mode === "off") {
    return basePrediction(config, input, {
      admitted: false,
      reason: "MODE_OFF",
      lane,
      windowId: null,
      estimatedWclPoints: Math.max(0, Math.floor(input.estimatedWclPoints)),
      ...emptyAvail,
    });
  }

  if (input.providerStop) {
    return basePrediction(config, input, {
      admitted: false,
      reason: "PROVIDER_STOP",
      lane,
      windowId: input.snapshot?.windowId ?? deriveWclWindowId(input.snapshot?.resetAt ?? null),
      estimatedWclPoints: Math.max(0, Math.floor(input.estimatedWclPoints)),
      ...emptyAvail,
    });
  }

  const schedulingState = input.schedulingState ?? "RUNNING";
  if (schedulingState === "PAUSED" || schedulingState === "DRAINING") {
    return basePrediction(config, input, {
      admitted: false,
      reason: "SCHEDULING_PAUSED",
      lane,
      windowId: null,
      estimatedWclPoints: Math.max(0, Math.floor(input.estimatedWclPoints)),
      ...emptyAvail,
    });
  }

  const estimated = Math.max(0, Math.floor(input.estimatedWclPoints));
  const globalSlotsRemaining = Math.max(
    0,
    config.globalConcurrency - Math.max(0, Math.floor(input.activeGlobalSlots)),
  );

  if (input.existingGlobalSlot || input.existingReservationPoints != null) {
    const windowId =
      input.snapshot?.windowId ?? deriveWclWindowId(input.snapshot?.resetAt ?? null);
    return basePrediction(config, input, {
      admitted: true,
      reason: "IDEMPOTENT_EXISTING",
      lane,
      windowId,
      estimatedWclPoints: input.existingReservationPoints ?? estimated,
      emergencyReservePoints: 0,
      normalAvailablePoints: 0,
      emergencyAvailablePoints: 0,
      globalSlotsRemaining,
      metadata: { idempotent: true },
    });
  }

  if (!input.existingGlobalSlot && globalSlotsRemaining <= 0) {
    return basePrediction(config, input, {
      admitted: false,
      reason: "INSUFFICIENT_GLOBAL_SLOTS",
      lane,
      windowId: null,
      estimatedWclPoints: estimated,
      ...emptyAvail,
      globalSlotsRemaining: 0,
    });
  }

  if (!input.wclRequired || estimated === 0) {
    return basePrediction(config, input, {
      admitted: true,
      reason: "NON_WCL_SLOT_ONLY",
      lane: "non_wcl",
      windowId: null,
      estimatedWclPoints: 0,
      emergencyReservePoints: 0,
      normalAvailablePoints: 0,
      emergencyAvailablePoints: 0,
      globalSlotsRemaining,
    });
  }

  const snapshot = input.snapshot;
  if (!snapshot) {
    return basePrediction(config, input, {
      admitted: false,
      reason: "SNAPSHOT_MISSING",
      lane,
      windowId: null,
      estimatedWclPoints: estimated,
      ...emptyAvail,
      globalSlotsRemaining,
    });
  }

  if (
    !isWclSnapshotFresh({
      fetchedAt: snapshot.fetchedAt,
      maxAgeSeconds: config.wclSnapshotMaxAgeSeconds,
      nowMs,
    })
  ) {
    return basePrediction(config, input, {
      admitted: false,
      reason: "SNAPSHOT_STALE",
      lane,
      windowId: snapshot.windowId ?? deriveWclWindowId(snapshot.resetAt),
      estimatedWclPoints: estimated,
      ...emptyAvail,
      globalSlotsRemaining,
    });
  }

  if (!Number.isFinite(snapshot.pointsLimit) || snapshot.pointsLimit <= 0) {
    return basePrediction(config, input, {
      admitted: false,
      reason: "POINTS_LIMIT_INVALID",
      lane,
      windowId: snapshot.windowId ?? deriveWclWindowId(snapshot.resetAt),
      estimatedWclPoints: estimated,
      ...emptyAvail,
      globalSlotsRemaining,
    });
  }

  const windowId = snapshot.windowId ?? deriveWclWindowId(snapshot.resetAt);
  if (!windowId) {
    return basePrediction(config, input, {
      admitted: false,
      reason: "WINDOW_ID_MISSING",
      lane,
      windowId: null,
      estimatedWclPoints: estimated,
      ...emptyAvail,
      globalSlotsRemaining,
    });
  }

  const emergencyReservePoints = computeEmergencyReservePoints(
    snapshot.pointsLimit,
    config.safetyReserveFraction,
    config.minEmergencyReservePoints,
  );
  const normalAvailablePoints = computeNormalAvailablePoints({
    pointsRemaining: snapshot.pointsRemaining,
    emergencyReservePoints,
    activeReservedPoints: input.activeReservedPoints,
  });
  const emergencyAvailablePoints = computeEmergencyAvailablePoints({
    pointsRemaining: snapshot.pointsRemaining,
    activeReservedPoints: input.activeReservedPoints,
  });

  const available = input.emergencyOverride ? emergencyAvailablePoints : normalAvailablePoints;
  if (available < estimated) {
    return basePrediction(config, input, {
      admitted: false,
      reason: "INSUFFICIENT_RESERVED_CAPACITY",
      lane,
      windowId,
      estimatedWclPoints: estimated,
      emergencyReservePoints,
      normalAvailablePoints,
      emergencyAvailablePoints,
      globalSlotsRemaining,
    });
  }

  let reason: RefreshAdmissionDecisionReason = "OK";
  if (config.mode === "enforce" && !isRefreshAdmissionRedisMutationEnabled(config)) {
    reason = "ENFORCE_NOT_ACTIVATED";
  }

  return basePrediction(config, input, {
    admitted: true,
    reason: reason === "ENFORCE_NOT_ACTIVATED" ? "ENFORCE_NOT_ACTIVATED" : "OK",
    // Foundation never claims Redis mutation even when prediction says admit.
    lane,
    windowId,
    estimatedWclPoints: estimated,
    emergencyReservePoints,
    normalAvailablePoints,
    emergencyAvailablePoints,
    globalSlotsRemaining,
    metadata: {
      note:
        reason === "ENFORCE_NOT_ACTIVATED"
          ? "Prediction only; Redis mutation requires concurrency activation on a later branch"
          : undefined,
    },
  });
}
