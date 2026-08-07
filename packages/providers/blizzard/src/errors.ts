import { ExternalApiError, type ExternalApiErrorCode } from "@mplus/contracts";

/**
 * Provider-local reason codes. ExternalApiError.code stays within shared contracts;
 * `details.reason` carries the finer Blizzard classification.
 */
export type BlizzardErrorReason =
  | "INVALID_REQUEST"
  | "NOT_FOUND"
  | "PROFILE_UNAVAILABLE"
  | "UNAUTHORIZED_PROVIDER"
  | "RATE_LIMITED"
  | "PROVIDER_UNAVAILABLE"
  | "INVALID_PROVIDER_RESPONSE"
  | "PRIVATE_OR_RESTRICTED"
  | "TRANSIENT_NETWORK"
  | "TIMEOUT"
  | "CONFIGURATION_ERROR";

const CHARACTER_PROFILE_ENDPOINTS = new Set([
  "character.profile",
  "character.equipment",
  "character.equipment.snapshot",
  "character.specializations",
  "character.media",
  "character.achievements",
  "character.mplus.index",
  "character.mplus.season",
]);

export function mapStatusToError(input: {
  statusCode: number | null;
  message: string;
  reason?: BlizzardErrorReason;
  retryable?: boolean;
  details?: unknown;
  endpointKey?: string;
}): ExternalApiError {
  const inferredReason =
    input.reason ??
    inferReasonFromStatus(input.statusCode, input.endpointKey);
  const { code, retryable, reason } = classify(
    input.statusCode,
    inferredReason,
    input.retryable,
  );
  return new ExternalApiError({
    message: input.message,
    code,
    provider: "blizzard",
    retryable,
    statusCode: input.statusCode,
    details: {
      reason,
      ...(input.endpointKey ? { endpointKey: input.endpointKey } : {}),
      ...(typeof input.details === "object" && input.details !== null
        ? (input.details as Record<string, unknown>)
        : { raw: input.details ?? null }),
    },
  });
}

function inferReasonFromStatus(
  statusCode: number | null,
  endpointKey?: string,
): BlizzardErrorReason | undefined {
  if (statusCode === 400) return "INVALID_REQUEST";
  if (statusCode === 401) return "UNAUTHORIZED_PROVIDER";
  if (statusCode === 403) return "PRIVATE_OR_RESTRICTED";
  if (statusCode === 429) return "RATE_LIMITED";
  if (statusCode !== null && statusCode >= 500) return "PROVIDER_UNAVAILABLE";
  if (statusCode === 404) {
    // Character profile 404s are ambiguous (missing vs privacy / Share Game Data off).
    if (endpointKey && CHARACTER_PROFILE_ENDPOINTS.has(endpointKey)) {
      return "PROFILE_UNAVAILABLE";
    }
    return "NOT_FOUND";
  }
  return undefined;
}

function classify(
  statusCode: number | null,
  reason: BlizzardErrorReason | undefined,
  retryableOverride?: boolean,
): { code: ExternalApiErrorCode; retryable: boolean; reason: BlizzardErrorReason } {
  if (reason === "CONFIGURATION_ERROR") {
    return { code: "UNKNOWN", retryable: false, reason };
  }
  if (reason === "INVALID_REQUEST") {
    return { code: "INVALID_RESPONSE", retryable: false, reason };
  }
  if (reason === "INVALID_PROVIDER_RESPONSE") {
    return { code: "INVALID_RESPONSE", retryable: false, reason };
  }
  if (reason === "TIMEOUT") {
    return { code: "TIMEOUT", retryable: true, reason };
  }
  if (reason === "PROFILE_UNAVAILABLE") {
    // Shared contract has no PROFILE_UNAVAILABLE code — keep NOT_FOUND for DAG gating
    // while details.reason tells callers not to claim the character does not exist.
    return { code: "NOT_FOUND", retryable: false, reason };
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

/** Redact authorization material from arbitrary observation/log payloads. */
export function redactSecrets(value: unknown): unknown {
  if (value == null) return value;
  if (typeof value === "string") {
    if (/bearer\s+/i.test(value) || /access_token=/i.test(value)) {
      return "[REDACTED]";
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(redactSecrets);
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (/authorization|client_secret|access_token|refresh_token|password/i.test(key)) {
        out[key] = "[REDACTED]";
      } else {
        out[key] = redactSecrets(nested);
      }
    }
    return out;
  }
  return value;
}

export function errorReasonOf(error: unknown): BlizzardErrorReason | null {
  if (
    error &&
    typeof error === "object" &&
    "details" in error &&
    error.details &&
    typeof error.details === "object" &&
    "reason" in (error.details as Record<string, unknown>)
  ) {
    return String((error.details as { reason?: string }).reason) as BlizzardErrorReason;
  }
  return null;
}
