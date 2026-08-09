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
 * Coverage-aware hydration may stop earlier once every active dungeon has
 * {@link TARGET_ELIGIBLE_CANDIDATES_PER_DUNGEON} distinct identities.
 */
export const MAX_HYDRATION_REPORTS = 5;

/**
 * Explicit upper bound when pursuing full per-dungeon candidate coverage
 * (2 distinct eligible reportCode+fightId identities × season dungeon pool).
 * Callers that need coverage-aware early-stop should pass this (or a lower
 * override) as maxReports — never an unbounded scan.
 *
 * This is an *initial* batch budget only. Discovery must continue with
 * {@link INCREMENTAL_HYDRATION_BATCH_SIZE} batches while slots remain missing
 * and unhydrated reports remain (subject to rate admission).
 */
export const MAX_COVERAGE_AWARE_HYDRATION_REPORTS = 24;

/**
 * Incremental hydration batch size after the initial coverage-aware budget.
 * Documented policy — not a correctness ceiling. Discovery may run many batches.
 */
export const INCREMENTAL_HYDRATION_BATCH_SIZE = 6;

/** Alias for the initial coverage-aware hydration batch. */
export const INITIAL_HYDRATION_BUDGET = MAX_COVERAGE_AWARE_HYDRATION_REPORTS;

/**
 * Desired distinct *timed-eligible* candidates per active dungeon before early stop.
 * Must match scoring plan eligibility (`timed === true`); untimed fillers must not
 * satisfy this target or hydration stops before SELECTED slots can fill.
 */
export const TARGET_ELIGIBLE_CANDIDATES_PER_DUNGEON = 2;

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
