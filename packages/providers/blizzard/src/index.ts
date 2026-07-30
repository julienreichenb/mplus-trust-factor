import type { BlizzardProvider } from "@mplus/contracts";
import type { BlizzardClientOptions } from "./config.js";
import { FixtureBlizzardProvider } from "./fixture-provider.js";
import { LiveBlizzardProvider } from "./live-provider.js";
import { mapStatusToError } from "./errors.js";

export type { BlizzardClientOptions, BlizzardRegionKey, NamespaceKind } from "./config.js";
export {
  BLIZZARD_REGIONS,
  DEFAULT_TTL_SECONDS,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_MAX_ATTEMPTS,
  OAUTH_TOKEN_URL,
  SCHEMA_VERSION,
  getRegionConfig,
  namespaceFor,
  resolveRegionKey,
} from "./config.js";
export { BlizzardTokenManager } from "./token-manager.js";
export { FixtureBlizzardProvider } from "./fixture-provider.js";
export { LiveBlizzardProvider } from "./live-provider.js";
export {
  encodeCharacterPath,
  fingerprintFor,
  buildIdentityDiagnostics,
  buildObservationEnvelope,
  characterProfileContainsSeason,
  resolveCurrentSeasonIdFromIndex,
  normalizeMythicProfileIndex,
  normalizePeriod,
  sanitizeHttpsUrl,
  attachEquipmentIconUrls,
  normalizeEquipmentSnapshot,
  resolveEquippedItemLevel,
  normalizeTalentSnapshot,
  attachTalentSpellIcons,
  extractSelectedTalentsFromLoadout,
} from "./normalize.js";
export type {
  BlizzardIdentityDiagnostics,
  BlizzardPeriodDTO,
  BlizzardCurrentSeasonPeriod,
} from "./normalize.js";
export {
  mapStatusToError,
  errorReasonOf,
  redactSecrets,
  type BlizzardErrorReason,
} from "./errors.js";
export { parseRetryAfterMs, redactUrl } from "./http-client.js";
export type { BlizzardProvider };

/** Official Profile API character-media path suffix (contract-tested). */
export const CHARACTER_MEDIA_PATH_SUFFIX = "character-media";

export function createBlizzardProvider(
  mode: "fixture" | "live" = "fixture",
  options: BlizzardClientOptions = {},
): BlizzardProvider {
  if (mode === "fixture") {
    return new FixtureBlizzardProvider(options);
  }
  if (!options.clientId || !options.clientSecret) {
    throw mapStatusToError({
      statusCode: null,
      message: "PROVIDER_MODE=live requires BLIZZARD_CLIENT_ID and BLIZZARD_CLIENT_SECRET",
      reason: "CONFIGURATION_ERROR",
    });
  }
  return new LiveBlizzardProvider(options);
}
