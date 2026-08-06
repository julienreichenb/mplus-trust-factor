/**
 * Resolve the required WCL Mythic+ zone for CharacterPerformanceAggregate scoring.
 * Missing/invalid zone is application configuration failure — not player evidence absence.
 */
export class ScoringZoneConfigurationError extends Error {
  readonly code = "SCORING_ZONE_CONFIGURATION_INVALID" as const;

  constructor(message: string) {
    super(message);
    this.name = "ScoringZoneConfigurationError";
  }
}

export function requireScoringZoneId(
  zoneId: number | null | undefined,
  source = "refreshContract.zoneId",
): number {
  if (zoneId == null || typeof zoneId !== "number" || !Number.isInteger(zoneId) || zoneId <= 0) {
    throw new ScoringZoneConfigurationError(
      `Missing or invalid WCL Mythic+ zoneId for scoring (${source}=${String(zoneId)}). ` +
        `Configure WCL_MPLUS_ZONE_ID / refresh contract zone before scoreCharacter.`,
    );
  }
  return zoneId;
}

export function requirePositivePerformanceAggregateTtlSeconds(ttlSeconds: number): number {
  if (typeof ttlSeconds !== "number" || !Number.isFinite(ttlSeconds) || ttlSeconds <= 0) {
    throw new ScoringZoneConfigurationError(
      `Invalid performance aggregate TTL seconds: ${String(ttlSeconds)}`,
    );
  }
  return ttlSeconds;
}
