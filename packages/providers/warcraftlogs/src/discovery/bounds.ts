/**
 * Documented bounds for WCL encounterRankings discovery and detailed analysis.
 * Keep expensive GraphQL work within a predictable per-character budget.
 */

/**
 * Desired distinct *timed-eligible* candidates per active dungeon for evidence selection.
 * Must match scoring plan eligibility (`timed === true`).
 */
export const TARGET_ELIGIBLE_CANDIDATES_PER_DUNGEON = 2;

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
