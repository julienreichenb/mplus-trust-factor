import { ExternalApiError, type ExternalApiErrorCode } from "@mplus/contracts";

export function mapHttpStatusToError(status: number, body: unknown): ExternalApiError {
  if (status === 401 || status === 403) {
    return new ExternalApiError({
      message: "Warcraft Logs authentication failed",
      code: "UNAUTHORIZED",
      provider: "warcraftlogs",
      retryable: false,
      statusCode: status,
      details: body,
    });
  }
  if (status === 404) {
    return new ExternalApiError({
      message: "Warcraft Logs resource not found",
      code: "NOT_FOUND",
      provider: "warcraftlogs",
      retryable: false,
      statusCode: status,
      details: body,
    });
  }
  if (status === 429) {
    return new ExternalApiError({
      message: "Warcraft Logs rate limit exceeded",
      code: "RATE_LIMITED",
      provider: "warcraftlogs",
      retryable: true,
      statusCode: status,
      details: body,
    });
  }
  if (status >= 500) {
    return new ExternalApiError({
      message: `Warcraft Logs server error (${status})`,
      code: "NETWORK",
      provider: "warcraftlogs",
      retryable: true,
      statusCode: status,
      details: body,
    });
  }
  return new ExternalApiError({
    message: `Warcraft Logs HTTP error (${status})`,
    code: "INVALID_RESPONSE",
    provider: "warcraftlogs",
    retryable: false,
    statusCode: status,
    details: body,
  });
}

export function mapGraphQlErrors(errors: Array<{ message: string; extensions?: unknown }>): ExternalApiError {
  const joined = errors.map((e) => e.message).join("; ");
  const notFound = errors.some((e) => /not found|unknown character/i.test(e.message));
  const rateLimited = errors.some((e) => /rate.?limit|too many points|points remaining/i.test(e.message));
  const archived = errors.some((e) =>
    /archiv|unavailable|access denied|not available|subscription/i.test(e.message),
  );

  let code: ExternalApiErrorCode = "INVALID_RESPONSE";
  if (notFound) code = "NOT_FOUND";
  else if (rateLimited) code = "RATE_LIMITED";
  else if (archived) code = "INVALID_RESPONSE"; // classified as UNAVAILABLE by callers via isUnavailableEvidenceError

  return new ExternalApiError({
    message: joined,
    code,
    provider: "warcraftlogs",
    retryable: rateLimited,
    details: { errors, unavailableEvidence: archived },
  });
}

/** Archived / subscription-gated report detail — evidence unavailable, not player fault. */
export function isUnavailableEvidenceError(error: unknown): boolean {
  if (!(error instanceof ExternalApiError)) {
    return false;
  }
  if (error.provider !== "warcraftlogs") {
    return false;
  }
  const details = error.details as { unavailableEvidence?: boolean } | null;
  if (details?.unavailableEvidence) return true;
  return /archiv|unavailable|access denied|not available|subscription/i.test(error.message);
}

export function wclError(code: ExternalApiErrorCode, message: string, details?: unknown): ExternalApiError {
  return new ExternalApiError({
    message,
    code,
    provider: "warcraftlogs",
    retryable: code === "RATE_LIMITED" || code === "NETWORK" || code === "TIMEOUT",
    details,
  });
}
