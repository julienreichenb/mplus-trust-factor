/**
 * Safety gates for local WCL / scoring-derived data reset.
 *
 * Target: APP_ENV=development + localhost Postgres DB named exactly mplus_trust.
 * Never allows production, staging, remote hosts, or wrong database names.
 */
import {
  findMonorepoConfigRoot,
  resolveConfiguredLocalArtifactRoot,
} from "@mplus/artifact-store";

export const WCL_SCORING_DERIVED_RESET_CONFIRMATION_TOKEN =
  "RESET_LOCAL_WCL_SCORING_DATA" as const;

export const WCL_SCORING_DERIVED_RESET_DATABASE_NAME = "mplus_trust" as const;

/** Canonical application config key for the local CAS root (see @mplus/config). */
export const WCL_SCORING_DERIVED_ARTIFACTS_CONFIG_KEY = "RAW_ARTIFACTS_DIR" as const;

const ALLOWED_LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

/** Hostnames that indicate container-network or remote DB addressing. */
const BLOCKED_HOST_FRAGMENTS = [
  "docker",
  "container",
  "amazonaws",
  "azure",
  "gcp",
  "cloud",
  "railway",
  "render",
  "supabase",
  "neon.tech",
  "rds.",
  "prod",
  "staging",
  "remote",
];

export type WclScoringDerivedResetGuardInput = {
  databaseUrl?: string;
  redisUrl?: string;
  /**
   * Explicit RAW_ARTIFACTS_DIR from application config.
   * Must be provided — no path guessing / default fallback.
   */
  rawArtifactsDir?: string | null;
  /** Repository root used to resolve relative RAW_ARTIFACTS_DIR. */
  configRoot?: string | null;
  appEnv?: string;
  confirmationToken?: string;
};

export type WclScoringDerivedResetGuardResult =
  | {
      ok: true;
      sanitizedDatabase: string;
      sanitizedRedis: string;
      /** Absolute local CAS path resolved via artifact-store config helper. */
      artifactsDir: string;
      artifactsConfiguredDir: string;
      configRoot: string;
      databaseName: string;
      databaseHost: string;
      redisHost: string;
    }
  | {
      ok: false;
      reason: string;
      sanitizedDatabase: string;
      sanitizedRedis: string;
      blockedConditions: string[];
    };

function tryParseUrl(raw: string): URL | null {
  try {
    return new URL(raw.trim());
  } catch {
    return null;
  }
}

export function sanitizeDatabaseUrl(databaseUrl: string): string {
  const u = tryParseUrl(databaseUrl);
  if (!u) return "(unparseable DATABASE_URL)";
  const db = decodeURIComponent(u.pathname.replace(/^\//, "").split("/")[0] ?? "");
  return `${u.protocol}//${u.hostname}:${u.port || "5432"}/${db}`;
}

export function sanitizeRedisUrl(redisUrl: string): string {
  const u = tryParseUrl(redisUrl);
  if (!u) return "(unparseable REDIS_URL)";
  return `${u.protocol}//${u.hostname}:${u.port || "6379"}`;
}

function isLocalHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase();
  if (ALLOWED_LOCAL_HOSTS.has(host)) return true;
  return false;
}

function hostLooksRemoteOrContainer(hostname: string): boolean {
  const host = hostname.trim().toLowerCase();
  if (!host) return true;
  if (ALLOWED_LOCAL_HOSTS.has(host)) return false;
  if (BLOCKED_HOST_FRAGMENTS.some((frag) => host.includes(frag))) return true;
  return true;
}

function parsePostgresTarget(databaseUrl: string): {
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

/**
 * Resolve artifact root via canonical @mplus/artifact-store config helper.
 * Never invents "./data/raw-artifacts".
 */
export function resolveLocalArtifactsDir(
  rawArtifactsDir: string | undefined | null,
  configRoot?: string | null,
): {
  ok: true;
  path: string;
  configuredDir: string;
  configRoot: string;
} | {
  ok: false;
  reason: string;
} {
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
 * Strict gate for local development WCL/scoring-derived cleanup.
 * Uncertain conditions fail closed.
 */
export function assertWclScoringDerivedResetAllowed(
  input: WclScoringDerivedResetGuardInput = {},
): WclScoringDerivedResetGuardResult {
  const databaseUrl = input.databaseUrl ?? process.env.DATABASE_URL ?? "";
  const redisUrl = input.redisUrl ?? process.env.REDIS_URL ?? "";
  const sanitizedDatabase = sanitizeDatabaseUrl(databaseUrl);
  const sanitizedRedis = sanitizeRedisUrl(redisUrl);
  const blockedConditions: string[] = [];
  const appEnv = String(input.appEnv ?? process.env.APP_ENV ?? "").toLowerCase();

  if (appEnv !== "development") {
    blockedConditions.push(
      `APP_ENV must be exactly "development" (got ${JSON.stringify(input.appEnv ?? process.env.APP_ENV ?? "")})`,
    );
  }

  if (input.confirmationToken !== WCL_SCORING_DERIVED_RESET_CONFIRMATION_TOKEN) {
    blockedConditions.push(
      `confirmation token must be exactly ${WCL_SCORING_DERIVED_RESET_CONFIRMATION_TOKEN}`,
    );
  }

  const pg = parsePostgresTarget(databaseUrl);
  if (!pg) {
    blockedConditions.push("DATABASE_URL is missing or not a valid PostgreSQL URL");
  } else {
    if (pg.database !== WCL_SCORING_DERIVED_RESET_DATABASE_NAME) {
      blockedConditions.push(
        `database name must be exactly "${WCL_SCORING_DERIVED_RESET_DATABASE_NAME}" (got "${pg.database}")`,
      );
    }
    if (!isLocalHost(pg.host) || hostLooksRemoteOrContainer(pg.host)) {
      blockedConditions.push(
        `database host must be localhost/127.0.0.1 (got "${pg.host}")`,
      );
    }
    if (pg.database.includes("prod") || pg.database.includes("stag")) {
      blockedConditions.push(`database name "${pg.database}" looks non-development`);
    }
  }

  const redis = parseRedisTarget(redisUrl);
  if (!redis) {
    blockedConditions.push("REDIS_URL is missing or not a valid redis:// URL");
  } else if (!isLocalHost(redis.host) || hostLooksRemoteOrContainer(redis.host)) {
    blockedConditions.push(
      `Redis host must be localhost/127.0.0.1 (got "${redis.host}") — FLUSHALL is never used`,
    );
  }

  const configRoot =
    input.configRoot === undefined
      ? findMonorepoConfigRoot(process.cwd())
      : input.configRoot;
  // Prefer explicit input; never invent a default path. Env is read only when
  // the caller did not pass the key (CLI passes process.env.RAW_ARTIFACTS_DIR).
  const configuredArtifacts =
    input.rawArtifactsDir === undefined
      ? process.env.RAW_ARTIFACTS_DIR
      : input.rawArtifactsDir;

  const artifacts = resolveLocalArtifactsDir(configuredArtifacts, configRoot);
  if (!artifacts.ok) {
    blockedConditions.push(artifacts.reason.replace(/^Blocked:\s*/, ""));
  }

  if (blockedConditions.length > 0) {
    return {
      ok: false,
      reason: `Blocked: ${blockedConditions[0]}`,
      sanitizedDatabase,
      sanitizedRedis,
      blockedConditions,
    };
  }

  return {
    ok: true,
    sanitizedDatabase,
    sanitizedRedis,
    artifactsDir: artifacts.ok ? artifacts.path : "",
    artifactsConfiguredDir: artifacts.ok ? artifacts.configuredDir : "",
    configRoot: artifacts.ok ? artifacts.configRoot : "",
    databaseName: pg!.database,
    databaseHost: pg!.host,
    redisHost: redis!.host,
  };
}

export function formatWclScoringDerivedResetGuardFailure(failure: {
  reason: string;
  sanitizedDatabase: string;
  sanitizedRedis: string;
  blockedConditions: string[];
}): string {
  return [
    "WCL SCORING-DERIVED RESET GUARD — destructive command blocked.",
    failure.reason,
    `Database (sanitized): ${failure.sanitizedDatabase}`,
    `Redis (sanitized): ${failure.sanitizedRedis}`,
    "Blocked conditions:",
    ...failure.blockedConditions.map((c) => `  - ${c}`),
  ].join("\n");
}
