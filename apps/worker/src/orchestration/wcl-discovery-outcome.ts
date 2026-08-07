/**
 * Classify WCL enrichment outcomes so empty runs from disable/failure
 * are never confused with a genuine no-public-runs character.
 */
export type WclRunDiscoveryOutcome =
  | "OK"
  | "NO_PUBLIC_RUNS"
  | "WCL_DISCOVERY_FAILED"
  | "WCL_DISABLED";

export function classifyWclRunDiscoveryOutcome(input: {
  disabled: boolean;
  threw: boolean;
  runCount: number;
  dataState?: string | null;
}): WclRunDiscoveryOutcome {
  if (input.disabled) return "WCL_DISABLED";
  if (input.threw) return "WCL_DISCOVERY_FAILED";
  if (input.runCount > 0) return "OK";
  if (
    input.dataState === "NO_PUBLIC_LOGS" ||
    input.dataState === "NO_PUBLIC_RUNS"
  ) {
    return "NO_PUBLIC_RUNS";
  }
  return "NO_PUBLIC_RUNS";
}

export function wclDiscoveryWarning(
  outcome: WclRunDiscoveryOutcome,
  detail?: string | null,
): string | null {
  switch (outcome) {
    case "WCL_DISABLED":
      return "WCL_DISABLED";
    case "WCL_DISCOVERY_FAILED":
      return detail?.trim()
        ? `WCL_DISCOVERY_FAILED:${detail.trim().slice(0, 240)}`
        : "WCL_DISCOVERY_FAILED";
    case "NO_PUBLIC_RUNS":
      return "WCL_NO_PUBLIC_RUNS";
    case "OK":
      return null;
  }
}
