/**
 * Worker readiness checks for the Redis WCL admission snapshot mirror.
 */

import type { AppEnv } from "@mplus/config";
import {
  readWclAdmissionSnapshot,
  type AdmissionRedis,
} from "./redis-ops.js";
import {
  isAdmissionSnapshotFreshForReadiness,
  validateAdmissionRateSnapshot,
} from "./snapshot-validation.js";

export type AdmissionSnapshotReadinessDetail =
  | "ok"
  | "admission_snapshot_not_required"
  | "admission_snapshot_missing"
  | "admission_snapshot_stale"
  | "admission_snapshot_invalid"
  | "admission_snapshot_refresher_unavailable";

export interface AdmissionSnapshotReadinessResult {
  ok: boolean;
  detail: AdmissionSnapshotReadinessDetail;
  required: boolean;
}

/**
 * When enforce + WCL enabled, readiness requires a valid non-stale Redis snapshot.
 * Sanitized details only — never raw Redis values.
 */
export async function checkAdmissionSnapshotReadiness(input: {
  env: Pick<
    AppEnv,
    | "REFRESH_ADMISSION_MODE"
    | "WCL_ENABLED"
    | "APP_ENV"
    | "REFRESH_WCL_SNAPSHOT_MAX_AGE_SECONDS"
  >;
  redis: AdmissionRedis;
  /** When enforce+WCL and the refresher could not start (missing capability). */
  refresherUnavailable?: boolean;
  nowMs?: number;
}): Promise<AdmissionSnapshotReadinessResult> {
  const required =
    input.env.REFRESH_ADMISSION_MODE === "enforce" && input.env.WCL_ENABLED === true;

  if (!required) {
    return { ok: true, detail: "admission_snapshot_not_required", required: false };
  }

  if (input.refresherUnavailable) {
    return { ok: false, detail: "admission_snapshot_refresher_unavailable", required: true };
  }

  const raw = await readWclAdmissionSnapshot(input.redis, input.env.APP_ENV);
  if (!raw) {
    return { ok: false, detail: "admission_snapshot_missing", required: true };
  }

  const validated = validateAdmissionRateSnapshot(raw, { nowMs: input.nowMs });
  if (!validated.ok || !validated.snapshot) {
    return { ok: false, detail: "admission_snapshot_invalid", required: true };
  }

  if (
    !isAdmissionSnapshotFreshForReadiness(
      validated.snapshot,
      input.env.REFRESH_WCL_SNAPSHOT_MAX_AGE_SECONDS,
      input.nowMs,
    )
  ) {
    return { ok: false, detail: "admission_snapshot_stale", required: true };
  }

  return { ok: true, detail: "ok", required: true };
}
