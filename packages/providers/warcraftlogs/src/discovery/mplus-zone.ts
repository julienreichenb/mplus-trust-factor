/**
 * Current Mythic+ zone configuration for WCL zoneRankings.
 *
 * Live mode requires an explicit zone ID (constructor or WCL_MPLUS_ZONE_ID).
 * Do not silently fall back to a hardcoded season zone.
 */

export interface MplusZoneConfig {
  zoneId: number;
  /** ISO expiry for the configured zone mapping; null when unset. */
  expiresAt: string | null;
  source: "constructor" | "env" | "fixture-default";
  expired: boolean;
  warning: string | null;
}

/** Fixture-only default — never used silently in live mode. */
export const FIXTURE_MPLUS_ZONE_ID = 45;

export const MPLUS_ZONE_ENV = {
  zoneId: "WCL_MPLUS_ZONE_ID",
  expiresAt: "WCL_MPLUS_ZONE_EXPIRES_AT",
} as const;

export interface ResolveMplusZoneOptions {
  zoneId?: number;
  expiresAt?: string | null;
  env?: NodeJS.ProcessEnv;
  now?: Date;
  /** When true, allow FIXTURE_MPLUS_ZONE_ID if no explicit ID is provided. */
  allowFixtureDefault?: boolean;
}

function parsePositiveInt(value: string | undefined): number | null {
  if (value == null || value.trim() === "") return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}

function parseExpiresAt(value: string | null | undefined): string | null {
  if (value == null || value.trim() === "") return null;
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) {
    throw new Error(`Invalid ${MPLUS_ZONE_ENV.expiresAt}: expected ISO datetime, got "${value}"`);
  }
  return new Date(ms).toISOString();
}

/**
 * Resolve and validate the current M+ zone ID.
 * Throws when live mode has no explicit zone configuration.
 */
export function resolveMplusZoneConfig(options: ResolveMplusZoneOptions = {}): MplusZoneConfig {
  const env = options.env ?? process.env;
  const now = options.now ?? new Date();

  let zoneId: number | null = null;
  let source: MplusZoneConfig["source"] = "env";

  if (options.zoneId != null) {
    if (!Number.isInteger(options.zoneId) || options.zoneId <= 0) {
      throw new Error(`Invalid M+ zoneId: expected positive integer, got ${options.zoneId}`);
    }
    zoneId = options.zoneId;
    source = "constructor";
  } else {
    zoneId = parsePositiveInt(env[MPLUS_ZONE_ENV.zoneId]);
    source = "env";
  }

  if (zoneId == null) {
    if (options.allowFixtureDefault) {
      zoneId = FIXTURE_MPLUS_ZONE_ID;
      source = "fixture-default";
    } else {
      throw new Error(
        `Missing current M+ zone ID. Set ${MPLUS_ZONE_ENV.zoneId} or pass zoneId to LiveWarcraftLogsProvider. ` +
          `Do not rely on a hardcoded season default.`,
      );
    }
  }

  const expiresAt =
    options.expiresAt !== undefined
      ? parseExpiresAt(options.expiresAt)
      : parseExpiresAt(env[MPLUS_ZONE_ENV.expiresAt]);

  let expired = false;
  let warning: string | null = null;

  if (expiresAt == null && source !== "fixture-default") {
    warning =
      `${MPLUS_ZONE_ENV.expiresAt} is unset for zone ${zoneId}. ` +
      `Configure an expiry so stale season zones are alarmed before rankings drift.`;
  } else if (expiresAt != null && now.getTime() > Date.parse(expiresAt)) {
    expired = true;
    warning =
      `Configured M+ zone ${zoneId} expired at ${expiresAt}. ` +
      `Update ${MPLUS_ZONE_ENV.zoneId} / ${MPLUS_ZONE_ENV.expiresAt}; rankings may target a prior season.`;
  }

  return { zoneId, expiresAt, source, expired, warning };
}

/** Rankings are skipped when the configured zone is past expiry. */
export function shouldQueryZoneRankings(config: MplusZoneConfig): boolean {
  return !config.expired;
}
