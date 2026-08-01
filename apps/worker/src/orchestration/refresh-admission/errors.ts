/**
 * Typed admission denial / deferral for the refresh pipeline.
 * Distinct from provider failure and from contract/eligibility barriers.
 */

import type { RefreshAdmissionDecisionReason } from "./types.js";
import { REFRESH_ADMISSION_DEFER_REASONS } from "./types.js";

export type RefreshAdmissionErrorCode =
  | "REFRESH_ADMISSION_DENIED"
  | "REFRESH_ADMISSION_DEFERRED";

export class RefreshAdmissionError extends Error {
  readonly code: RefreshAdmissionErrorCode;
  readonly reason: RefreshAdmissionDecisionReason;
  readonly retryable: boolean;
  readonly providerFailure = false as const;
  readonly deferred: boolean;
  readonly delayMs: number | undefined;

  constructor(input: {
    reason: RefreshAdmissionDecisionReason;
    message?: string;
    delayMs?: number;
  }) {
    const deferred = REFRESH_ADMISSION_DEFER_REASONS.has(input.reason);
    const code: RefreshAdmissionErrorCode = deferred
      ? "REFRESH_ADMISSION_DEFERRED"
      : "REFRESH_ADMISSION_DENIED";
    super(input.message ?? `Refresh admission ${deferred ? "deferred" : "denied"}: ${input.reason}`);
    this.name = "RefreshAdmissionError";
    this.code = code;
    this.reason = input.reason;
    this.deferred = deferred;
    // Application-level delayed re-enqueue may use delayMs; BullMQ attempts stay disabled.
    this.retryable = false;
    this.delayMs = input.delayMs;
  }

  toJobError(): Record<string, unknown> {
    return {
      code: this.code,
      message: this.message,
      reason: this.reason,
      retryable: false,
      providerFailure: false,
      deferred: this.deferred,
      delayMs: this.delayMs ?? null,
    };
  }
}

export function isRefreshAdmissionError(error: unknown): error is RefreshAdmissionError {
  return error instanceof RefreshAdmissionError;
}
