/**
 * Explicit portable provider-data corpus allowlist / denylist.
 * Export only these tables — never dump the whole schema.
 */

export const PROVIDER_DATA_SCHEMA_VERSION = 1 as const;

/** Tables included in the portable JSON payload, in FK-safe import order. */
export const PROVIDER_DATA_EXPORT_TABLES = [
  "regions",
  "realms",
  "game_classes",
  "game_specializations",
  "seasons",
  "dungeons",
  "season_dungeons",
  "score_models",
  "red_flag_definitions",
  "characters",
  "character_aliases",
  "character_provider_states",
  "season_median_key_distribution_snapshots",
  "season_score_context_revisions",
  "score_context_revision_region_snapshots",
  "wcl_run_raw",
  "character_run_digests",
  "run_ranking_facts",
  "wcl_fight_ranking_snapshots",
  "wcl_fight_ranking_entries",
  "character_performance_aggregates",
  "character_experience_evidence",
  "character_scores",
  "score_snapshots",
  "dimension_scores",
  "character_published_scores",
  "character_red_flags",
] as const;

export type ProviderDataExportTable = (typeof PROVIDER_DATA_EXPORT_TABLES)[number];

/** Sensitive / operational tables that must never appear in a bundle. */
export const PROVIDER_DATA_DENYLIST_TABLES = [
  "users",
  "user_sessions",
  "external_identities",
  "battle_net_accounts",
  "roles",
  "permissions",
  "role_permissions",
  "user_role_assignments",
  "entitlements",
  "feature_grants",
  "verified_character_ownerships",
  "audit_events",
  "runtime_settings",
  "ingestion_jobs",
  "refresh_admissions",
  "refresh_schedule_runs",
  "refresh_schedule_items",
  "refresh_cost_ledger_entries",
  "bulk_operations",
  "bulk_operation_items",
  "scoring_shadow_canaries",
  "score_disputes",
  "character_profile_views",
  "calibration_cohorts",
  "calibration_cohort_members",
  "calibration_runs",
  "calibration_reports",
  "scoring_evidence_exports",
  "provider_data_imports",
] as const;

export type ProviderDataDenylistTable = (typeof PROVIDER_DATA_DENYLIST_TABLES)[number];
