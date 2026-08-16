/**
 * Cleared vs retained table classification for local WCL/scoring-derived reset.
 * Audited against packages/database/prisma/schema.prisma (all @@map tables).
 *
 * Cleared = provider payloads, runs, evidence, canaries, calculated scores,
 * refresh/admission operational data, generated exports.
 * Retained = identities, catalog, static scoring config, calibration definitions.
 */

/** Every Prisma-mapped application table (excludes _prisma_migrations). */
export const ALL_PRISMA_MAPPED_TABLES = [
  "regions",
  "realms",
  "seasons",
  "dungeons",
  "season_dungeons",
  "game_classes",
  "game_specializations",
  "characters",
  "character_provider_states",
  "character_aliases",
  "battlenet_accounts",
  "verified_character_ownerships",
  "character_snapshots",
  "equipment_snapshots",
  "talent_snapshots",
  "external_requests",
  "external_payloads",
  "raw_artifacts",
  "artifact_references",
  "mythic_runs",
  "run_source_references",
  "run_participants",
  "run_analyses",
  "metric_definitions",
  "metric_observations",
  "mechanic_rules",
  "score_models",
  "score_snapshots",
  "character_published_scores",
  "dimension_scores",
  "score_analysis_batches",
  "score_analysis_batch_runs",
  "red_flag_definitions",
  "character_red_flags",
  "score_disputes",
  "ingestion_jobs",
  "users",
  "external_identities",
  "user_sessions",
  "roles",
  "permissions",
  "role_permissions",
  "user_role_assignments",
  "audit_events",
  "entitlements",
  "feature_grants",
  "addon_exports",
  "refresh_schedule_runs",
  "refresh_schedule_items",
  "refresh_admissions",
  "refresh_cost_ledger_entries",
  "character_profile_views",
  "bulk_operations",
  "bulk_operation_items",
  "calibration_cohorts",
  "calibration_cohort_members",
  "calibration_runs",
  "calibration_reports",
  "evidence_manifests",
  "evidence_manifest_slots",
  "wcl_report_revisions",
  "evidence_datasets",
  "run_fact_sets",
  "dimension_computations",
  "runtime_settings",
  "scoring_v2_evidence_exports",
  "evidence_dataset_pages",
  "wcl_run_source_digests",
  "wcl_run_participants",
  "scoring_v2_shadow_canaries",
  "wcl_run_raw",
  "character_run_digests",
  "run_ranking_facts",
  "wcl_fight_ranking_snapshots",
  "wcl_fight_ranking_entries",
  "character_scores",
  "character_performance_aggregates",
  "character_experience_evidence",
  "capability_evidence_package_records",
  "participant_scoring_digests",
  "character_boost_assessments",
] as const;

export type PrismaMappedTable = (typeof ALL_PRISMA_MAPPED_TABLES)[number];

/**
 * Provider / run / evidence / scoring / refresh derived tables to TRUNCATE.
 * Order is irrelevant — TRUNCATE … CASCADE handles FKs.
 */
export const WCL_SCORING_DERIVED_CLEAR_TABLES = [
  // Scoring V2 / WCL ownership persistence
  "scoring_v2_shadow_canaries",
  "dimension_computations",
  "run_fact_sets",
  "evidence_dataset_pages",
  "evidence_datasets",
  "evidence_manifest_slots",
  "evidence_manifests",
  "wcl_run_participants",
  "wcl_run_source_digests",
  "wcl_report_revisions",
  "scoring_v2_evidence_exports",
  // Minimal scoring cache (WclRunRaw / digests / rankings / aggregates / scores)
  "character_performance_aggregates",
  "character_experience_evidence",
  "run_ranking_facts",
  "wcl_fight_ranking_entries",
  "wcl_fight_ranking_snapshots",
  "character_run_digests",
  "wcl_run_raw",
  "character_scores",
  "character_boost_assessments",
  "capability_evidence_package_records",
  "participant_scoring_digests",
  // V1 score / analysis
  "score_analysis_batch_runs",
  "score_analysis_batches",
  "dimension_scores",
  "character_published_scores",
  "score_snapshots",
  "score_disputes",
  "character_red_flags",
  "metric_observations",
  "run_analyses",
  "run_participants",
  "run_source_references",
  "mythic_runs",
  // Provider payloads / CAS
  "artifact_references",
  "external_payloads",
  "external_requests",
  "raw_artifacts",
  // Refresh / admission / jobs
  "refresh_cost_ledger_entries",
  "refresh_admissions",
  "refresh_schedule_items",
  "refresh_schedule_runs",
  "ingestion_jobs",
  // Provider-derived character state / snapshots
  "character_provider_states",
  "character_snapshots",
  "equipment_snapshots",
  "talent_snapshots",
  "character_profile_views",
  // Generated operational / calibration execution / exports
  "bulk_operation_items",
  "bulk_operations",
  "calibration_reports",
  "calibration_runs",
  "addon_exports",
  "audit_events",
] as const;

export type WclScoringDerivedClearTable =
  (typeof WCL_SCORING_DERIVED_CLEAR_TABLES)[number];

/** Identity, catalog, and static configuration retained across reset. */
export const WCL_SCORING_DERIVED_RETAIN_TABLES = [
  "users",
  "user_sessions",
  "user_role_assignments",
  "roles",
  "permissions",
  "role_permissions",
  "external_identities",
  "battlenet_accounts",
  "verified_character_ownerships",
  "characters",
  "character_aliases",
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
  "calibration_cohorts",
  "calibration_cohort_members",
  "entitlements",
  "feature_grants",
  "runtime_settings",
] as const;

export type WclScoringDerivedRetainTable =
  (typeof WCL_SCORING_DERIVED_RETAIN_TABLES)[number];

/** Important retained tables always included in dry-run counts. */
export const WCL_SCORING_DERIVED_IMPORTANT_RETAIN_TABLES = [
  "users",
  "characters",
  "battlenet_accounts",
  "verified_character_ownerships",
  "regions",
  "realms",
  "seasons",
  "dungeons",
  "score_models",
  "calibration_cohorts",
  "calibration_cohort_members",
  "metric_definitions",
  "mechanic_rules",
  "red_flag_definitions",
] as const;

/** Redis key prefixes owned by this local project (namespace-scoped deletion). */
export const WCL_SCORING_DERIVED_REDIS_KEY_PREFIXES = [
  "mplus:development:",
  // BullMQ default prefix + project queue names (see QUEUE_NAMES).
  "bull:refresh-character",
  "bull:analyze-run",
  "bull:recalculate-score",
  "bull:finalize-score",
  "bull:generate-addon-export",
  "bull:sync-realm-catalog",
  "bull:discover-owned-characters",
  "bull:bulk-character-processing",
  "bull:calibration-run",
  "bull:analyze-evidence-slot",
  "bull:finalize-analysis-batch",
  "bull:refresh-character-calibration",
  "bull:scoring-evidence-export",
  "bull:scoring-shadow-canary",
] as const;

/**
 * Fail-closed completeness check: every mapped table must be cleared or retained.
 */
export function classifyAllPrismaMappedTables(): {
  ok: true;
} | {
  ok: false;
  unclassified: string[];
  duplicate: string[];
} {
  const clear = new Set<string>(WCL_SCORING_DERIVED_CLEAR_TABLES);
  const retain = new Set<string>(WCL_SCORING_DERIVED_RETAIN_TABLES);
  const duplicate: string[] = [];
  for (const table of clear) {
    if (retain.has(table)) duplicate.push(table);
  }
  const unclassified: string[] = [];
  for (const table of ALL_PRISMA_MAPPED_TABLES) {
    if (!clear.has(table) && !retain.has(table)) unclassified.push(table);
  }
  if (duplicate.length > 0 || unclassified.length > 0) {
    return { ok: false, unclassified, duplicate };
  }
  return { ok: true };
}

/** Newly introduced WCL ownership tables that must remain in the clear list. */
export const REQUIRED_WCL_OWNERSHIP_CLEAR_TABLES = [
  "evidence_dataset_pages",
  "wcl_run_source_digests",
  "wcl_run_participants",
  "scoring_v2_shadow_canaries",
  "wcl_report_revisions",
] as const;
