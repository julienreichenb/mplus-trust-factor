/**
 * Shared helpers for disposable test-database isolation.
 * Used by the isolated test runner, cleanup scripts, and mirrored in TypeScript guards.
 *
 * Naming convention (required by the safety guard):
 *   mplus_itest_<runId>
 * where runId is [a-z0-9]{8,24}
 */

import { randomBytes } from "node:crypto";

export const ISOLATED_TEST_DB_MARKER = "MPLUS_ISOLATED_TEST_DB";
export const DISPOSABLE_DB_PREFIX = "mplus_itest_";
export const DEV_DATABASE_NAME = "mplus_trust";

/** Explicit score-model key prefixes created by automated tests (exact allowlist). */
export const TEST_SCORE_MODEL_KEY_PREFIXES = Object.freeze([
  "admin-test-",
  "life-arch-",
  "life-inv-",
  "life-act-",
  "life-race-",
  "life-bt-",
  "life-bad-",
  "life-boot-",
  "life-v6-",
  "life-del-",
  "alt-model-",
  "bulk-model-",
  "pub-cancel-model-",
]);

/** Canonical seeded score model key — never deleted by cleanup. */
export const CANONICAL_SCORE_MODEL_KEYS = Object.freeze(["default"]);

const DISPOSABLE_DB_RE = /^mplus_itest_[a-z0-9]{8,24}$/;

/**
 * @returns {string}
 */
export function createDisposableDatabaseName() {
  const runId = randomBytes(8).toString("hex"); // 16 hex chars
  return `${DISPOSABLE_DB_PREFIX}${runId}`;
}

/**
 * @param {string | null | undefined} name
 * @returns {boolean}
 */
export function isDisposableDatabaseName(name) {
  if (typeof name !== "string") return false;
  return DISPOSABLE_DB_RE.test(name.trim().toLowerCase());
}

/**
 * Parse a PostgreSQL URL without throwing on credentials.
 * @param {string} databaseUrl
 * @returns {{ protocol: string, host: string, port: string, database: string, schema: string, pathname: string } | null}
 */
export function parseDatabaseUrl(databaseUrl) {
  if (typeof databaseUrl !== "string" || !databaseUrl.trim()) return null;
  try {
    const u = new URL(databaseUrl.trim());
    const protocol = u.protocol.replace(/:$/, "").toLowerCase();
    if (protocol !== "postgresql" && protocol !== "postgres") return null;
    const database = decodeURIComponent(u.pathname.replace(/^\//, "").split("/")[0] ?? "");
    const schema = u.searchParams.get("schema") ?? "public";
    return {
      protocol,
      host: u.hostname.toLowerCase().replace(/^\[(.*)\]$/, "$1"),
      port: u.port || "5432",
      database,
      schema,
      pathname: u.pathname,
    };
  } catch {
    return null;
  }
}

/**
 * Sanitize connection details for logs/errors (never credentials).
 * @param {string} databaseUrl
 * @returns {string}
 */
export function sanitizeDatabaseUrl(databaseUrl) {
  const parsed = parseDatabaseUrl(databaseUrl);
  if (!parsed) return "(unparseable DATABASE_URL)";
  return `${parsed.protocol}://${parsed.host}:${parsed.port}/${parsed.database}?schema=${parsed.schema}`;
}

/**
 * Rewrite the database name (and optional schema) in a PostgreSQL URL.
 * Preserves credentials and other query params.
 * @param {string} databaseUrl
 * @param {string} databaseName
 * @param {string} [schema]
 * @returns {string}
 */
export function rewriteDatabaseUrl(databaseUrl, databaseName, schema = "public") {
  const u = new URL(databaseUrl.trim());
  u.pathname = `/${databaseName}`;
  u.searchParams.set("schema", schema);
  return u.toString();
}

/**
 * Admin / maintenance URL on the same server (connects to `postgres` DB).
 * @param {string} databaseUrl
 * @returns {string}
 */
export function toMaintenanceDatabaseUrl(databaseUrl) {
  return rewriteDatabaseUrl(databaseUrl, "postgres", "public");
}

/**
 * @param {string} host
 * @returns {boolean}
 */
export function isLoopbackHost(host) {
  const h = host.toLowerCase();
  return h === "localhost" || h === "127.0.0.1" || h === "::1";
}

/**
 * Heuristic: deployed / production-looking hosts (not loopback, not CI service hostname).
 * @param {string} host
 * @returns {boolean}
 */
export function looksLikeRemoteDeployedHost(host) {
  const h = host.toLowerCase();
  if (isLoopbackHost(h)) return false;
  // GitHub Actions / compose service names used in CI
  if (h === "postgres" || h === "db" || h.endsWith(".local")) return false;
  return true;
}

/**
 * @param {object} opts
 * @param {string} [opts.databaseUrl]
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} [opts.env]
 * @returns {{ ok: true } | { ok: false, reason: string, sanitized: string }}
 */
export function assertSafeTestDatabaseTarget(opts = {}) {
  const env = opts.env ?? process.env;
  const databaseUrl = opts.databaseUrl ?? env.DATABASE_URL ?? "";
  const sanitized = sanitizeDatabaseUrl(databaseUrl);
  const nodeEnv = String(env.NODE_ENV ?? "").toLowerCase();
  const appEnv = String(env.APP_ENV ?? "").toLowerCase();

  if (nodeEnv !== "test") {
    return {
      ok: false,
      reason: `Blocked: NODE_ENV must be "test" (got ${JSON.stringify(env.NODE_ENV ?? "")}).`,
      sanitized,
    };
  }

  if (appEnv === "production" || appEnv === "prod") {
    return {
      ok: false,
      reason: `Blocked: APP_ENV ${JSON.stringify(env.APP_ENV)} is not allowed for DB-backed tests.`,
      sanitized,
    };
  }

  if (String(env[ISOLATED_TEST_DB_MARKER] ?? "").toLowerCase() !== "true") {
    return {
      ok: false,
      reason:
        `Blocked: ${ISOLATED_TEST_DB_MARKER}=true is required. ` +
        `Inherited application DATABASE_URL cannot be used. Run: pnpm test`,
      sanitized,
    };
  }

  const parsed = parseDatabaseUrl(databaseUrl);
  if (!parsed) {
    return {
      ok: false,
      reason: "Blocked: DATABASE_URL is missing or not a valid PostgreSQL URL.",
      sanitized,
    };
  }

  if (parsed.database === DEV_DATABASE_NAME) {
    return {
      ok: false,
      reason:
        `Blocked: target database "${DEV_DATABASE_NAME}" is the development/shared database. ` +
        `Tests must use a disposable ${DISPOSABLE_DB_PREFIX}* database.`,
      sanitized,
    };
  }

  if (!isDisposableDatabaseName(parsed.database)) {
    return {
      ok: false,
      reason:
        `Blocked: database name "${parsed.database}" does not match disposable naming ` +
        `${DISPOSABLE_DB_PREFIX}<runId>. Run: pnpm test`,
      sanitized,
    };
  }

  // Remote hosts are allowed only when the disposable naming + marker are present
  // (e.g. CI service). Production-like APP_ENV already rejected above.
  if (looksLikeRemoteDeployedHost(parsed.host) && appEnv !== "test" && appEnv !== "ci") {
    return {
      ok: false,
      reason:
        `Blocked: remote host "${parsed.host}" without APP_ENV=test|ci. ` +
        `Deployed databases require the isolated runner with a disposable database.`,
      sanitized,
    };
  }

  return { ok: true };
}

/**
 * Format a guard failure for console / thrown Error.
 * @param {{ reason: string, sanitized: string }} failure
 * @returns {string}
 */
export function formatGuardFailure(failure) {
  return [
    "TEST DATABASE SAFETY GUARD — execution blocked before any write.",
    failure.reason,
    `Target (sanitized): ${failure.sanitized}`,
    "Safe command: pnpm test   (or pnpm test:integration / pnpm test:contract)",
    "Do not point tests at the development .env DATABASE_URL.",
  ].join("\n");
}

/**
 * Throws if the current process env / URL is not a disposable isolated test DB.
 * @param {string} [databaseUrl]
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} [env]
 */
export function assertTestDatabaseAllowed(databaseUrl = process.env.DATABASE_URL, env = process.env) {
  const result = assertSafeTestDatabaseTarget({ databaseUrl, env });
  if (!result.ok) {
    throw new Error(formatGuardFailure(result));
  }
}

/**
 * @param {string} key
 * @returns {boolean}
 */
export function isTestOwnedScoreModelKey(key) {
  if (typeof key !== "string") return false;
  return TEST_SCORE_MODEL_KEY_PREFIXES.some((prefix) => key.startsWith(prefix));
}

/**
 * @param {string} key
 * @returns {boolean}
 */
export function isCanonicalScoreModelKey(key) {
  return CANONICAL_SCORE_MODEL_KEYS.includes(key);
}
