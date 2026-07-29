import type { ApiErrorEnvelope } from "@mplus/contracts";

export interface HttpErrorInput {
  statusCode: number;
  code: string;
  message: string;
  retryable?: boolean;
  details?: unknown;
}

/** Thrown by services/routes; the global error handler maps this to an `ApiErrorEnvelope`. */
export class HttpError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly retryable: boolean;
  readonly details?: unknown;

  constructor(input: HttpErrorInput) {
    super(input.message);
    this.name = "HttpError";
    this.statusCode = input.statusCode;
    this.code = input.code;
    this.retryable = input.retryable ?? false;
    this.details = input.details;
  }

  static badRequest(code: string, message: string, details?: unknown): HttpError {
    return new HttpError({ statusCode: 400, code, message, retryable: false, details });
  }

  static unauthorized(code: string, message: string): HttpError {
    return new HttpError({ statusCode: 401, code, message, retryable: false });
  }

  static forbidden(code: string, message: string, details?: unknown): HttpError {
    return new HttpError({ statusCode: 403, code, message, retryable: false, details });
  }

  static notFound(code: string, message: string, details?: unknown): HttpError {
    return new HttpError({ statusCode: 404, code, message, retryable: false, details });
  }

  static conflict(code: string, message: string, details?: unknown): HttpError {
    return new HttpError({ statusCode: 409, code, message, retryable: false, details });
  }

  static tooManyRequests(code: string, message: string, details?: unknown): HttpError {
    return new HttpError({ statusCode: 429, code, message, retryable: true, details });
  }

  static internal(message = "Internal server error"): HttpError {
    return new HttpError({ statusCode: 500, code: "INTERNAL_ERROR", message, retryable: false });
  }

  toEnvelope(requestId: string): ApiErrorEnvelope {
    return {
      error: {
        code: this.code,
        message: this.message,
        requestId,
        retryable: this.retryable,
        details: this.details,
      },
    };
  }
}

export function isHttpError(error: unknown): error is HttpError {
  return error instanceof HttpError;
}
