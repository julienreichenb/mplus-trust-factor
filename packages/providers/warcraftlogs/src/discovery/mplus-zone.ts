/**
 * Current Mythic+ zone configuration for WCL zoneRankings.
 *
 * Production zone IDs come from the effective scoring season catalog
 * (persisted Season metadata / SeasonDungeon). Never from process.env.
 * Fixture mode may use FIXTURE_MPLUS_ZONE_ID when explicitly allowed.
 */

export interface MplusZoneConfig {
  zoneId: number;
  /** ISO expiry for the configured zone mapping; null when unset. */
  expiresAt: string | null;
  source: "explicit" | "fixture-default";
  expired: boolean;
  warning: string | null;
}

/** Fixture-only default — never used silently in live mode. */
export const FIXTURE_MPLUS_ZONE_ID = 45;

/**
 * @deprecated Env zone authority removed. Kept only so stale references fail loudly in tests.
 */
export const MPLUS_ZONE_ENV = {
  zoneId: "WCL_MPLUS_ZONE_ID",
  expiresAt: "WCL_MPLUS_ZONE_EXPIRES_AT",
} as const;

export interface ResolveMplusZoneOptions {
  zoneId?: number;
  expiresAt?: string | null;
  /** Ignored — env is no longer a zone authority. Kept for call-site compatibility. */
  env?: NodeJS.ProcessEnv;
  now?: Date;
  /** When true, allow FIXTURE_MPLUS_ZONE_ID if no explicit ID is provided. */
  allowFixtureDefault?: boolean;
}

function parseExpiresAt(value: string | null | undefined): string | null {
  if (value == null || value.trim() === "") return null;
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) {
    throw new Error(`Invalid zone expiresAt: expected ISO datetime, got "${value}"`);
  }
  return new Date(ms).toISOString();
}

/**
 * Resolve and validate an M+ zone ID from an explicit argument (or fixture default).
 * Throws when live mode has no explicit zone — never reads WCL_MPLUS_ZONE_*.
 */
export function resolveMplusZoneConfig(options: ResolveMplusZoneOptions = {}): MplusZoneConfig {
  const now = options.now ?? new Date();

  let zoneId: number | null = null;
  let source: MplusZoneConfig["source"] = "explicit";

  if (options.zoneId != null) {
    if (!Number.isInteger(options.zoneId) || options.zoneId <= 0) {
      throw new Error(`Invalid M+ zoneId: expected positive integer, got ${options.zoneId}`);
    }
    zoneId = options.zoneId;
    source = "explicit";
  }

  if (zoneId == null) {
    if (options.allowFixtureDefault) {
      zoneId = FIXTURE_MPLUS_ZONE_ID;
      source = "fixture-default";
    } else {
      throw new Error(
        "Missing current M+ zone ID. Pass zoneId from the effective scoring season " +
          "persisted catalog (ProviderFetchContext.wclZoneId). Env WCL_MPLUS_ZONE_* is not authoritative.",
      );
    }
  }

  const expiresAt =
    options.expiresAt !== undefined ? parseExpiresAt(options.expiresAt) : null;

  let expired = false;
  let warning: string | null = null;

  if (expiresAt != null && now.getTime() > Date.parse(expiresAt)) {
    expired = true;
    warning =
      `Configured M+ zone ${zoneId} expired at ${expiresAt}. ` +
      `Update the effective scoring season catalog; rankings may target a prior season.`;
  }

  return { zoneId, expiresAt, source, expired, warning };
}

/** Rankings are skipped when the configured zone is past expiry. */
export function shouldQueryZoneRankings(config: MplusZoneConfig): boolean {
  return !config.expired;
}

/**
 * Require a positive WCL zone from ProviderFetchContext for this request.
 */
export function requireRequestWclZoneId(ctx: { wclZoneId?: number | null }): number {
  const zoneId = ctx.wclZoneId;
  if (zoneId == null || !Number.isInteger(zoneId) || zoneId <= 0) {
    throw new Error(
      "ProviderFetchContext.wclZoneId is required for live WCL Mythic+ queries " +
        "(derived from effective scoring season catalog)",
    );
  }
  return zoneId;
}
