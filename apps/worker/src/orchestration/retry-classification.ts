import { ExternalApiError, type ExternalApiErrorCode } from "@mplus/contracts";
import { isRefreshContractPreflightError } from "./refresh-contract-preflight.js";
import { isRefreshEligibilityError } from "./refresh-eligibility-gate.js";

export interface RetryClassification {
  retryable: boolean;
  /** Suggested BullMQ backoff delay in milliseconds, when retryable. */
  delayMs?: number;
  /** True when the failure represents a provider soft-skip (not a real error). */
  softSkip: boolean;
  /** False for contract preflight — must not drive provider-failure backoff paths. */
  providerFailure?: boolean;
}

const CLASSIFICATION_BY_CODE: Record<ExternalApiErrorCode, RetryClassification> = {
  TIMEOUT: { retryable: true, delayMs: 5_000, softSkip: false, providerFailure: true },
  NETWORK: { retryable: true, delayMs: 5_000, softSkip: false, providerFailure: true },
  RATE_LIMITED: { retryable: true, delayMs: 30_000, softSkip: false, providerFailure: true },
  BUDGET_EXCEEDED: { retryable: true, delayMs: 60_000, softSkip: false, providerFailure: true },
  NOT_FOUND: { retryable: false, softSkip: false, providerFailure: true },
  INVALID_RESPONSE: { retryable: false, softSkip: false, providerFailure: true },
  SCHEMA_UNSUPPORTED: { retryable: false, softSkip: false, providerFailure: true },
  UNAUTHORIZED: { retryable: false, softSkip: false, providerFailure: true },
  CIRCUIT_OPEN: { retryable: false, softSkip: true, providerFailure: true },
  UNKNOWN: { retryable: false, softSkip: false, providerFailure: true },
};

/** Maps provider/job failures to a retry decision for BullMQ backoff configuration. */
export function classifyError(error: unknown): RetryClassification {
  if (isRefreshContractPreflightError(error) || isRefreshEligibilityError(error)) {
    return { retryable: false, softSkip: false, providerFailure: false };
  }
  if (error && typeof error === "object" && (error as { code?: string }).code === "CANCELLED") {
    return { retryable: false, softSkip: false, providerFailure: false };
  }
  if (error instanceof ExternalApiError) {
    return CLASSIFICATION_BY_CODE[error.code];
  }
  return { retryable: false, softSkip: false };
}

export function isSoftSkip(error: unknown): boolean {
  return classifyError(error).softSkip;
}
