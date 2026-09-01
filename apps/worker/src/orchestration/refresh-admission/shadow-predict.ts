/**
 * Pure shadow / predict admission decision (no Redis I/O).
 */

import {
  computeEmergencyAvailablePoints,
  computeEmergencyReservePoints,
  computeNormalAvailablePoints,
  deriveWclWindowId,
  effectiveAdmissionGlobalConcurrency,
  isRefreshAdmissionRedisMutationEnabled,
  isWclSnapshotFresh,
  resolveAdmissionReservePolicy,
  type RefreshAdmissionConfig,
} from "@mplus/config";
import type {
  RefreshAdmissionLane,
  RefreshAdmissionPredictInput,
  RefreshAdmissionPrediction,
} from "./types.js";
import { classifyAdmissionOwnership } from "./ownership.js";

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
    globalSlotsRemaining: Math.max(0, effectiveAdmissionGlobalConcurrency(config) - input.activeGlobalSlots),
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
  const effectiveGlobalLimit = effectiveAdmissionGlobalConcurrency(config);
  const globalSlotsRemaining = Math.max(
    0,
    effectiveGlobalLimit - Math.max(0, Math.floor(input.activeGlobalSlots)),
  );

  const ownership = classifyAdmissionOwnership({
    wclRequired: input.wclRequired,
    estimatedWclPoints: estimated,
    existingReservationPoints: input.existingReservationPoints,
    existingGlobalSlot: input.existingGlobalSlot,
  });

  if (ownership.kind === "idempotent_full") {
    const windowId =
      input.snapshot?.windowId ?? deriveWclWindowId(input.snapshot?.resetAt ?? null);
    return basePrediction(config, input, {
      admitted: true,
      reason: "IDEMPOTENT_EXISTING",
      lane,
      windowId,
      estimatedWclPoints: ownership.reservationPoints,
      emergencyReservePoints: 0,
      normalAvailablePoints: 0,
      emergencyAvailablePoints: 0,
      globalSlotsRemaining,
      metadata: { idempotent: true, ownership: ownership.kind },
    });
  }

  if (ownership.kind === "inconsistent_reservation_without_slot") {
    const windowId =
      input.snapshot?.windowId ?? deriveWclWindowId(input.snapshot?.resetAt ?? null);
    return basePrediction(config, input, {
      admitted: false,
      reason: "INCONSISTENT_RESERVATION_WITHOUT_SLOT",
      lane,
      windowId,
      estimatedWclPoints: ownership.reservationPoints,
      emergencyReservePoints: 0,
      normalAvailablePoints: 0,
      emergencyAvailablePoints: 0,
      globalSlotsRemaining,
      metadata: {
        idempotent: false,
        ownership: ownership.kind,
        note: "Reservation without global slot is rejected until reconcile repairs or releases",
      },
    });
  }

  if (ownership.kind === "non_wcl_idempotent_slot") {
    return basePrediction(config, input, {
      admitted: true,
      reason: "IDEMPOTENT_EXISTING",
      lane: "non_wcl",
      windowId: null,
      estimatedWclPoints: 0,
      emergencyReservePoints: 0,
      normalAvailablePoints: 0,
      emergencyAvailablePoints: 0,
      globalSlotsRemaining,
      metadata: { idempotent: true, ownership: ownership.kind },
    });
  }

  // slot_without_reservation: continue into WCL capacity checks (do not short-circuit).
  // none: acquire path.

  if (ownership.kind !== "slot_without_reservation" && globalSlotsRemaining <= 0) {
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
      metadata: { ownership: ownership.kind },
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

  const reservePolicy = resolveAdmissionReservePolicy({
    config,
    resetAt: snapshot.resetAt,
    nowMs,
  });
  const emergencyReservePoints = computeEmergencyReservePoints(
    snapshot.pointsLimit,
    reservePolicy.safetyReserveFraction,
    reservePolicy.minEmergencyReservePoints,
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
      metadata: {
        ownership: ownership.kind,
        repairReservation: ownership.kind === "slot_without_reservation",
      },
    });
  }

  return basePrediction(config, input, {
    admitted: true,
    reason: "OK",
    lane,
    windowId,
    estimatedWclPoints: estimated,
    emergencyReservePoints,
    normalAvailablePoints,
    emergencyAvailablePoints,
    globalSlotsRemaining,
    metadata: {
      ownership: ownership.kind,
      repairReservation: ownership.kind === "slot_without_reservation",
      drainActive: reservePolicy.drainActive,
      pointsResetInSeconds: reservePolicy.pointsResetInSeconds,
    },
  });
}
