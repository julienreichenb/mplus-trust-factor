/**
 * Hard safety guard for DB-backed tests.
 * Rejects execution before any Prisma write when the target is unsafe.
 *
 * Naming / marker conventions must stay aligned with
 * `tools/scripts/lib/test-db-isolation.mjs`.
 */

export const ISOLATED_TEST_DB_MARKER = "MPLUS_ISOLATED_TEST_DB";
export const DISPOSABLE_DB_PREFIX = "mplus_itest_";
export const DEV_DATABASE_NAME = "mplus_trust";

/** Explicit score-model key prefixes created by automated tests (exact allowlist). */
export const TEST_SCORE_MODEL_KEY_PREFIXES = [
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
  "v2-persist-model-",
] as const;

export const CANONICAL_SCORE_MODEL_KEYS = ["default"] as const;

const DISPOSABLE_DB_RE = /^mplus_itest_[a-z0-9]{8,24}$/;

export type ParsedDatabaseUrl = {
  protocol: string;
  host: string;
  port: string;
  database: string;
  schema: string;
};

export function isDisposableDatabaseName(name: string | null | undefined): boolean {
  if (typeof name !== "string") return false;
  return DISPOSABLE_DB_RE.test(name.trim().toLowerCase());
}

export function parseDatabaseUrl(databaseUrl: string): ParsedDatabaseUrl | null {
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
    };
  } catch {
    return null;
  }
}

export function sanitizeDatabaseUrl(databaseUrl: string): string {
  const parsed = parseDatabaseUrl(databaseUrl);
  if (!parsed) return "(unparseable DATABASE_URL)";
  return `${parsed.protocol}://${parsed.host}:${parsed.port}/${parsed.database}?schema=${parsed.schema}`;
}

function isLoopbackHost(host: string): boolean {
  const h = host.toLowerCase();
  return h === "localhost" || h === "127.0.0.1" || h === "::1";
}

function looksLikeRemoteDeployedHost(host: string): boolean {
  const h = host.toLowerCase();
  if (isLoopbackHost(h)) return false;
  if (h === "postgres" || h === "db" || h.endsWith(".local")) return false;
  return true;
}

export type GuardResult =
  | { ok: true }
  | { ok: false; reason: string; sanitized: string };

export function assertSafeTestDatabaseTarget(opts: {
  databaseUrl?: string;
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
} = {}): GuardResult {
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

export function formatGuardFailure(failure: { reason: string; sanitized: string }): string {
  return [
    "TEST DATABASE SAFETY GUARD — execution blocked before any write.",
    failure.reason,
    `Target (sanitized): ${failure.sanitized}`,
    "Safe command: pnpm test   (or pnpm test:integration / pnpm test:contract)",
    "Do not point tests at the development .env DATABASE_URL.",
  ].join("\n");
}

/** Throws if the current process env / URL is not a disposable isolated test DB. */
export function assertTestDatabaseAllowed(
  databaseUrl: string | undefined = process.env.DATABASE_URL,
  env: NodeJS.ProcessEnv = process.env,
): void {
  const result = assertSafeTestDatabaseTarget({ databaseUrl, env });
  if (!result.ok) {
    throw new Error(formatGuardFailure(result));
  }
}

export function isTestOwnedScoreModelKey(key: string): boolean {
  return TEST_SCORE_MODEL_KEY_PREFIXES.some((prefix) => key.startsWith(prefix));
}

export function isCanonicalScoreModelKey(key: string): boolean {
  return (CANONICAL_SCORE_MODEL_KEYS as readonly string[]).includes(key);
}
