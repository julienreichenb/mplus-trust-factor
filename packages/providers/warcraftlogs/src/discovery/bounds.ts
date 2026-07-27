/**
 * Documented bounds for WCL public discovery and detailed analysis.
 * Keep expensive GraphQL work within a predictable per-character budget.
 */

/** One recentReports page; WCL allows up to 100 — we stay well below. */
export const MAX_RECENT_REPORTS_LIMIT = 20;

/** Only the first page of recentReports is fetched during discovery. */
export const MAX_RECENT_REPORT_PAGES = 1;

/**
 * Cap on merged public run candidates after rankings + recentReports dedupe.
 * Excess rows are dropped (rankings preferred over recentReports stubs).
 */
export const MAX_DISCOVERY_CANDIDATES = 25;

/**
 * Max public recentReports opened for fight/masterData hydration per discovery.
 * Override via WCL_MAX_HYDRATION_REPORTS when creating the live provider.
 */
export const MAX_HYDRATION_REPORTS = 5;

/** Prefer reports within this window of an external run hint when hydrating. */
export const HYDRATION_HINT_WINDOW_MS = 6 * 60 * 60 * 1000;

/** Max Mythic+ fights kept per hydrated report. */
export const MAX_FIGHTS_PER_HYDRATED_REPORT = 8;

/**
 * Default max fights analyzed per refresh from the ScoringRunSelection set.
 * Must cover the active-season dungeon pool (currently 8), not latest+highest only.
 */
export const MAX_ANALYSIS_FIGHTS = 8;

/**
 * Default max unique reports opened for detailed fight analysis per refresh.
 * Aligned with the eight-run selection budget; still subject to hard cap.
 */
export const MAX_ANALYSIS_REPORTS = 8;

/**
 * Absolute ceiling for analysis fights/reports regardless of configuration.
 * Prevents unbounded live GraphQL spend from a misconfigured env var.
 */
export const ABSOLUTE_MAX_ANALYSIS_FIGHTS = 16;

/** Max event pages per dataType category. */
export const MAX_EVENT_PAGES = 10;

/** Max events retained per dataType category. */
export const MAX_EVENTS_PER_CATEGORY = 2000;

/** Event types fetched for MVP combat facts (Healing optional via flag). */
export const REQUIRED_EVENT_TYPES = [
  "Casts",
  "Interrupts",
  "Deaths",
  "DamageTaken",
  "Buffs",
  "Debuffs",
  "Dispels",
  "CombatantInfo",
] as const;

export const OPTIONAL_EVENT_TYPES = ["Healing"] as const;

/**
 * Resolve the effective fight-analysis budget for Scoring v3.
 * Based on selected canonical scoring runs / expected dungeon count — never "first N reports".
 */
export function resolveMaxAnalysisFights(input: {
  expectedDungeonCount: number;
  configuredMax?: number | null;
  hardCap?: number;
}): number {
  const hardCap = input.hardCap ?? ABSOLUTE_MAX_ANALYSIS_FIGHTS;
  const expected = Math.max(0, Math.floor(input.expectedDungeonCount));
  const fallback = expected > 0 ? expected : MAX_ANALYSIS_FIGHTS;
  const configured =
    input.configuredMax == null || !Number.isFinite(input.configuredMax)
      ? fallback
      : Math.floor(input.configuredMax);
  const bounded = Math.min(hardCap, Math.max(1, configured));
  // Never analyze more fights than the expected dungeon pool when that pool is known.
  if (expected > 0) return Math.min(bounded, expected);
  return bounded;
}
