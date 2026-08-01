/**
 * Validate WCL admission rate snapshots before Redis write / readiness.
 */

import { deriveWclWindowId, isWclSnapshotFresh } from "@mplus/config";
import type { RefreshAdmissionRateSnapshot } from "./types.js";

export type AdmissionSnapshotValidationReason =
  | "ok"
  | "points_remaining_invalid"
  | "points_limit_invalid"
  | "fetched_at_invalid"
  | "reset_at_invalid"
  | "window_id_invalid"
  | "fetched_at_in_future";

export interface AdmissionSnapshotValidationResult {
  ok: boolean;
  reason: AdmissionSnapshotValidationReason;
  /** Normalized snapshot with derived windowId when ok. */
  snapshot: RefreshAdmissionRateSnapshot | null;
}

/** Max skew allowed for fetchedAt in the future (clock skew tolerance). */
const MAX_FUTURE_SKEW_MS = 5_000;

/**
 * Reject malformed snapshots before Redis write.
 * Does not check staleness — that is a readiness concern against maxAge.
 */
export function validateAdmissionRateSnapshot(
  input: RefreshAdmissionRateSnapshot,
  options?: { nowMs?: number },
): AdmissionSnapshotValidationResult {
  const nowMs = options?.nowMs ?? Date.now();
  const pointsRemaining = input.pointsRemaining;
  const pointsLimit = input.pointsLimit;

  if (!Number.isFinite(pointsRemaining) || pointsRemaining < 0) {
    return { ok: false, reason: "points_remaining_invalid", snapshot: null };
  }
  if (!Number.isFinite(pointsLimit) || pointsLimit <= 0) {
    return { ok: false, reason: "points_limit_invalid", snapshot: null };
  }

  const fetchedAtMs = Date.parse(input.fetchedAt);
  if (!Number.isFinite(fetchedAtMs)) {
    return { ok: false, reason: "fetched_at_invalid", snapshot: null };
  }
  if (fetchedAtMs - nowMs > MAX_FUTURE_SKEW_MS) {
    return { ok: false, reason: "fetched_at_in_future", snapshot: null };
  }

  const resetAt = input.resetAt ?? null;
  if (resetAt != null) {
    const resetMs = Date.parse(resetAt);
    if (!Number.isFinite(resetMs)) {
      return { ok: false, reason: "reset_at_invalid", snapshot: null };
    }
  }

  const derivedWindow = deriveWclWindowId(resetAt);
  const windowId = input.windowId ?? derivedWindow;
  if (resetAt != null) {
    if (!windowId || !derivedWindow || windowId !== derivedWindow) {
      return { ok: false, reason: "window_id_invalid", snapshot: null };
    }
  } else if (input.windowId != null && input.windowId !== "" && !derivedWindow) {
    // Explicit window without resetAt is allowed only if non-empty; empty/null reset is ok for non-windowed.
    // For WCL we require window identity when resetAt is present; when absent, windowId must be null/empty.
    return { ok: false, reason: "window_id_invalid", snapshot: null };
  }

  return {
    ok: true,
    reason: "ok",
    snapshot: {
      pointsRemaining: Math.floor(pointsRemaining),
      pointsLimit: Math.floor(pointsLimit),
      resetAt,
      fetchedAt: new Date(fetchedAtMs).toISOString(),
      windowId: windowId ?? derivedWindow ?? null,
    },
  };
}

export function isAdmissionSnapshotFreshForReadiness(
  snapshot: RefreshAdmissionRateSnapshot,
  maxAgeSeconds: number,
  nowMs = Date.now(),
): boolean {
  return isWclSnapshotFresh({
    fetchedAt: snapshot.fetchedAt,
    maxAgeSeconds,
    nowMs,
  });
}
