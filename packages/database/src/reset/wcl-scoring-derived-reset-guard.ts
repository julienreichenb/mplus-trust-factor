/**
 * Safety gates for local WCL / scoring-derived data reset.
 *
 * Target: APP_ENV=development + localhost Postgres DB named exactly mplus_trust.
 * Never allows production, staging, remote hosts, or wrong database names.
 */

export const WCL_SCORING_DERIVED_RESET_CONFIRMATION_TOKEN =
  "RESET_LOCAL_WCL_SCORING_DATA" as const;

export const WCL_SCORING_DERIVED_RESET_DATABASE_NAME = "mplus_trust" as const;

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
  rawArtifactsDir?: string;
  appEnv?: string;
  confirmationToken?: string;
};

export type WclScoringDerivedResetGuardResult =
  | {
      ok: true;
      sanitizedDatabase: string;
      sanitizedRedis: string;
      artifactsDir: string;
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
  // Fail closed on anything else — including empty, docker DNS names, LAN IPs.
  return false;
}

function hostLooksRemoteOrContainer(hostname: string): boolean {
  const host = hostname.trim().toLowerCase();
  if (!host) return true;
  if (ALLOWED_LOCAL_HOSTS.has(host)) return false;
  if (BLOCKED_HOST_FRAGMENTS.some((frag) => host.includes(frag))) return true;
  // Any non-loopback host is treated as remote/uncertain.
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
 * Resolve artifact root from config. Rejects remote object-storage schemes.
 */
export function resolveLocalArtifactsDir(rawArtifactsDir: string | undefined): {
  ok: true;
  path: string;
} | {
  ok: false;
  reason: string;
} {
  const raw = (rawArtifactsDir ?? "").trim();
  if (!raw) {
    return { ok: false, reason: "Blocked: RAW_ARTIFACTS_DIR is missing." };
  }
  const lower = raw.toLowerCase();
  if (
    lower.startsWith("s3://") ||
    lower.startsWith("gs://") ||
    lower.startsWith("az://") ||
    lower.startsWith("http://") ||
    lower.startsWith("https://") ||
    lower.startsWith("cas://")
  ) {
    return {
      ok: false,
      reason: `Blocked: RAW_ARTIFACTS_DIR looks like remote object storage (${raw}).`,
    };
  }
  // Absolute or relative local path only — caller resolves against cwd.
  return { ok: true, path: raw };
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

  const artifacts = resolveLocalArtifactsDir(
    input.rawArtifactsDir ?? process.env.RAW_ARTIFACTS_DIR,
  );
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
