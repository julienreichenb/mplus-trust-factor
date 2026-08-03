/**
 * Authoritative refresh workload classification from the persisted IngestionJob row.
 * BullMQ payload.workloadClass is informational only.
 */
import { QUEUE_NAMES } from "@mplus/contracts";

export type RefreshWorkloadClass = "CALIBRATION" | "OPERATION";

export const WORKLOAD_CLASS_PAYLOAD_MISMATCH = "WORKLOAD_CLASS_PAYLOAD_MISMATCH" as const;
export const WORKLOAD_CLASS_QUEUE_MISMATCH = "WORKLOAD_CLASS_QUEUE_MISMATCH" as const;

export function parseWorkloadClass(value: unknown): RefreshWorkloadClass | null {
  return value === "CALIBRATION" || value === "OPERATION" ? value : null;
}

/**
 * Resolve the lane for permit acquisition.
 * - DB CALIBRATION/OPERATION wins
 * - legacy null/unknown DB → OPERATION (explicit compatibility)
 * - payload mismatch is reported but never overrides DB
 */
export function resolveAuthoritativeWorkloadClass(input: {
  persistedWorkloadClass: unknown;
  payloadWorkloadClass?: unknown;
}): {
  workloadClass: RefreshWorkloadClass;
  payloadWorkloadClass: RefreshWorkloadClass | null;
  mismatch: boolean;
  legacyDbDefault: boolean;
  reasonCode: typeof WORKLOAD_CLASS_PAYLOAD_MISMATCH | null;
} {
  const db = parseWorkloadClass(input.persistedWorkloadClass);
  const payload = parseWorkloadClass(input.payloadWorkloadClass);
  const workloadClass: RefreshWorkloadClass = db ?? "OPERATION";
  const mismatch = payload != null && payload !== workloadClass;
  return {
    workloadClass,
    payloadWorkloadClass: payload,
    mismatch,
    legacyDbDefault: db == null,
    reasonCode: mismatch ? WORKLOAD_CLASS_PAYLOAD_MISMATCH : null,
  };
}

/** Queue name expected for a persisted workload class. */
export function expectedRefreshQueueForWorkloadClass(
  workloadClass: RefreshWorkloadClass,
): string {
  return workloadClass === "CALIBRATION"
    ? QUEUE_NAMES.refreshCharacterCalibration
    : QUEUE_NAMES.refreshCharacter;
}

/**
 * Fail closed when the worker queue disagrees with the persisted lane.
 * Returns null when ok / when queue is unknown (inline / test callers).
 */
export function workloadClassQueueDisagreement(input: {
  persistedWorkloadClass: RefreshWorkloadClass;
  queueName: string | null | undefined;
}): { reasonCode: typeof WORKLOAD_CLASS_QUEUE_MISMATCH; message: string } | null {
  if (!input.queueName) return null;
  const refreshQueues = new Set<string>([
    QUEUE_NAMES.refreshCharacter,
    QUEUE_NAMES.refreshCharacterCalibration,
  ]);
  if (!refreshQueues.has(input.queueName)) {
    return null;
  }
  const expected = expectedRefreshQueueForWorkloadClass(input.persistedWorkloadClass);
  if (input.queueName !== expected) {
    return {
      reasonCode: WORKLOAD_CLASS_QUEUE_MISMATCH,
      message: `Queue ${input.queueName} disagrees with persisted workloadClass ${input.persistedWorkloadClass} (expected ${expected})`,
    };
  }
  return null;
}
