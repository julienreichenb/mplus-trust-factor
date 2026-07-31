/**
 * Public-facing error sanitization for account/profile DTOs.
 * Never expose contract hashes, mismatch codes, stacks, or provider diagnostics.
 */

const TECHNICAL_PATTERNS: RegExp[] = [
  /REFRESH_CONTRACT_HASH_MISMATCH/i,
  /REFRESH_CONTRACT_JOB_PUBLISH_HASH_MISMATCH/i,
  /REFRESH_CONTRACT_PREFLIGHT_MISMATCH/i,
  /REFRESH_CONTRACT_PREFLIGHT_MISSING_HASH/i,
  /SEASON_AUTHORITY_/i,
  /requested[_\s-]?hash/i,
  /computed[_\s-]?hash/i,
  /[a-f0-9]{64}/i,
  /stack\s*trace/i,
  /prisma/i,
  /bullmq/i,
  /redis/i,
  /ECONNREFUSED/i,
  /api\.blizzard\.com/i,
  /client_secret/i,
  /access_token/i,
];

export const PUBLIC_REFRESH_FAILED_MESSAGE = "La dernière actualisation a échoué.";
export const PUBLIC_GENERIC_UNAVAILABLE_MESSAGE = "Trust Score is temporarily unavailable.";
export const PUBLIC_NOT_REFRESH_ELIGIBLE_MESSAGE =
  "This character is not eligible for refresh (level or current-season Mythic+ score).";

const ELIGIBILITY_PUBLIC_CODES = new Set([
  "CHARACTER_BELOW_MAX_LEVEL",
  "CHARACTER_NO_CURRENT_SEASON_MYTHIC_SCORE",
  "CHARACTER_REFRESH_ELIGIBILITY_UNKNOWN",
  "NOT_REFRESH_ELIGIBLE",
]);

export function isTechnicalPublicErrorMessage(message: string | null | undefined): boolean {
  if (!message) return false;
  return TECHNICAL_PATTERNS.some((re) => re.test(message));
}

/** Map job error payloads to a safe public message (or null). */
export function toPublicRefreshErrorMessage(
  error: unknown,
  opts: { hasPublishedScore: boolean },
): { errorCode: string | null; errorMessage: string | null } {
  if (!error) {
    return {
      errorCode: opts.hasPublishedScore ? "REFRESH_FAILED" : "REFRESH_FAILED",
      errorMessage: opts.hasPublishedScore
        ? PUBLIC_REFRESH_FAILED_MESSAGE
        : PUBLIC_GENERIC_UNAVAILABLE_MESSAGE,
    };
  }

  const record =
    error && typeof error === "object" ? (error as { code?: unknown; message?: unknown }) : null;
  const rawCode = typeof record?.code === "string" ? record.code : null;
  const rawMessage = typeof record?.message === "string" ? record.message : null;

  if (rawCode === "CANCELLED") {
    return {
      errorCode: null,
      errorMessage: null,
    };
  }

  if (rawCode && ELIGIBILITY_PUBLIC_CODES.has(rawCode)) {
    return {
      errorCode: "NOT_REFRESH_ELIGIBLE",
      errorMessage: PUBLIC_NOT_REFRESH_ELIGIBLE_MESSAGE,
    };
  }

  if (
    (rawCode && isTechnicalPublicErrorMessage(rawCode)) ||
    (rawMessage && isTechnicalPublicErrorMessage(rawMessage))
  ) {
    return {
      errorCode: "REFRESH_FAILED",
      errorMessage: opts.hasPublishedScore
        ? PUBLIC_REFRESH_FAILED_MESSAGE
        : PUBLIC_GENERIC_UNAVAILABLE_MESSAGE,
    };
  }

  // Never forward raw Error.message — only curated generic copy.
  return {
    errorCode: "REFRESH_FAILED",
    errorMessage: opts.hasPublishedScore
      ? PUBLIC_REFRESH_FAILED_MESSAGE
      : PUBLIC_GENERIC_UNAVAILABLE_MESSAGE,
  };
}

/** Sanitize job errorMessage for public JobStatusDTO. */
export function toPublicJobErrorMessage(message: string | null): string | null {
  if (!message) return null;
  if (isTechnicalPublicErrorMessage(message)) {
    return PUBLIC_REFRESH_FAILED_MESSAGE;
  }
  // Strip anything that looks like an internal exception class dump.
  if (message.length > 160 || message.includes("\n") || message.includes(" at ")) {
    return PUBLIC_REFRESH_FAILED_MESSAGE;
  }
  return message;
}
