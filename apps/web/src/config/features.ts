/**
 * Frontend feature flags. Defaults match apps/web/.env.example:
 * - Wowhead links: off (optional enrichment)
 * - Wowhead tooltips: off (third-party script)
 * - Character media: on (only render when a trusted https URL exists)
 */

function parseBooleanFlag(raw: string | undefined, defaultValue: boolean): boolean {
  if (raw == null || raw.trim() === "") return defaultValue;
  const normalized = raw.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return defaultValue;
}

export interface FeatureFlags {
  wowheadLinksEnabled: boolean;
  wowheadTooltipsEnabled: boolean;
  characterMediaEnabled: boolean;
}

export function resolveFeatureFlags(
  env: Partial<ImportMetaEnv> = import.meta.env,
): FeatureFlags {
  return {
    wowheadLinksEnabled: parseBooleanFlag(env.VITE_WOWHEAD_LINKS_ENABLED, false),
    wowheadTooltipsEnabled: parseBooleanFlag(env.VITE_WOWHEAD_TOOLTIPS_ENABLED, false),
    characterMediaEnabled: parseBooleanFlag(env.VITE_CHARACTER_MEDIA_ENABLED, true),
  };
}

let cached: FeatureFlags | null = null;

export function getFeatureFlags(): FeatureFlags {
  if (!cached) cached = resolveFeatureFlags();
  return cached;
}

/** Test helper — clears the singleton cache. */
export function resetFeatureFlagsCache(): void {
  cached = null;
}

export function isWowheadLinksEnabled(): boolean {
  return getFeatureFlags().wowheadLinksEnabled;
}

export function isWowheadTooltipsEnabled(): boolean {
  return getFeatureFlags().wowheadTooltipsEnabled;
}

export function isCharacterMediaEnabled(): boolean {
  return getFeatureFlags().characterMediaEnabled;
}
