/**
 * Utility publication mode gate for refresh / Trust Score.
 * Default: shadow — compute OBSERVED_CONTRIBUTION diagnostics without publishing.
 */
export type UtilityPublicationMode = "off" | "shadow" | "published";

export const UTILITY_OBSERVED_SHADOW_ANALYSIS_VERSION = "utility-observed-shadow-v1";
export const UTILITY_OBSERVED_PUBLIC_ANALYSIS_VERSION = "utility-observed-public-v1";

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
 * @deprecated Prefer evaluateUtilityPublicationEligibility. Kept for callers that
 * historically refused any published-mode path before eligibility was implemented.
 */
export function assertUtilityPublicationNotEnabled(
  mode: UtilityPublicationMode = getUtilityPublicationMode(),
): void {
  void mode;
  // Publication is gated by evaluateUtilityPublicationEligibility — no hard throw.
}

export function isUtilityShadowMode(mode: UtilityPublicationMode = getUtilityPublicationMode()): boolean {
  return mode === "shadow";
}

export function isUtilityPublishedMode(
  mode: UtilityPublicationMode = getUtilityPublicationMode(),
): boolean {
  return mode === "published";
}

export function isUtilityResearchAllowedInPublication(): boolean {
  return false;
}
