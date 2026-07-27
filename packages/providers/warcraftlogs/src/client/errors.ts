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
  const notFound = errors.some((e) => /not found|unknown character/i.test(e.message));
  return new ExternalApiError({
    message: errors.map((e) => e.message).join("; "),
    code: notFound ? "NOT_FOUND" : "INVALID_RESPONSE",
    provider: "warcraftlogs",
    retryable: false,
    details: errors,
  });
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
