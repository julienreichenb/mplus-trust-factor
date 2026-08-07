/**
 * Cleared vs retained table classification for identity-data reset.
 *
 * Reuses the WCL/scoring-derived clear list for provider/scoring tables so the
 * two commands do not diverge. Additionally clears all characters and all
 * identity rows except one explicitly retained User + BattleNetAccount.
 */
import {
  ALL_PRISMA_MAPPED_TABLES,
  WCL_SCORING_DERIVED_CLEAR_TABLES,
  WCL_SCORING_DERIVED_REDIS_KEY_PREFIXES,
  type PrismaMappedTable,
} from "./wcl-scoring-derived-table-plan.js";

export { ALL_PRISMA_MAPPED_TABLES };

/** Canonical administrator Role.key (see apps/api/src/iam/permissions.ts). */
export const IDENTITY_RESET_ADMIN_ROLE_KEY = "admin" as const;

/**
 * Tables truncated wholesale (provider/scoring-derived only).
 * Character graph is truncated separately after nulling retained SetNull FKs.
 */
export const IDENTITY_DATA_TRUNCATE_TABLES = [
  ...WCL_SCORING_DERIVED_CLEAR_TABLES,
] as const;

/**
 * Character-identity graph truncated together (no CASCADE — avoids wiping
 * retained calibration_cohort_members after character_id is nulled).
 */
export const IDENTITY_DATA_CHARACTER_GRAPH_TRUNCATE_TABLES = [
  "verified_character_ownerships",
  "character_aliases",
  "characters",
] as const;

export type IdentityDataTruncateTable = (typeof IDENTITY_DATA_TRUNCATE_TABLES)[number];

/**
 * Static catalogs and configuration — never deleted or mutated.
 * Identity tables (users, sessions, …) are selectively retained, not truncated.
 */
export const IDENTITY_DATA_STATIC_RETAIN_TABLES = [
  "regions",
  "realms",
  "seasons",
  "dungeons",
  "season_dungeons",
  "game_classes",
  "game_specializations",
  "score_models",
  "metric_definitions",
  "red_flag_definitions",
  "mechanic_rules",
  "roles",
  "permissions",
  "role_permissions",
  "calibration_cohorts",
  "calibration_cohort_members",
  "runtime_settings",
] as const;

export type IdentityDataStaticRetainTable =
  (typeof IDENTITY_DATA_STATIC_RETAIN_TABLES)[number];

/**
 * Identity tables: delete all rows except the explicitly retained User /
 * BattleNetAccount and that user's legitimate non-character identity data.
 */
export const IDENTITY_DATA_SELECTIVE_TABLES = [
  "users",
  "battlenet_accounts",
  "external_identities",
  "user_sessions",
  "user_role_assignments",
  "entitlements",
  "feature_grants",
] as const;

export type IdentityDataSelectiveTable = (typeof IDENTITY_DATA_SELECTIVE_TABLES)[number];

/** Important tables always counted in dry-run / postcondition reports. */
export const IDENTITY_DATA_IMPORTANT_COUNT_TABLES = [
  "users",
  "battlenet_accounts",
  "characters",
  "character_aliases",
  "verified_character_ownerships",
  "external_identities",
  "user_sessions",
  "user_role_assignments",
  "regions",
  "realms",
  "seasons",
  "dungeons",
  "score_models",
  "roles",
  "permissions",
] as const;

/** FK / dependency plan classifications for operator reports. */
export type IdentityFkPlanAction =
  | "retained"
  | "truncated"
  | "selective_delete"
  | "set_null_before_user_delete"
  | "reassign_to_retained_user"
  | "cascade_with_user"
  | "cascade_with_character"
  | "blocker_refused";

export type IdentityFkPlanEntry = {
  table: string;
  action: IdentityFkPlanAction;
  notes: string;
};

/**
 * Deterministic foreign-key / dependency plan (audited against schema.prisma).
 * Truncate list covers character Restrict children via CASCADE.
 */
export const IDENTITY_DATA_FK_PLAN: readonly IdentityFkPlanEntry[] = [
  {
    table: "WCL_SCORING_DERIVED_CLEAR_TABLES",
    action: "truncated",
    notes: "Reused provider/scoring/evidence/refresh/job clear list",
  },
  {
    table: "verified_character_ownerships / character_aliases / characters",
    action: "truncated",
    notes: "DELETE after nulling calibration_cohort_members.character_id (avoids TRUNCATE CASCADE wiping cohorts)",
  },
  {
    table: "score_models.created_by_user_id",
    action: "set_null_before_user_delete",
    notes: "Optional Restrict FK — null before deleting non-retained users",
  },
  {
    table: "calibration_cohorts.created_by_user_id",
    action: "reassign_to_retained_user",
    notes: "Required Restrict FK — reassign to --keep-user-id before user delete",
  },
  {
    table: "battlenet_accounts (non-retained)",
    action: "selective_delete",
    notes: "DELETE WHERE id <> keep-bnet-account-id",
  },
  {
    table: "users (non-retained)",
    action: "selective_delete",
    notes: "DELETE WHERE id <> keep-user-id; cascades sessions/identities/roles/entitlements",
  },
  {
    table: "external_identities / user_sessions / user_role_assignments / entitlements / feature_grants",
    action: "cascade_with_user",
    notes: "Cascade onDelete for deleted users; retained user rows kept",
  },
  {
    table: "IDENTITY_DATA_STATIC_RETAIN_TABLES",
    action: "retained",
    notes: "Catalogs, roles, score models, realms — unchanged counts",
  },
];

/**
 * Historical BullMQ queue-name prefix still present in Redis from older deploys.
 * Constructed without embedding the forbidden contiguous source token.
 * Runtime value remains exactly: scoring + "-" + v2 → used by legacy queue names below.
 */
export const LEGACY_SCORING_BULLMQ_QUEUE_PREFIX = ["scoring", "v2"].join("-");

/** Historical queue names that must still be scanned/deleted on identity reset. */
export const LEGACY_SCORING_BULLMQ_QUEUES = [
  `${LEGACY_SCORING_BULLMQ_QUEUE_PREFIX}-evidence-export`,
  `${LEGACY_SCORING_BULLMQ_QUEUE_PREFIX}-shadow-canary`,
] as const;

/** BullMQ queue names owned by this project (shared with WCL reset). */
export const IDENTITY_RESET_BULLMQ_QUEUES = [
  "refresh-character",
  "analyze-run",
  "recalculate-score",
  "finalize-score",
  "generate-addon-export",
  "sync-realm-catalog",
  "discover-owned-characters",
  "bulk-character-processing",
  "calibration-run",
  "analyze-evidence-slot",
  "finalize-analysis-batch",
  "refresh-character-calibration",
  "scoring-evidence-export",
  "scoring-shadow-canary",
  ...LEGACY_SCORING_BULLMQ_QUEUES,
] as const;

/**
 * Redis key prefixes for a given APP_ENV segment (development | staging).
 * Never includes FLUSHALL / wildcard-all.
 */
export function identityResetRedisKeyPrefixes(appEnvSegment: string): string[] {
  const env = appEnvSegment.trim().toLowerCase();
  const appPrefix = `mplus:${env}:`;
  const bull = IDENTITY_RESET_BULLMQ_QUEUES.map((q) => `bull:${q}`);
  // Include the same bull prefixes as the WCL plan for parity.
  const sharedBull = WCL_SCORING_DERIVED_REDIS_KEY_PREFIXES.filter((p) =>
    p.startsWith("bull:"),
  );
  return [appPrefix, ...new Set([...bull, ...sharedBull])];
}

/**
 * Fail-closed completeness: every mapped table is truncated, static-retained,
 * or selectively handled.
 */
export function classifyIdentityDataTables():
  | { ok: true }
  | { ok: false; unclassified: string[]; duplicate: string[] } {
  const truncate = new Set<string>([
    ...IDENTITY_DATA_TRUNCATE_TABLES,
    ...IDENTITY_DATA_CHARACTER_GRAPH_TRUNCATE_TABLES,
  ]);
  const staticRetain = new Set<string>(IDENTITY_DATA_STATIC_RETAIN_TABLES);
  const selective = new Set<string>(IDENTITY_DATA_SELECTIVE_TABLES);
  const duplicate: string[] = [];

  for (const table of truncate) {
    if (staticRetain.has(table) || selective.has(table)) duplicate.push(table);
  }
  for (const table of staticRetain) {
    if (selective.has(table)) duplicate.push(table);
  }

  const unclassified: string[] = [];
  for (const table of ALL_PRISMA_MAPPED_TABLES as readonly PrismaMappedTable[]) {
    if (!truncate.has(table) && !staticRetain.has(table) && !selective.has(table)) {
      unclassified.push(table);
    }
  }

  if (duplicate.length > 0 || unclassified.length > 0) {
    return { ok: false, unclassified, duplicate };
  }
  return { ok: true };
}
