/**
 * Utility publication mode gate for refresh / Trust Score.
 * Default: shadow — compute OBSERVED_CONTRIBUTION diagnostics without publishing.
 */
export type UtilityPublicationMode = "off" | "shadow" | "published";

export const UTILITY_OBSERVED_SHADOW_ANALYSIS_VERSION = "utility-observed-shadow-v1";

export function parseUtilityPublicationMode(
  raw: string | undefined | null,
): UtilityPublicationMode {
  const v = (raw ?? "shadow").trim().toLowerCase();
  if (v === "off" || v === "shadow" || v === "published") return v;
  return "shadow";
}

export function getUtilityPublicationMode(
  env: NodeJS.ProcessEnv = process.env,
): UtilityPublicationMode {
  return parseUtilityPublicationMode(env.UTILITY_PUBLICATION_MODE);
}

/**
 * Safety guard — `published` is not implemented.
 * Call before any path that would write OBSERVED_CONTRIBUTION into public Trust metrics.
 */
export function assertUtilityPublicationNotEnabled(
  mode: UtilityPublicationMode = getUtilityPublicationMode(),
): void {
  if (mode === "published") {
    throw new Error(
      "UTILITY_PUBLICATION_MODE=published is not implemented. Refusing to alter public Utility / Trust Score.",
    );
  }
}

export function isUtilityShadowMode(mode: UtilityPublicationMode = getUtilityPublicationMode()): boolean {
  return mode === "shadow";
}

export function isUtilityResearchAllowedInPublication(): boolean {
  return false;
}
