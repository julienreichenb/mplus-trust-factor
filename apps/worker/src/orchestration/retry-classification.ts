import { ExternalApiError, type ExternalApiErrorCode } from "@mplus/contracts";

export interface RetryClassification {
  retryable: boolean;
  /** Suggested BullMQ backoff delay in milliseconds, when retryable. */
  delayMs?: number;
  /** True when the failure represents a provider soft-skip (not a real error). */
  softSkip: boolean;
}

const CLASSIFICATION_BY_CODE: Record<ExternalApiErrorCode, RetryClassification> = {
  TIMEOUT: { retryable: true, delayMs: 5_000, softSkip: false },
  NETWORK: { retryable: true, delayMs: 5_000, softSkip: false },
  RATE_LIMITED: { retryable: true, delayMs: 30_000, softSkip: false },
  BUDGET_EXCEEDED: { retryable: true, delayMs: 60_000, softSkip: false },
  NOT_FOUND: { retryable: false, softSkip: false },
  INVALID_RESPONSE: { retryable: false, softSkip: false },
  UNAUTHORIZED: { retryable: false, softSkip: false },
  CIRCUIT_OPEN: { retryable: false, softSkip: true },
  UNKNOWN: { retryable: false, softSkip: false },
};

/** Maps provider/job failures to a retry decision for BullMQ backoff configuration. */
export function classifyError(error: unknown): RetryClassification {
  if (error instanceof ExternalApiError) {
    return CLASSIFICATION_BY_CODE[error.code];
  }
  return { retryable: false, softSkip: false };
}

export function isSoftSkip(error: unknown): boolean {
  return classifyError(error).softSkip;
}
