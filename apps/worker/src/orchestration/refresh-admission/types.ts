/**
 * Refresh admission foundation types.
 * Live Redis mutation is gated; shadow mode predicts only.
 */

import type { RefreshAdmissionMode } from "@mplus/config";

export type RefreshAdmissionDecisionReason =
  | "OK"
  | "MODE_OFF"
  | "SNAPSHOT_MISSING"
  | "SNAPSHOT_STALE"
  | "POINTS_LIMIT_INVALID"
  | "WINDOW_ID_MISSING"
  | "INSUFFICIENT_RESERVED_CAPACITY"
  | "INSUFFICIENT_GLOBAL_SLOTS"
  | "SCHEDULING_PAUSED"
  | "PROVIDER_STOP"
  | "IDEMPOTENT_EXISTING"
  | "INCONSISTENT_RESERVATION_WITHOUT_SLOT"
  | "NON_WCL_SLOT_ONLY"
  | "ENFORCE_NOT_ACTIVATED"
  | "REDIS_UNAVAILABLE"
  | "LEASE_NOT_OWNED"
  /** Lane permit Redis connection missing or unusable — fail closed before providers. */
  | "LANE_REDIS_UNAVAILABLE"
  /** Lane lease renew failed / ownership lost while job still running. */
  | "LANE_PERMIT_LOST";

export type RefreshAdmissionOutcomeKind = "admitted" | "deferred" | "denied" | "shadow" | "off";

/** Reasons that should delay a new durable execution (not BullMQ multi-attempt). */
export const REFRESH_ADMISSION_DEFER_REASONS: ReadonlySet<RefreshAdmissionDecisionReason> = new Set([
  "INSUFFICIENT_RESERVED_CAPACITY",
  "INSUFFICIENT_GLOBAL_SLOTS",
  "SNAPSHOT_STALE",
  "SNAPSHOT_MISSING",
  "REDIS_UNAVAILABLE",
  "LANE_REDIS_UNAVAILABLE",
  "LANE_PERMIT_LOST",
  "SCHEDULING_PAUSED",
]);

export interface RefreshAdmissionLiveResult {
  prediction: RefreshAdmissionPrediction;
  outcome: RefreshAdmissionOutcomeKind;
  reservedPoints: number;
  leaseExpiresAt: Date | null;
  windowId: string | null;
  idempotent: boolean;
  providerCallsAvoided: boolean;
}

export interface RefreshAdmissionSettleInput {
  ingestionJobId: string;
  measuredWclPoints: number | null;
  status: "SETTLED" | "RELEASED" | "CANCELLED" | "EXPIRED";
  metadata?: Record<string, unknown>;
}

export interface RefreshAdmissionReleaseResult {
  released: boolean;
  reason: string;
  releasedPoints: number;
  hadSlot: boolean;
}

export type RefreshSchedulingState =
  | "RUNNING"
  | "PAUSED"
  | "RATE_LIMITED"
  | "CIRCUIT_OPEN"
  | "DRAINING";

export type RefreshAdmissionLane = "normal" | "emergency" | "non_wcl";

export interface RefreshAdmissionRateSnapshot {
  pointsRemaining: number;
  pointsLimit: number;
  resetAt: string | null;
  fetchedAt: string;
  windowId?: string | null;
}

export interface RefreshAdmissionPredictInput {
  ingestionJobId: string;
  characterId?: string | null;
  estimatedWclPoints: number;
  wclRequired: boolean;
  emergencyOverride?: boolean;
  /** Live provider STOP — absolute in V1; emergency does not bypass. */
  providerStop?: boolean;
  schedulingState?: RefreshSchedulingState;
  snapshot: RefreshAdmissionRateSnapshot | null;
  activeReservedPoints: number;
  activeGlobalSlots: number;
  /** Existing reservation points for this job (idempotent re-admit). */
  existingReservationPoints?: number | null;
  /** Whether this job already holds a global slot. */
  existingGlobalSlot?: boolean;
  nowMs?: number;
}

export interface RefreshAdmissionPrediction {
  mode: RefreshAdmissionMode;
  /** Always false on foundation when Redis mutation is disabled. */
  wouldMutateRedis: boolean;
  admitted: boolean;
  reason: RefreshAdmissionDecisionReason;
  lane: RefreshAdmissionLane;
  windowId: string | null;
  estimatedWclPoints: number;
  emergencyReservePoints: number;
  normalAvailablePoints: number;
  emergencyAvailablePoints: number;
  globalSlotsRemaining: number;
  /** Shadow compare: serial reality always admits at concurrency 1 when otherwise eligible. */
  serialRealityWouldProceed: boolean;
  shadowDivergence: boolean;
  metadata: Record<string, unknown>;
}
