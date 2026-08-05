/**
 * Resolve the Mythic+ WCL zone for Scoring V2 canary commands.
 *
 * Authoritative source: WCL_MPLUS_ZONE_ID (same as live rankings / discovery).
 * --zone-id is an optional operator/test override that must match unless an
 * explicit test-only conflict policy is enabled.
 */
import {
  MPLUS_ZONE_ENV,
  resolveMplusZoneConfig,
} from "@mplus/provider-warcraftlogs";

export type CanaryZoneSource = "env" | "cli-matching" | "cli-override";

export interface ResolveCanaryZoneIdInput {
  /** Parsed --zone-id when supplied; null/undefined when omitted. */
  cliZoneId?: number | null;
  env?: NodeJS.ProcessEnv;
  /**
   * Test-only: allow --zone-id to diverge from WCL_MPLUS_ZONE_ID.
   * Production/operator canaries must leave this false.
   */
  allowConflictingZoneOverride?: boolean;
  log?: (message: string) => void;
}

export interface ResolvedCanaryZone {
  zoneId: number;
  envZoneId: number;
  source: CanaryZoneSource;
  overrideActive: boolean;
}

function assertPositiveZoneId(value: number, label: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw Object.assign(
      new Error(`${label}: expected positive integer, got ${value}`),
      { code: "CANARY_ZONE_ID_INVALID" },
    );
  }
  return value;
}

/**
 * Fail closed when WCL_MPLUS_ZONE_ID is absent or not a positive integer.
 * Does not allow fixture-season defaults.
 */
export function requireConfiguredMplusZoneId(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const raw = env[MPLUS_ZONE_ENV.zoneId];
  if (raw == null || String(raw).trim() === "") {
    throw Object.assign(
      new Error(
        `Missing ${MPLUS_ZONE_ENV.zoneId}. Canary commands require the active Mythic+ WCL zone from validated application configuration.`,
      ),
      { code: "CANARY_ZONE_ID_MISSING" },
    );
  }
  const trimmed = String(raw).trim();
  const n = Number(trimmed);
  if (!Number.isInteger(n) || n <= 0) {
    throw Object.assign(
      new Error(
        `Invalid ${MPLUS_ZONE_ENV.zoneId}: expected positive integer, got "${trimmed}"`,
      ),
      { code: "CANARY_ZONE_ID_INVALID" },
    );
  }
  // Cross-check the shared resolver (same path as discovery / rankings).
  const resolved = resolveMplusZoneConfig({
    env,
    allowFixtureDefault: false,
  });
  if (resolved.zoneId !== n) {
    throw Object.assign(
      new Error(
        `${MPLUS_ZONE_ENV.zoneId} resolver mismatch: env=${n} resolved=${resolved.zoneId}`,
      ),
      { code: "CANARY_ZONE_ID_INVALID" },
    );
  }
  return resolved.zoneId;
}

export function parseOptionalCliZoneId(raw: string): number {
  const trimmed = raw.trim();
  const n = Number(trimmed);
  if (!Number.isInteger(n) || n <= 0) {
    throw Object.assign(
      new Error(`Invalid --zone-id: expected positive integer, got "${raw}"`),
      { code: "CANARY_ZONE_ID_INVALID" },
    );
  }
  return n;
}

/**
 * Resolve the zoneId used by preflight, discovery, manifest, and live canary.
 */
export function resolveCanaryZoneId(
  input: ResolveCanaryZoneIdInput = {},
): ResolvedCanaryZone {
  const env = input.env ?? process.env;
  const envZoneId = requireConfiguredMplusZoneId(env);
  const log = input.log ?? (() => undefined);

  if (input.cliZoneId == null) {
    return {
      zoneId: envZoneId,
      envZoneId,
      source: "env",
      overrideActive: false,
    };
  }

  const cliZoneId = assertPositiveZoneId(input.cliZoneId, "--zone-id");
  const overrideActive = true;

  if (cliZoneId === envZoneId) {
    log(
      `Canary --zone-id=${cliZoneId} override present; matches ${MPLUS_ZONE_ENV.zoneId}=${envZoneId}.`,
    );
    return {
      zoneId: envZoneId,
      envZoneId,
      source: "cli-matching",
      overrideActive,
    };
  }

  if (!input.allowConflictingZoneOverride) {
    throw Object.assign(
      new Error(
        `Canary --zone-id=${cliZoneId} conflicts with ${MPLUS_ZONE_ENV.zoneId}=${envZoneId}. ` +
          `Omit --zone-id to use the configured zone, or pass a matching value. ` +
          `Conflicting overrides require the test-only --allow-zone-id-override flag.`,
      ),
      { code: "CANARY_ZONE_ID_CONFLICT" },
    );
  }

  log(
    `Canary TEST OVERRIDE active: --zone-id=${cliZoneId} overrides ${MPLUS_ZONE_ENV.zoneId}=${envZoneId}.`,
  );
  return {
    zoneId: cliZoneId,
    envZoneId,
    source: "cli-override",
    overrideActive,
  };
}

/** Season identity aligned with live WCL zone rankings / discovery. */
export function canarySeasonIdForZone(zoneId: number): string {
  return `wcl-zone-${assertPositiveZoneId(zoneId, "zoneId")}`;
}
