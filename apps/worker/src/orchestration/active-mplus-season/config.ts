/**
 * WCL_MPLUS_ZONE_MODE configuration (AUTO | PINNED).
 */
export type WclMplusZoneMode = "auto" | "pinned";

export function resolveWclMplusZoneMode(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): WclMplusZoneMode {
  const raw = (env.WCL_MPLUS_ZONE_MODE ?? "auto").trim().toLowerCase();
  if (raw === "pinned") return "pinned";
  if (raw === "auto" || raw === "") return "auto";
  throw Object.assign(
    new Error(`Invalid WCL_MPLUS_ZONE_MODE="${raw}" (expected auto|pinned)`),
    { code: "WCL_MPLUS_ZONE_MODE_INVALID" },
  );
}

export function parseOptionalPositiveIntEnv(
  value: string | undefined,
): number | null {
  if (value == null || value.trim() === "") return null;
  const n = Number(value.trim());
  if (!Number.isInteger(n) || n <= 0) {
    throw Object.assign(
      new Error(`Invalid positive integer env value: "${value}"`),
      { code: "ENV_POSITIVE_INT_INVALID" },
    );
  }
  return n;
}
