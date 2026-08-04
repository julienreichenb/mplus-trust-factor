/**
 * Documented bounds for WCL public discovery and detailed analysis.
 * Keep expensive GraphQL work within a predictable per-character budget.
 */

/**
 * recentReports page size. WCL allows up to 100 — keep modest per-page cost.
 * V2 selection retains up to 10 candidates/dungeon and 80 total (see contract 03).
 */
export const MAX_RECENT_REPORTS_LIMIT = 20;

/**
 * Bounded recentReports pagination for Scoring V2 discovery.
 * Stops earlier when has_more_pages is false or candidate bounds are satisfied.
 */
export const MAX_RECENT_REPORT_PAGES = 5;

/**
 * Cap on merged public run candidates after rankings + recentReports dedupe.
 * Aligned with V2_MAX_TOTAL_CANDIDATES (80) in the evidence selection contract.
 */
export const MAX_DISCOVERY_CANDIDATES = 80;

/**
 * Max public recentReports opened for fight/masterData hydration per discovery.
 * Override via WCL_MAX_HYDRATION_REPORTS when creating the live provider.
 */
export const MAX_HYDRATION_REPORTS = 5;

/** Prefer reports within this window of an external run hint when hydrating. */
export const HYDRATION_HINT_WINDOW_MS = 6 * 60 * 60 * 1000;

/** Max Mythic+ fights kept per hydrated report. */
export const MAX_FIGHTS_PER_HYDRATED_REPORT = 8;

/** Max unique reports opened for detailed fight analysis per refresh. */
export const MAX_ANALYSIS_REPORTS = 2;

/** Max fights analyzed per refresh (latest + highest, deduped). */
export const MAX_ANALYSIS_FIGHTS = 2;

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
