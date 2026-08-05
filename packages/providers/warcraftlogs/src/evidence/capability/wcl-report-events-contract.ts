/**
 * Verified WCL ReportEvents GraphQL contract (hand-written query; no codegen SDK).
 *
 * Source of truth: packages/providers/warcraftlogs/src/operations/queries.ts
 * (OPERATIONS.ReportEvents) + call sites in wcl-run-evidence.ts.
 *
 * Do not invent variable names. Anything not listed below is unsupported by the
 * current production query document.
 */

/** Variables present on OPERATIONS.ReportEvents. */
export const VERIFIED_REPORT_EVENTS_VARIABLES = [
  "code",
  "fightIDs",
  "dataType",
  "sourceID",
  "startTime",
  "endTime",
  "limit",
  "translate",
  "useAbilityIDs",
  "useActorIDs",
  "includeResources",
  "filterExpression",
  "hostilityType",
] as const;

export type VerifiedReportEventsVariable =
  (typeof VERIFIED_REPORT_EVENTS_VARIABLES)[number];

/**
 * Filter / scoping capabilities verified against the existing query document.
 * filterExpression uses WCL pin/query language (ability.id, source.id, target.id,
 * IN lists, AND/OR). GraphQL does not expose dedicated abilityIDs / targetID args.
 */
export const VERIFIED_WCL_FILTER_CONTRACT = {
  friendlyPlayerFiltering: {
    supported: true,
    mechanism: "filterExpression with source.id / target.id IN (...)",
    graphqlSourceID: "optional single actor; prefer filterExpression for multi-actor",
  },
  sourceActorFiltering: {
    supported: true,
    mechanisms: ["sourceID GraphQL variable (single Int)", "filterExpression source.id"],
    multipleActors: "filterExpression only (source.id IN (...))",
  },
  targetActorFiltering: {
    supported: true,
    mechanisms: ["filterExpression target.id / target.id IN (...)"],
    graphqlTargetID: false,
  },
  abilitySpellIdFiltering: {
    supported: true,
    mechanisms: ["filterExpression ability.id / ability.id IN (...)"],
    graphqlAbilityID: false,
  },
  filterExpressions: {
    supported: true,
    variable: "filterExpression",
  },
  logicalCombinations: {
    supported: true,
    operators: ["AND", "OR", "IN", "NOT IN", "=", "!="],
    note: "Documented by WCL pin language / Archon expression examples; HostileCasts already uses OR of type literals.",
  },
  multipleActorIds: {
    supported: true,
    mechanism:
      "filterExpression IN lists for Casts/Buffs ability filters; DamageTaken requires GraphQL sourceID batches (filterExpression actor IN verified empty)",
  },
  multipleAbilityIds: {
    supported: true,
    mechanism: "filterExpression ability.id IN (...); batch when expression length exceeds plan limit",
  },
  abilityAndActorCombinedFilter: {
    supported: false,
    verified: "ability.id AND (source.id|target.id) returns empty Buffs on live fight 1WKcCz2BnAQmbhfq:1",
    mitigation: "ability-only filterExpression + client-side friendly actor retention",
  },
  damageTakenMultiActorFilterExpression: {
    supported: false,
    verified: "source.id/target.id filterExpression on DamageTaken returns empty; GraphQL sourceID works",
    mitigation: "deterministic per-player sourceID batches in one shared job (N≤5)",
  },
  hostilityType: {
    supported: true,
    values: ["Friendlies", "Enemies"],
  },
  includeResources: {
    supported: true,
    datasets: ["DamageTaken", "Healing", "Deaths"],
  },
} as const;

/** Conservative max characters for one filterExpression (batch when exceeded). */
export const FILTER_EXPRESSION_MAX_CHARS = 3500;

/** Conservative max ability IDs per IN-list batch. */
export const FILTER_ABILITY_ID_BATCH_SIZE = 80;

/** Conservative max actor IDs per IN-list (party + pets usually fits in one). */
export const FILTER_ACTOR_ID_BATCH_SIZE = 40;
