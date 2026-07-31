/**
 * Aligned ownership / idempotency semantics for predictRefreshAdmission
 * and REFRESH_ADMISSION_RESERVE_LUA.
 *
 * WCL jobs that require estimated points (> 0):
 * - reservation + global slot → idempotent admit
 * - reservation without slot → reject inconsistent state (no silent admit;
 *   repair is a later reconcile path, not an admit short-circuit)
 * - slot without reservation → do not short-circuit; continue WCL capacity checks
 *
 * Non-WCL / zero-estimate jobs may legitimately hold only a global slot.
 */

export type AdmissionOwnershipClassification =
  | {
      kind: "none";
    }
  | {
      kind: "idempotent_full";
      reservationPoints: number;
    }
  | {
      kind: "inconsistent_reservation_without_slot";
      reservationPoints: number;
    }
  | {
      kind: "slot_without_reservation";
    }
  | {
      kind: "non_wcl_idempotent_slot";
    };

export function classifyAdmissionOwnership(input: {
  wclRequired: boolean;
  estimatedWclPoints: number;
  existingReservationPoints?: number | null;
  existingGlobalSlot?: boolean;
}): AdmissionOwnershipClassification {
  const hasReservation = input.existingReservationPoints != null;
  const hasSlot = input.existingGlobalSlot === true;
  const reservationPoints = hasReservation
    ? Math.max(0, Math.floor(input.existingReservationPoints as number))
    : 0;
  const wclNeedsReservation =
    input.wclRequired && Math.max(0, Math.floor(input.estimatedWclPoints)) > 0;

  if (hasReservation && hasSlot) {
    return { kind: "idempotent_full", reservationPoints };
  }
  if (hasReservation && !hasSlot) {
    return { kind: "inconsistent_reservation_without_slot", reservationPoints };
  }
  if (!hasReservation && hasSlot) {
    if (!wclNeedsReservation) {
      return { kind: "non_wcl_idempotent_slot" };
    }
    return { kind: "slot_without_reservation" };
  }
  return { kind: "none" };
}

/**
 * Mirrors the Redis ownership branch inside REFRESH_ADMISSION_RESERVE_LUA
 * (after snapshot validation). Pure — no Redis I/O.
 *
 * Return shape matches Lua: [ok, reason, ...payload]
 */
export function simulateReserveLuaOwnershipBranch(input: {
  /** HGET resKey jobId → points string/number, or null if missing */
  existingReservation: number | string | null;
  /** HEXISTS slotOwners jobId */
  hasSlot: boolean;
  estimatedPoints: number;
}): { ok: 0 | 1; reason: string; payload: number[] } {
  const existing =
    input.existingReservation == null ? null : Number(input.existingReservation);
  if (existing != null && Number.isFinite(existing)) {
    if (input.hasSlot) {
      return { ok: 1, reason: "IDEMPOTENT_EXISTING", payload: [existing, 1] };
    }
    return {
      ok: 0,
      reason: "INCONSISTENT_RESERVATION_WITHOUT_SLOT",
      payload: [existing, 0],
    };
  }
  // No reservation: Lua continues to capacity checks / optional slot acquire.
  // Slot-without-reservation must NOT return here as idempotent success.
  if (input.hasSlot && input.estimatedPoints <= 0) {
    // Non-WCL path later returns OK after slot handling; ownership alone is not
    // IDEMPOTENT_EXISTING in Lua when estimated==0 and no res — predict classifies
    // non_wcl_idempotent_slot separately. Lua falls through.
    return { ok: 1, reason: "CONTINUE_CAPACITY_CHECKS", payload: [] };
  }
  return { ok: 1, reason: "CONTINUE_CAPACITY_CHECKS", payload: [] };
}
