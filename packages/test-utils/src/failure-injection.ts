import { ExternalApiError, type ProviderName } from "@mplus/contracts";

export type InjectedFailure =
  | "RATE_LIMITED"
  | "TIMEOUT"
  | "BUDGET_EXCEEDED"
  | "PROVIDER_DISABLED"
  | "INVALID_RESPONSE"
  | "NETWORK";

export interface FailureInjectionConfig {
  provider: ProviderName;
  failure: InjectedFailure;
  statusCode?: number;
  retryAfterSeconds?: number;
}

export function createInjectedProviderError(config: FailureInjectionConfig): ExternalApiError {
  switch (config.failure) {
    case "RATE_LIMITED":
      return new ExternalApiError({
        message: `${config.provider} rate limited (injected)`,
        code: "RATE_LIMITED",
        provider: config.provider,
        retryable: true,
        statusCode: config.statusCode ?? 429,
        details: { retryAfterSeconds: config.retryAfterSeconds ?? 60 },
      });
    case "TIMEOUT":
      return new ExternalApiError({
        message: `${config.provider} timeout (injected)`,
        code: "TIMEOUT",
        provider: config.provider,
        retryable: true,
        statusCode: null,
      });
    case "BUDGET_EXCEEDED":
      return new ExternalApiError({
        message: `${config.provider} budget exceeded (injected)`,
        code: "BUDGET_EXCEEDED",
        provider: config.provider,
        retryable: false,
        statusCode: 429,
        details: { budgetPercent: 90 },
      });
    case "PROVIDER_DISABLED":
      return new ExternalApiError({
        message: `${config.provider} disabled (injected)`,
        code: "UNKNOWN",
        provider: config.provider,
        retryable: false,
        statusCode: 503,
      });
    case "INVALID_RESPONSE":
      return new ExternalApiError({
        message: `${config.provider} invalid response (injected)`,
        code: "INVALID_RESPONSE",
        provider: config.provider,
        retryable: false,
        statusCode: 502,
      });
    case "NETWORK":
      return new ExternalApiError({
        message: `${config.provider} network error (injected)`,
        code: "NETWORK",
        provider: config.provider,
        retryable: true,
        statusCode: null,
      });
  }
}

export class RedisConnectionFailure extends Error {
  constructor(message = "Redis connection failed (injected)") {
    super(message);
    this.name = "RedisConnectionFailure";
  }
}

export class ArtifactWriteFailure extends Error {
  constructor(message = "Raw artifact write failed (injected)") {
    super(message);
    this.name = "ArtifactWriteFailure";
  }
}

export class DuplicateJobConflict extends Error {
  readonly dedupeKey: string;

  constructor(dedupeKey: string) {
    super(`Duplicate job dedupe key: ${dedupeKey}`);
    this.name = "DuplicateJobConflict";
    this.dedupeKey = dedupeKey;
  }
}

export class MigrationDryRunFailure extends Error {
  constructor(message = "Migration dry run failed (injected)") {
    super(message);
    this.name = "MigrationDryRunFailure";
  }
}

/** Simulates serving a stale score when refresh fails. */
export interface StaleScoreFallback<T> {
  stale: T;
  refreshFailed: boolean;
  servedAt: string;
}

export function serveStaleOnRefreshFailure<T>(stale: T): StaleScoreFallback<T> {
  return {
    stale,
    refreshFailed: true,
    servedAt: new Date().toISOString(),
  };
}
