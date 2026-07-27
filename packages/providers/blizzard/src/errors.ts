import { ExternalApiError, type ExternalApiErrorCode } from "@mplus/contracts";

export type BlizzardErrorReason =
  | "NOT_FOUND"
  | "UNAUTHORIZED_PROVIDER"
  | "RATE_LIMITED"
  | "PROVIDER_UNAVAILABLE"
  | "INVALID_PROVIDER_RESPONSE"
  | "PRIVATE_OR_RESTRICTED"
  | "TRANSIENT_NETWORK"
  | "CONFIGURATION_ERROR";

export function mapStatusToError(input: {
  statusCode: number | null;
  message: string;
  reason?: BlizzardErrorReason;
  retryable?: boolean;
  details?: unknown;
}): ExternalApiError {
  const { code, retryable, reason } = classify(input.statusCode, input.reason, input.retryable);
  return new ExternalApiError({
    message: input.message,
    code,
    provider: "blizzard",
    retryable,
    statusCode: input.statusCode,
    details: {
      reason,
      ...(typeof input.details === "object" && input.details !== null
        ? (input.details as Record<string, unknown>)
        : { raw: input.details ?? null }),
    },
  });
}

function classify(
  statusCode: number | null,
  reason: BlizzardErrorReason | undefined,
  retryableOverride?: boolean,
): { code: ExternalApiErrorCode; retryable: boolean; reason: BlizzardErrorReason } {
  if (reason === "CONFIGURATION_ERROR") {
    return { code: "UNKNOWN", retryable: false, reason };
  }
  if (reason === "INVALID_PROVIDER_RESPONSE") {
    return { code: "INVALID_RESPONSE", retryable: false, reason };
  }
  if (statusCode === 404 || reason === "NOT_FOUND") {
    return { code: "NOT_FOUND", retryable: false, reason: "NOT_FOUND" };
  }
  if (statusCode === 429 || reason === "RATE_LIMITED") {
    return { code: "RATE_LIMITED", retryable: true, reason: "RATE_LIMITED" };
  }
  if (statusCode === 401 || reason === "UNAUTHORIZED_PROVIDER") {
    return { code: "UNAUTHORIZED", retryable: false, reason: "UNAUTHORIZED_PROVIDER" };
  }
  if (statusCode === 403 || reason === "PRIVATE_OR_RESTRICTED") {
    return { code: "UNAUTHORIZED", retryable: false, reason: "PRIVATE_OR_RESTRICTED" };
  }
  if (statusCode !== null && statusCode >= 500) {
    return {
      code: "NETWORK",
      retryable: retryableOverride ?? true,
      reason: "PROVIDER_UNAVAILABLE",
    };
  }
  if (reason === "TRANSIENT_NETWORK") {
    return { code: "NETWORK", retryable: true, reason };
  }
  if (reason === "PROVIDER_UNAVAILABLE") {
    return { code: "NETWORK", retryable: true, reason };
  }
  return {
    code: "UNKNOWN",
    retryable: retryableOverride ?? false,
    reason: reason ?? "PROVIDER_UNAVAILABLE",
  };
}

export function safeResponseHeaders(headers: Headers): Record<string, string> {
  const allow = ["x-request-id", "blizzard-request-id", "retry-after", "etag", "last-modified", "date"];
  const out: Record<string, string> = {};
  for (const key of allow) {
    const value = headers.get(key);
    if (value) out[key] = value;
  }
  return out;
}
