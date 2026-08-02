import { createHash, timingSafeEqual } from "node:crypto";

const DEFAULT_ALLOWED_PROVIDER_HOSTS = [
  "eu.api.blizzard.com",
  "us.api.blizzard.com",
  "kr.api.blizzard.com",
  "tw.api.blizzard.com",
  "oauth.battle.net",
  "www.warcraftlogs.com",
  "raider.io",
] as const;

const SENSITIVE_KEY =
  /secret|password|token|authorization|cookie|api[_-]?key|client[_-]?id|client[_-]?secret|session|database_url|redis_url|connectionstring/i;

const REPORT_CODE_KEY = /^(reportcode|report_code)$/i;

/** Raw character / player display names must never appear in logs. */
const CHARACTER_NAME_KEY =
  /^(charactername|character_name|playername|player_name|battletag|battle_tag)$/i;

const BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9\-._~+/]+=*/gi;

const URL_IN_TEXT = /https?:\/\/[^\s"'<>]+/gi;

const CREDENTIAL_ASSIGNMENT =
  /\b(access_token|refresh_token|client_secret|client_id|api[_-]?key|password|authorization)\s*[=:]\s*[^\s&]+/gi;

/** Operational tokens that must not be mistaken for report codes in free text. */
const OPERATIONAL_TOKEN =
  /^(CANCELLED|SUPERSEDED|FAILED|SUCCEEDED|PARTIAL|UNAVAILABLE|TIMEOUT|RATE_LIMITED|BUDGET_EXCEEDED|SCHEMA_UNSUPPORTED|NETWORK|ACQUISITION_FAILED|HARD_PROVIDER_ERROR|SLOT_PLAN_MISSING|SLOT_ACQUISITION_FAILED|MISSING_NO_CANDIDATE)$/i;

export function constantTimeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function isAllowedProviderHost(
  urlString: string,
  allowedHosts: readonly string[] = DEFAULT_ALLOWED_PROVIDER_HOSTS,
): boolean {
  try {
    const url = new URL(urlString);
    if (url.protocol !== "https:") return false;
    return allowedHosts.some(
      (host) => url.hostname === host || url.hostname.endsWith(`.${host}`),
    );
  } catch {
    return false;
  }
}

export function assertAllowedProviderUrl(urlString: string): void {
  if (!isAllowedProviderHost(urlString)) {
    throw new Error(`Provider URL host is not allowlisted: ${urlString}`);
  }
}

/** Short stable fingerprint safe for logs/metrics (never reverseable to the original). */
export function fingerprintIdentifier(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex").slice(0, 12);
}

/** Mask report codes: keep short prefix/suffix only. */
export function maskReportCode(code: string): string {
  if (code.length <= 6) return `${code.slice(0, 2)}****`;
  return `${code.slice(0, 4)}****${code.slice(-4)}`;
}

export function sanitizeReportRef(code: string): { fingerprint: string; maskedCode: string } {
  return {
    fingerprint: fingerprintIdentifier(code),
    maskedCode: maskReportCode(code),
  };
}

/** Fingerprint a character/player display name for safe logging. */
export function sanitizeCharacterRef(name: string): { fingerprint: string; redacted: true } {
  return {
    fingerprint: fingerprintIdentifier(name.trim().toLowerCase()),
    redacted: true,
  };
}

/**
 * Shallow redaction of credential-like keys (legacy helper; prefer `sanitizeSensitiveDeep`).
 */
export function redactSecretsInObject<T extends Record<string, unknown>>(obj: T): T {
  const result = { ...obj };
  for (const key of Object.keys(result)) {
    if (SENSITIVE_KEY.test(key) || REPORT_CODE_KEY.test(key)) {
      (result as Record<string, unknown>)[key] = "[Redacted]";
    }
  }
  return result;
}

function sanitizeStringValue(value: string): string {
  return value.replace(BEARER_PATTERN, "Bearer [Redacted]");
}

/**
 * Redact URLs, credential assignments, bearer tokens, and likely report-code
 * tokens from free-form error / reason strings. Truncates to `maxLen`.
 */
export function sanitizeFreeText(value: string, maxLen = 128): string {
  let out = sanitizeStringValue(value);
  out = out.replace(URL_IN_TEXT, "[URL_REDACTED]");
  out = out.replace(CREDENTIAL_ASSIGNMENT, "$1=[Redacted]");
  out = out.replace(/\b[A-Za-z0-9]{12,32}\b/g, (token) => {
    if (OPERATIONAL_TOKEN.test(token)) return token;
    // Prefer masking over full redaction so ops can still correlate length/shape.
    return maskReportCode(token);
  });
  if (out.length > maxLen) {
    return `${out.slice(0, maxLen)}…`;
  }
  return out;
}

/** Bounded operational error fields safe for logs/events (never raw provider messages). */
export function normalizeOperationalError(error: unknown): {
  category: string;
  detail: string;
} {
  if (error instanceof Error) {
    const code =
      "code" in error && typeof (error as { code?: unknown }).code === "string"
        ? (error as { code: string }).code
        : null;
    const category = (code ?? error.name ?? "ERROR").slice(0, 64);
    return {
      category,
      detail: sanitizeFreeText(error.message || category, 128),
    };
  }
  if (typeof error === "string" && error.length > 0) {
    return {
      category: "STRING_ERROR",
      detail: sanitizeFreeText(error, 128),
    };
  }
  return { category: "UNKNOWN", detail: "non_error_thrown" };
}

/**
 * Deep sanitizer for logs, job results, and public error details.
 * Redacts OAuth/credentials and replaces report codes with fingerprints.
 */
export function sanitizeSensitiveDeep(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value == null) return value;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "string") return sanitizeStringValue(value);
  if (typeof value !== "object") return value;
  if (seen.has(value as object)) return "[Circular]";
  seen.add(value as object);

  if (value instanceof Error) {
    const normalized = normalizeOperationalError(value);
    return {
      name: value.name.slice(0, 64),
      category: normalized.category,
      message: normalized.detail,
      ...("code" in value && typeof (value as { code?: unknown }).code === "string"
        ? { code: String((value as { code: string }).code).slice(0, 64) }
        : {}),
      ...(value.cause != null ? { cause: sanitizeSensitiveDeep(value.cause, seen) } : {}),
    };
  }

  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeSensitiveDeep(entry, seen));
  }

  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_KEY.test(key)) {
      out[key] = "[Redacted]";
      continue;
    }
    if (REPORT_CODE_KEY.test(key) && typeof entry === "string" && entry.length > 0) {
      const ref = sanitizeReportRef(entry);
      out[key] = ref.maskedCode;
      out[`${key}Fingerprint`] = ref.fingerprint;
      continue;
    }
    if (CHARACTER_NAME_KEY.test(key) && typeof entry === "string" && entry.length > 0) {
      const ref = sanitizeCharacterRef(entry);
      out[key] = "[Redacted]";
      out[`${key}Fingerprint`] = ref.fingerprint;
      continue;
    }
    // Bare `name` next to realm identifiers is treated as a character name.
    if (
      /^name$/i.test(key) &&
      typeof entry === "string" &&
      entry.length > 0 &&
      ("realm" in (value as object) ||
        "realmSlug" in (value as object) ||
        "region" in (value as object) ||
        "characterId" in (value as object))
    ) {
      const ref = sanitizeCharacterRef(entry);
      out[key] = "[Redacted]";
      out[`${key}Fingerprint`] = ref.fingerprint;
      continue;
    }
    // WCL GraphQL variables use `{ code, fightIDs }` — treat as report code when co-located.
    if (
      /^code$/i.test(key) &&
      typeof entry === "string" &&
      /^[A-Za-z0-9]{8,32}$/.test(entry) &&
      ("fightIDs" in (value as object) ||
        "fightId" in (value as object) ||
        "reportCode" in (value as object))
    ) {
      const ref = sanitizeReportRef(entry);
      out[key] = ref.maskedCode;
      out[`${key}Fingerprint`] = ref.fingerprint;
      continue;
    }
    // Free-text operational fields may embed URLs, tokens, or report codes.
    if (
      /^(reason|message|detail|error|description|note|terminalreason|rejectiondetail)$/i.test(
        key,
      ) &&
      typeof entry === "string"
    ) {
      out[key] = sanitizeFreeText(entry, 256);
      continue;
    }
    out[key] = sanitizeSensitiveDeep(entry, seen);
  }
  return out;
}

/** JSON-safe clone: BigInt → string, then deep secret/report-code sanitization. */
export function toJsonSafeSanitized(value: unknown): unknown {
  const jsonSafe = JSON.parse(
    JSON.stringify(value, (_key, current) =>
      typeof current === "bigint" ? current.toString() : current,
    ),
  );
  return sanitizeSensitiveDeep(jsonSafe);
}

export { DEFAULT_ALLOWED_PROVIDER_HOSTS };
