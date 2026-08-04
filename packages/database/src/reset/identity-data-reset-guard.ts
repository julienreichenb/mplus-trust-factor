/**
 * Safety gates for identity-data reset.
 *
 * Supports exactly two explicit targets — no inferred default:
 *   --target=local-development
 *   --target=deployed-test
 *
 * Production identity reset remains categorically forbidden.
 */
import {
  findMonorepoConfigRoot,
  resolveConfiguredLocalArtifactRoot,
} from "@mplus/artifact-store";
import {
  sanitizeDatabaseUrl,
  sanitizeRedisUrl,
} from "./wcl-scoring-derived-reset-guard.js";

export const IDENTITY_RESET_TARGETS = [
  "local-development",
  "deployed-test",
] as const;

export type IdentityResetTarget = (typeof IDENTITY_RESET_TARGETS)[number];

export const IDENTITY_RESET_LOCAL_CONFIRMATION_TOKEN =
  "RESET_LOCAL_IDENTITY_DATA" as const;
export const IDENTITY_RESET_DEPLOYED_TEST_CONFIRMATION_TOKEN =
  "RESET_DEPLOYED_TEST_IDENTITY_DATA" as const;

export const IDENTITY_RESET_LOCAL_DATABASE_NAME = "mplus_trust" as const;

/** Canonical deployed-test Postgres database name (infra/deploy/test/.env.example). */
export const IDENTITY_RESET_DEPLOYED_TEST_DATABASE_NAME = "mplus_trust_test" as const;

/**
 * Required operator assertion for deployed-test.
 * Matches the compose project name (infra/docker/docker-compose.test.yml).
 * Never shared with production (mplus-prod).
 */
export const IDENTITY_RESET_DEPLOYED_TEST_ENVIRONMENT_ID = "mplus-test" as const;

/** Canonical APP_ENV for the VPS deployed-test stack. */
export const IDENTITY_RESET_DEPLOYED_TEST_APP_ENV = "staging" as const;

export const IDENTITY_RESET_WRITERS_STOPPED_ENV =
  "MPLUS_DEPLOYED_TEST_WRITERS_STOPPED" as const;

export const IDENTITY_RESET_ENVIRONMENT_ID_ENV =
  "MPLUS_IDENTITY_RESET_ENVIRONMENT_ID" as const;

const ALLOWED_LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

const BLOCKED_HOST_FRAGMENTS = [
  "amazonaws",
  "azure",
  "gcp",
  "cloud",
  "railway",
  "render",
  "supabase",
  "neon.tech",
  "rds.",
];

const PRODUCTION_DB_NAMES = new Set([
  "mplus_trust_prod",
  "mplus_trust_production",
  "postgres",
]);

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type IdentityResetGuardInput = {
  target?: string | null;
  keepUserId?: string | null;
  keepBnetAccountId?: string | null;
  confirmationToken?: string | null;
  expectedDatabaseName?: string | null;
  execute?: boolean;
  databaseUrl?: string;
  redisUrl?: string;
  rawArtifactsDir?: string | null;
  configRoot?: string | null;
  appEnv?: string;
  nodeEnv?: string;
  cleanupTarget?: string;
  identityResetEnvironmentId?: string;
  writersStopped?: string;
  env?: NodeJS.ProcessEnv;
};

export type IdentityResetGuardOk = {
  ok: true;
  target: IdentityResetTarget;
  sanitizedDatabase: string;
  sanitizedRedis: string;
  artifactsDir: string;
  artifactsConfiguredDir: string;
  configRoot: string;
  artifactBackend: "local-fs";
  databaseName: string;
  databaseHost: string;
  redisHost: string;
  redisEnvSegment: string;
  keepUserId: string;
  keepBnetAccountId: string;
  confirmationToken: string;
  expectedDatabaseName: string | null;
  deployedTestClassification: string;
  writersStoppedAsserted: boolean;
};

export type IdentityResetGuardFailure = {
  ok: false;
  reason: string;
  sanitizedDatabase: string;
  sanitizedRedis: string;
  blockedConditions: string[];
};

export type IdentityResetGuardResult = IdentityResetGuardOk | IdentityResetGuardFailure;

function tryParseUrl(raw: string): URL | null {
  try {
    return new URL(raw.trim());
  } catch {
    return null;
  }
}

function isLocalHost(hostname: string): boolean {
  return ALLOWED_LOCAL_HOSTS.has(hostname.trim().toLowerCase());
}

function hostLooksBlockedRemoteFragment(hostname: string): boolean {
  const host = hostname.trim().toLowerCase();
  return BLOCKED_HOST_FRAGMENTS.some((frag) => host.includes(frag));
}

function looksProductionLike(hostname: string, database: string): boolean {
  const hay = `${hostname} ${database}`.toLowerCase();
  if (PRODUCTION_DB_NAMES.has(database.toLowerCase())) return true;
  if (database.toLowerCase().includes("prod")) return true;
  if (/\bprod\b|production|mplus-prod|mplus_prod/.test(hay)) return true;
  return false;
}

export function parsePostgresTarget(databaseUrl: string): {
  host: string;
  database: string;
} | null {
  const u = tryParseUrl(databaseUrl);
  if (!u) return null;
  const protocol = u.protocol.replace(/:$/, "").toLowerCase();
  if (protocol !== "postgresql" && protocol !== "postgres") return null;
  const database =
    decodeURIComponent(u.pathname.replace(/^\//, "").split("/")[0] ?? "") || "";
  if (!database || !u.hostname) return null;
  return { host: u.hostname, database };
}

function parseRedisTarget(redisUrl: string): { host: string } | null {
  const u = tryParseUrl(redisUrl);
  if (!u) return null;
  const protocol = u.protocol.replace(/:$/, "").toLowerCase();
  if (protocol !== "redis" && protocol !== "rediss") return null;
  if (!u.hostname) return null;
  return { host: u.hostname };
}

export function isValidUuid(value: string): boolean {
  return UUID_RE.test(value.trim());
}

export function isIdentityResetTarget(value: string): value is IdentityResetTarget {
  return (IDENTITY_RESET_TARGETS as readonly string[]).includes(value);
}

function resolveArtifacts(
  rawArtifactsDir: string | null | undefined,
  configRoot: string | null | undefined,
):
  | { ok: true; path: string; configuredDir: string; configRoot: string }
  | { ok: false; reason: string } {
  const resolved = resolveConfiguredLocalArtifactRoot({
    configuredDir: rawArtifactsDir,
    configRoot,
  });
  if (!resolved.ok) {
    return { ok: false, reason: resolved.reason };
  }
  return {
    ok: true,
    path: resolved.absolutePath,
    configuredDir: resolved.configuredDir,
    configRoot: resolved.configRoot,
  };
}

/**
 * Strict multi-target gate. Uncertain conditions fail closed.
 */
export function assertIdentityDataResetAllowed(
  input: IdentityResetGuardInput = {},
): IdentityResetGuardResult {
  const env = input.env ?? process.env;
  const databaseUrl = input.databaseUrl ?? env.DATABASE_URL ?? "";
  const redisUrl = input.redisUrl ?? env.REDIS_URL ?? "";
  const sanitizedDatabase = sanitizeDatabaseUrl(databaseUrl);
  const sanitizedRedis = sanitizeRedisUrl(redisUrl);
  const blockedConditions: string[] = [];

  const appEnvRaw = input.appEnv ?? env.APP_ENV ?? "";
  const nodeEnvRaw = input.nodeEnv ?? env.NODE_ENV ?? "";
  const appEnv = String(appEnvRaw).toLowerCase();
  const nodeEnv = String(nodeEnvRaw).toLowerCase();
  const cleanupTarget = String(
    input.cleanupTarget ?? env.MPLUS_CLEANUP_TARGET ?? "",
  ).toLowerCase();
  const environmentId = String(
    input.identityResetEnvironmentId ??
      env[IDENTITY_RESET_ENVIRONMENT_ID_ENV] ??
      "",
  ).trim();
  const writersStopped = String(
    input.writersStopped ?? env[IDENTITY_RESET_WRITERS_STOPPED_ENV] ?? "",
  )
    .trim()
    .toLowerCase();

  const targetRaw = input.target?.trim() ?? "";
  if (!targetRaw) {
    blockedConditions.push(
      "--target is mandatory (local-development | deployed-test); no default",
    );
  } else if (!isIdentityResetTarget(targetRaw)) {
    blockedConditions.push(
      `unknown --target=${JSON.stringify(targetRaw)} (allowed: local-development, deployed-test)`,
    );
  }

  const target = isIdentityResetTarget(targetRaw) ? targetRaw : null;

  const keepUserId = (input.keepUserId ?? "").trim();
  const keepBnetAccountId = (input.keepBnetAccountId ?? "").trim();
  if (!keepUserId || !isValidUuid(keepUserId)) {
    blockedConditions.push("--keep-user-id must be a valid UUID (never inferred)");
  }
  if (!keepBnetAccountId || !isValidUuid(keepBnetAccountId)) {
    blockedConditions.push(
      "--keep-bnet-account-id must be a valid UUID (never inferred)",
    );
  }

  if (appEnv === "production" || appEnv === "prod") {
    blockedConditions.push(
      `APP_ENV=${JSON.stringify(appEnvRaw)} forbids identity-data reset (production categorically refused)`,
    );
  }

  const pg = parsePostgresTarget(databaseUrl);
  if (!pg) {
    blockedConditions.push("DATABASE_URL is missing or not a valid PostgreSQL URL");
  } else if (looksProductionLike(pg.host, pg.database)) {
    blockedConditions.push(
      `production-like database target refused (host=${pg.host} database=${pg.database})`,
    );
  }

  const redis = parseRedisTarget(redisUrl);
  if (!redis) {
    blockedConditions.push("REDIS_URL is missing or not a valid redis:// URL");
  }

  const configRoot =
    input.configRoot === undefined
      ? findMonorepoConfigRoot(process.cwd())
      : input.configRoot;
  const configuredArtifacts =
    input.rawArtifactsDir === undefined
      ? env.RAW_ARTIFACTS_DIR
      : input.rawArtifactsDir;
  const artifacts = resolveArtifacts(configuredArtifacts, configRoot);

  let confirmationToken = "";
  let expectedDatabaseName: string | null = null;
  let redisEnvSegment = "development";
  let deployedTestClassification = "n/a";
  let writersStoppedAsserted = false;

  if (target === "local-development") {
    confirmationToken = IDENTITY_RESET_LOCAL_CONFIRMATION_TOKEN;
    redisEnvSegment = "development";
    deployedTestClassification = "not-applicable (local-development)";

    if (cleanupTarget === "deployed-test") {
      blockedConditions.push(
        "MPLUS_CLEANUP_TARGET=deployed-test must not be set for --target=local-development",
      );
    }
    if (appEnv !== "development") {
      blockedConditions.push(
        `APP_ENV must be exactly "development" for local-development (got ${JSON.stringify(appEnvRaw)})`,
      );
    }
    if (nodeEnv === "production") {
      blockedConditions.push(
        "NODE_ENV must not be production for --target=local-development",
      );
    }
    if (input.confirmationToken !== IDENTITY_RESET_LOCAL_CONFIRMATION_TOKEN) {
      if (input.confirmationToken === IDENTITY_RESET_DEPLOYED_TEST_CONFIRMATION_TOKEN) {
        blockedConditions.push(
          "deployed-test confirmation token refused for local-development target",
        );
      } else {
        blockedConditions.push(
          `confirmation token must be exactly ${IDENTITY_RESET_LOCAL_CONFIRMATION_TOKEN}`,
        );
      }
    }
    if (pg) {
      if (pg.database !== IDENTITY_RESET_LOCAL_DATABASE_NAME) {
        blockedConditions.push(
          `database name must be exactly "${IDENTITY_RESET_LOCAL_DATABASE_NAME}" (got "${pg.database}")`,
        );
      }
      if (!isLocalHost(pg.host)) {
        blockedConditions.push(
          `local-development refuses remote database host (got "${pg.host}")`,
        );
      }
    }
    if (redis && !isLocalHost(redis.host)) {
      blockedConditions.push(
        `local-development refuses remote Redis host (got "${redis.host}") — FLUSHALL is never used`,
      );
    }
    if (input.expectedDatabaseName) {
      blockedConditions.push(
        "--expected-database-name is only valid for --target=deployed-test",
      );
    }
  } else if (target === "deployed-test") {
    confirmationToken = IDENTITY_RESET_DEPLOYED_TEST_CONFIRMATION_TOKEN;
    redisEnvSegment = IDENTITY_RESET_DEPLOYED_TEST_APP_ENV;
    expectedDatabaseName = (input.expectedDatabaseName ?? "").trim() || null;

    if (cleanupTarget !== "deployed-test") {
      blockedConditions.push(
        "deployed-test requires MPLUS_CLEANUP_TARGET=deployed-test",
      );
    }
    if (appEnv !== IDENTITY_RESET_DEPLOYED_TEST_APP_ENV) {
      blockedConditions.push(
        `APP_ENV must be exactly "${IDENTITY_RESET_DEPLOYED_TEST_APP_ENV}" to positively identify deployed-test (got ${JSON.stringify(appEnvRaw)})`,
      );
    }
    // VPS runtime uses NODE_ENV=production with APP_ENV=staging. Refuse only when
    // APP_ENV is already rejected above; do not treat NODE_ENV alone as production identity.
    if (nodeEnv === "production" && appEnv !== IDENTITY_RESET_DEPLOYED_TEST_APP_ENV) {
      blockedConditions.push(
        "NODE_ENV=production refused without positive deployed-test APP_ENV=staging",
      );
    }
    if (environmentId !== IDENTITY_RESET_DEPLOYED_TEST_ENVIRONMENT_ID) {
      blockedConditions.push(
        `${IDENTITY_RESET_ENVIRONMENT_ID_ENV} must be exactly "${IDENTITY_RESET_DEPLOYED_TEST_ENVIRONMENT_ID}" (got ${JSON.stringify(environmentId || "")})`,
      );
    }
    if (!expectedDatabaseName) {
      blockedConditions.push(
        "--expected-database-name is required for --target=deployed-test",
      );
    } else if (pg && expectedDatabaseName !== pg.database) {
      blockedConditions.push(
        `expected database name "${expectedDatabaseName}" does not match parsed DATABASE_URL database "${pg.database}"`,
      );
    }
    if (pg && pg.database !== IDENTITY_RESET_DEPLOYED_TEST_DATABASE_NAME) {
      blockedConditions.push(
        `deployed-test database must be the canonical "${IDENTITY_RESET_DEPLOYED_TEST_DATABASE_NAME}" (got "${pg.database}") — generic remote DBs are refused`,
      );
    }
    if (pg && isLocalHost(pg.host)) {
      blockedConditions.push(
        "deployed-test target refuses loopback DATABASE_URL (use local-development for localhost mplus_trust)",
      );
    }
    if (pg && hostLooksBlockedRemoteFragment(pg.host)) {
      blockedConditions.push(
        `database host "${pg.host}" looks like a cloud/production provider hostname`,
      );
    }
    // Positive identity: compose DNS hostname "postgres" on the test stack is OK
    // only with the assertions above — never "any remote".
    if (
      pg &&
      !isLocalHost(pg.host) &&
      pg.database === IDENTITY_RESET_DEPLOYED_TEST_DATABASE_NAME &&
      appEnv === IDENTITY_RESET_DEPLOYED_TEST_APP_ENV &&
      cleanupTarget === "deployed-test" &&
      environmentId === IDENTITY_RESET_DEPLOYED_TEST_ENVIRONMENT_ID
    ) {
      deployedTestClassification = "canonical-deployed-test";
    } else {
      deployedTestClassification = "refused-or-incomplete";
      if (
        pg &&
        !isLocalHost(pg.host) &&
        !blockedConditions.some((c) => c.includes("canonical"))
      ) {
        // Ensure generic remote without positive identity never slips through.
        if (
          environmentId !== IDENTITY_RESET_DEPLOYED_TEST_ENVIRONMENT_ID ||
          appEnv !== IDENTITY_RESET_DEPLOYED_TEST_APP_ENV
        ) {
          blockedConditions.push(
            "generic remote database refused without positive deployed-test identity",
          );
        }
      }
    }

    if (input.confirmationToken !== IDENTITY_RESET_DEPLOYED_TEST_CONFIRMATION_TOKEN) {
      if (input.confirmationToken === IDENTITY_RESET_LOCAL_CONFIRMATION_TOKEN) {
        blockedConditions.push(
          "local-development confirmation token refused for deployed-test target",
        );
      } else {
        blockedConditions.push(
          `confirmation token must be exactly ${IDENTITY_RESET_DEPLOYED_TEST_CONFIRMATION_TOKEN}`,
        );
      }
    }

    writersStoppedAsserted = writersStopped === "true";
    if (input.execute && !writersStoppedAsserted) {
      blockedConditions.push(
        `execute requires ${IDENTITY_RESET_WRITERS_STOPPED_ENV}=true (API/workers stopped or scaled to zero)`,
      );
    }
  }

  if (!artifacts.ok) {
    blockedConditions.push(artifacts.reason.replace(/^Blocked:\s*/, ""));
  }

  // Deduplicate while preserving order.
  const uniqueBlocked = [...new Set(blockedConditions)];

  if (uniqueBlocked.length > 0 || !target || !pg || !redis || !artifacts.ok) {
    return {
      ok: false,
      reason: `Blocked: ${uniqueBlocked[0] ?? "identity-data reset gate failed"}`,
      sanitizedDatabase,
      sanitizedRedis,
      blockedConditions: uniqueBlocked,
    };
  }

  return {
    ok: true,
    target,
    sanitizedDatabase,
    sanitizedRedis,
    artifactsDir: artifacts.path,
    artifactsConfiguredDir: artifacts.configuredDir,
    configRoot: artifacts.configRoot,
    artifactBackend: "local-fs",
    databaseName: pg.database,
    databaseHost: pg.host,
    redisHost: redis.host,
    redisEnvSegment,
    keepUserId,
    keepBnetAccountId,
    confirmationToken,
    expectedDatabaseName,
    deployedTestClassification,
    writersStoppedAsserted,
  };
}

export function formatIdentityDataResetGuardFailure(failure: {
  reason: string;
  sanitizedDatabase: string;
  sanitizedRedis: string;
  blockedConditions: string[];
}): string {
  return [
    "IDENTITY DATA RESET GUARD — destructive command blocked.",
    failure.reason,
    `Database (sanitized): ${failure.sanitizedDatabase}`,
    `Redis (sanitized): ${failure.sanitizedRedis}`,
    "Blocked conditions:",
    ...failure.blockedConditions.map((c) => `  - ${c}`),
  ].join("\n");
}
