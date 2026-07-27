-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Provider" AS ENUM ('BLIZZARD', 'WARCRAFT_LOGS', 'RAIDER_IO');

-- CreateEnum
CREATE TYPE "CharacterRole" AS ENUM ('DPS', 'TANK', 'HEALER');

-- CreateEnum
CREATE TYPE "AccountLinkConfidence" AS ENUM ('CONFIRMED', 'PROBABLE');

-- CreateEnum
CREATE TYPE "ArtifactCompression" AS ENUM ('NONE', 'GZIP', 'ZSTD');

-- CreateEnum
CREATE TYPE "ScoreDimension" AS ENUM ('PERFORMANCE', 'SURVIVAL', 'UTILITY', 'EXPERIENCE', 'RAID', 'AUTHENTICITY');

-- CreateEnum
CREATE TYPE "MetricDirection" AS ENUM ('HIGHER_BETTER', 'LOWER_BETTER', 'CONTEXTUAL');

-- CreateEnum
CREATE TYPE "ScopeType" AS ENUM ('CHARACTER', 'ROLE', 'CLASS', 'SPEC', 'ACCOUNT');

-- CreateEnum
CREATE TYPE "MechanicRuleType" AS ENUM ('AVOIDABLE_DAMAGE', 'MANDATORY_DAMAGE', 'PRIORITY_INTERRUPT', 'CROWD_CONTROL', 'DISPEL', 'PURGE', 'DEFENSIVE_WINDOW', 'EXTERNAL_WINDOW');

-- CreateEnum
CREATE TYPE "ScoreModelStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "RedFlagSeverity" AS ENUM ('INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "RedFlagStatus" AS ENUM ('ACTIVE', 'CLEARED', 'DISPUTED');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('QUEUED', 'ACTIVE', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('USER', 'ADMIN');

-- CreateEnum
CREATE TYPE "AddonExportStatus" AS ENUM ('PENDING', 'READY', 'FAILED');

-- CreateTable
CREATE TABLE "regions" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "api_host" TEXT NOT NULL,
    "locale_default" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "regions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "realms" (
    "id" UUID NOT NULL,
    "region_id" UUID NOT NULL,
    "blizzard_realm_id" BIGINT,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "connected_realm_id" BIGINT,
    "locale" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "realms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seasons" (
    "id" UUID NOT NULL,
    "region_id" UUID,
    "blizzard_season_id" INTEGER,
    "provider_season_id" TEXT,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "starts_at" TIMESTAMPTZ(3),
    "ends_at" TIMESTAMPTZ(3),
    "is_current" BOOLEAN NOT NULL DEFAULT false,
    "dungeon_count" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "seasons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dungeons" (
    "id" UUID NOT NULL,
    "blizzard_dungeon_id" BIGINT,
    "wcl_zone_or_encounter_id" BIGINT,
    "raiderio_slug" TEXT,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "map_id" INTEGER,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "dungeons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "season_dungeons" (
    "season_id" UUID NOT NULL,
    "dungeon_id" UUID NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "timer_seconds" INTEGER,
    "baseline_key_level" INTEGER NOT NULL DEFAULT 10,
    "metadata" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "season_dungeons_pkey" PRIMARY KEY ("season_id","dungeon_id")
);

-- CreateTable
CREATE TABLE "game_classes" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "provider_ids" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "game_classes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "game_specializations" (
    "id" UUID NOT NULL,
    "class_id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "CharacterRole" NOT NULL,
    "provider_ids" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "game_specializations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "characters" (
    "id" UUID NOT NULL,
    "region_id" UUID NOT NULL,
    "realm_id" UUID NOT NULL,
    "normalized_name" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "level" INTEGER,
    "faction" TEXT,
    "class_id" UUID,
    "active_spec_id" UUID,
    "role" "CharacterRole",
    "blizzard_character_id" BIGINT,
    "wcl_canonical_id" BIGINT,
    "raiderio_profile_url" TEXT,
    "profile_url" TEXT,
    "last_seen_at" TIMESTAMPTZ(3),
    "last_public_refresh_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "characters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "character_aliases" (
    "id" UUID NOT NULL,
    "character_id" UUID NOT NULL,
    "region_id" UUID NOT NULL,
    "realm_slug" TEXT NOT NULL,
    "normalized_name" TEXT NOT NULL,
    "valid_from" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "valid_to" TIMESTAMPTZ(3),
    "source_provider" "Provider" NOT NULL,

    CONSTRAINT "character_aliases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "battlenet_accounts" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "region_id" UUID NOT NULL,
    "battletag_hash" TEXT NOT NULL,
    "claimed" BOOLEAN NOT NULL DEFAULT false,
    "linked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "battlenet_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account_characters" (
    "account_id" UUID NOT NULL,
    "character_id" UUID NOT NULL,
    "confidence" "AccountLinkConfidence" NOT NULL,
    "source" TEXT NOT NULL,
    "linked_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "account_characters_pkey" PRIMARY KEY ("account_id","character_id")
);

-- CreateTable
CREATE TABLE "character_snapshots" (
    "id" UUID NOT NULL,
    "character_id" UUID NOT NULL,
    "captured_at" TIMESTAMPTZ(3) NOT NULL,
    "item_level_equipped" DOUBLE PRECISION,
    "active_spec_id" UUID,
    "role" "CharacterRole",
    "mythic_rating" DOUBLE PRECISION,
    "source_payload_id" UUID,
    "raw_summary" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "character_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "equipment_snapshots" (
    "id" UUID NOT NULL,
    "character_snapshot_id" UUID NOT NULL,
    "captured_at" TIMESTAMPTZ(3) NOT NULL,
    "average_item_level" DOUBLE PRECISION,
    "equipped_item_level" DOUBLE PRECISION,
    "items" JSONB NOT NULL DEFAULT '[]',
    "key_items" JSONB NOT NULL DEFAULT '{}',
    "source_payload_id" UUID,

    CONSTRAINT "equipment_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "talent_snapshots" (
    "id" UUID NOT NULL,
    "character_snapshot_id" UUID NOT NULL,
    "specialization_id" UUID,
    "loadout_code" TEXT,
    "talents" JSONB NOT NULL DEFAULT '{}',
    "source_payload_id" UUID,

    CONSTRAINT "talent_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "external_requests" (
    "id" UUID NOT NULL,
    "provider" "Provider" NOT NULL,
    "request_fingerprint" TEXT NOT NULL,
    "endpoint_key" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "requested_at" TIMESTAMPTZ(3) NOT NULL,
    "completed_at" TIMESTAMPTZ(3),
    "status_code" INTEGER,
    "cache_hit" BOOLEAN NOT NULL DEFAULT false,
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "cost_units" DOUBLE PRECISION,
    "error_code" TEXT,
    "response_headers" JSONB,
    "expires_at" TIMESTAMPTZ(3),
    "etag" TEXT,
    "last_modified" TEXT,

    CONSTRAINT "external_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "external_payloads" (
    "id" UUID NOT NULL,
    "external_request_id" UUID NOT NULL,
    "provider" "Provider" NOT NULL,
    "content_hash" TEXT NOT NULL,
    "payload" JSONB,
    "artifact_id" UUID,
    "fetched_at" TIMESTAMPTZ(3) NOT NULL,
    "schema_version" TEXT NOT NULL,

    CONSTRAINT "external_payloads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "raw_artifacts" (
    "id" UUID NOT NULL,
    "provider" "Provider" NOT NULL,
    "storage_uri" TEXT NOT NULL,
    "compression" "ArtifactCompression" NOT NULL DEFAULT 'NONE',
    "content_hash" TEXT NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "retention_until" TIMESTAMPTZ(3),

    CONSTRAINT "raw_artifacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mythic_runs" (
    "id" UUID NOT NULL,
    "season_id" UUID NOT NULL,
    "dungeon_id" UUID NOT NULL,
    "region_id" UUID NOT NULL,
    "key_level" INTEGER NOT NULL,
    "completed_at" TIMESTAMPTZ(3) NOT NULL,
    "duration_ms" INTEGER NOT NULL,
    "timer_ms" INTEGER,
    "timed" BOOLEAN NOT NULL,
    "score_value" DOUBLE PRECISION,
    "canonical_fingerprint" TEXT NOT NULL,
    "affixes" JSONB NOT NULL DEFAULT '[]',
    "source_quality" SMALLINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "mythic_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "run_source_references" (
    "id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "provider" "Provider" NOT NULL,
    "external_run_id" TEXT NOT NULL,
    "external_url" TEXT,
    "source_payload_id" UUID,
    "report_code" TEXT,
    "fight_id" INTEGER,
    "revision" INTEGER,

    CONSTRAINT "run_source_references_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "run_participants" (
    "id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "character_id" UUID,
    "provider_character_key" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "realm_slug" TEXT NOT NULL,
    "region_code" TEXT NOT NULL,
    "class_id" UUID,
    "spec_id" UUID,
    "role" "CharacterRole",
    "item_level" DOUBLE PRECISION,
    "mythic_rating_at_run" DOUBLE PRECISION,
    "is_target_character" BOOLEAN NOT NULL DEFAULT false,
    "source_payload_id" UUID,

    CONSTRAINT "run_participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "run_analyses" (
    "id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "character_id" UUID NOT NULL,
    "analysis_version" TEXT NOT NULL,
    "analyzed_at" TIMESTAMPTZ(3) NOT NULL,
    "coverage" DECIMAL(5,4) NOT NULL,
    "summary" JSONB NOT NULL DEFAULT '{}',
    "source_payload_ids" JSONB NOT NULL DEFAULT '[]',

    CONSTRAINT "run_analyses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "metric_definitions" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "dimension" "ScoreDimension" NOT NULL,
    "value_type" TEXT NOT NULL,
    "direction" "MetricDirection" NOT NULL,
    "description" TEXT NOT NULL,
    "default_normalization" JSONB NOT NULL DEFAULT '{}',
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "metric_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "metric_observations" (
    "id" UUID NOT NULL,
    "character_id" UUID NOT NULL,
    "run_id" UUID,
    "season_id" UUID,
    "scope_type" "ScopeType" NOT NULL,
    "scope_key" TEXT,
    "metric_definition_id" UUID NOT NULL,
    "raw_value" DECIMAL(18,6),
    "normalized_value" DECIMAL(8,4),
    "confidence" DECIMAL(5,4) NOT NULL,
    "observed_at" TIMESTAMPTZ(3) NOT NULL,
    "source_provider" "Provider" NOT NULL,
    "source_payload_id" UUID,
    "context" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "metric_observations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mechanic_rules" (
    "id" UUID NOT NULL,
    "season_id" UUID NOT NULL,
    "dungeon_id" UUID NOT NULL,
    "npc_id" BIGINT,
    "spell_id" BIGINT NOT NULL,
    "rule_type" "MechanicRuleType" NOT NULL,
    "severity" DECIMAL(8,4) NOT NULL,
    "applicable_roles" JSONB NOT NULL DEFAULT '[]',
    "response_spell_ids" JSONB NOT NULL DEFAULT '[]',
    "notes" TEXT,
    "source" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "mechanic_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "score_models" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "status" "ScoreModelStatus" NOT NULL DEFAULT 'DRAFT',
    "config" JSONB NOT NULL,
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activated_at" TIMESTAMPTZ(3),

    CONSTRAINT "score_models_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "score_snapshots" (
    "id" UUID NOT NULL,
    "character_id" UUID NOT NULL,
    "season_id" UUID NOT NULL,
    "score_model_id" UUID NOT NULL,
    "scope_type" "ScopeType" NOT NULL,
    "scope_key" TEXT,
    "overall_score" DECIMAL(8,4) NOT NULL,
    "grade" CHAR(1) NOT NULL,
    "skill_score" DECIMAL(8,4) NOT NULL,
    "authenticity_score" DECIMAL(8,4) NOT NULL,
    "confidence" DECIMAL(5,4) NOT NULL,
    "calculated_at" TIMESTAMPTZ(3) NOT NULL,
    "input_fingerprint" TEXT NOT NULL,
    "explanation" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "score_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dimension_scores" (
    "id" UUID NOT NULL,
    "score_snapshot_id" UUID NOT NULL,
    "dimension" "ScoreDimension" NOT NULL,
    "score" DECIMAL(8,4) NOT NULL,
    "confidence" DECIMAL(5,4) NOT NULL,
    "weight" DECIMAL(8,6) NOT NULL,
    "contributors" JSONB NOT NULL DEFAULT '[]',

    CONSTRAINT "dimension_scores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "red_flag_definitions" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "severity" "RedFlagSeverity" NOT NULL,
    "public" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "red_flag_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "character_red_flags" (
    "id" UUID NOT NULL,
    "character_id" UUID NOT NULL,
    "season_id" UUID,
    "run_id" UUID,
    "definition_id" UUID NOT NULL,
    "confidence" DECIMAL(5,4) NOT NULL,
    "status" "RedFlagStatus" NOT NULL DEFAULT 'ACTIVE',
    "evidence" JSONB NOT NULL DEFAULT '{}',
    "first_detected_at" TIMESTAMPTZ(3) NOT NULL,
    "last_detected_at" TIMESTAMPTZ(3) NOT NULL,
    "score_model_id" UUID,

    CONSTRAINT "character_red_flags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "score_disputes" (
    "id" UUID NOT NULL,
    "character_id" UUID NOT NULL,
    "user_id" UUID,
    "score_snapshot_id" UUID,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "reason" TEXT NOT NULL,
    "evidence" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMPTZ(3),

    CONSTRAINT "score_disputes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ingestion_jobs" (
    "id" UUID NOT NULL,
    "job_type" TEXT NOT NULL,
    "character_id" UUID,
    "run_id" UUID,
    "status" "JobStatus" NOT NULL DEFAULT 'QUEUED',
    "dedupe_key" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "scheduled_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "error" JSONB,

    CONSTRAINT "ingestion_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT,
    "display_name" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'USER',
    "auth_provider" TEXT NOT NULL,
    "external_subject" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "entitlements" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3),
    "source" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "entitlements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "addon_exports" (
    "id" UUID NOT NULL,
    "region_id" UUID NOT NULL,
    "season_id" UUID NOT NULL,
    "score_model_id" UUID NOT NULL,
    "generated_at" TIMESTAMPTZ(3) NOT NULL,
    "character_count" INTEGER NOT NULL,
    "format_version" TEXT NOT NULL,
    "artifact_id" UUID,
    "checksum" TEXT NOT NULL,
    "status" "AddonExportStatus" NOT NULL DEFAULT 'PENDING',
    "metadata" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "addon_exports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "regions_code_key" ON "regions"("code");

-- CreateIndex
CREATE UNIQUE INDEX "realms_region_id_slug_key" ON "realms"("region_id", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "seasons_region_id_slug_key" ON "seasons"("region_id", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "dungeons_slug_key" ON "dungeons"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "game_classes_slug_key" ON "game_classes"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "game_specializations_class_id_slug_key" ON "game_specializations"("class_id", "slug");

-- CreateIndex
CREATE INDEX "characters_last_public_refresh_at_idx" ON "characters"("last_public_refresh_at");

-- CreateIndex
CREATE UNIQUE INDEX "characters_region_id_realm_id_normalized_name_key" ON "characters"("region_id", "realm_id", "normalized_name");

-- CreateIndex
CREATE UNIQUE INDEX "character_aliases_region_id_realm_slug_normalized_name_key" ON "character_aliases"("region_id", "realm_slug", "normalized_name");

-- CreateIndex
CREATE UNIQUE INDEX "battlenet_accounts_region_id_battletag_hash_key" ON "battlenet_accounts"("region_id", "battletag_hash");

-- CreateIndex
CREATE INDEX "character_snapshots_character_id_captured_at_idx" ON "character_snapshots"("character_id", "captured_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "equipment_snapshots_character_snapshot_id_key" ON "equipment_snapshots"("character_snapshot_id");

-- CreateIndex
CREATE UNIQUE INDEX "external_requests_request_fingerprint_key" ON "external_requests"("request_fingerprint");

-- CreateIndex
CREATE INDEX "external_requests_provider_endpoint_key_requested_at_idx" ON "external_requests"("provider", "endpoint_key", "requested_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "external_payloads_provider_content_hash_key" ON "external_payloads"("provider", "content_hash");

-- CreateIndex
CREATE INDEX "raw_artifacts_content_hash_idx" ON "raw_artifacts"("content_hash");

-- CreateIndex
CREATE UNIQUE INDEX "mythic_runs_canonical_fingerprint_key" ON "mythic_runs"("canonical_fingerprint");

-- CreateIndex
CREATE INDEX "mythic_runs_season_id_dungeon_id_key_level_completed_at_idx" ON "mythic_runs"("season_id", "dungeon_id", "key_level", "completed_at");

-- CreateIndex
CREATE INDEX "mythic_runs_completed_at_idx" ON "mythic_runs"("completed_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "run_source_references_provider_external_run_id_key" ON "run_source_references"("provider", "external_run_id");

-- CreateIndex
CREATE UNIQUE INDEX "run_source_references_provider_report_code_fight_id_key" ON "run_source_references"("provider", "report_code", "fight_id");

-- CreateIndex
CREATE UNIQUE INDEX "run_participants_run_id_provider_character_key_key" ON "run_participants"("run_id", "provider_character_key");

-- CreateIndex
CREATE UNIQUE INDEX "run_analyses_run_id_character_id_analysis_version_key" ON "run_analyses"("run_id", "character_id", "analysis_version");

-- CreateIndex
CREATE UNIQUE INDEX "metric_definitions_key_key" ON "metric_definitions"("key");

-- CreateIndex
CREATE INDEX "metric_observations_character_id_season_id_metric_definitio_idx" ON "metric_observations"("character_id", "season_id", "metric_definition_id");

-- CreateIndex
CREATE UNIQUE INDEX "mechanic_rules_season_id_dungeon_id_spell_id_rule_type_vers_key" ON "mechanic_rules"("season_id", "dungeon_id", "spell_id", "rule_type", "version");

-- CreateIndex
CREATE UNIQUE INDEX "score_models_key_version_key" ON "score_models"("key", "version");

-- CreateIndex
CREATE INDEX "score_snapshots_character_id_calculated_at_idx" ON "score_snapshots"("character_id", "calculated_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "score_snapshots_character_id_season_id_score_model_id_scope_key" ON "score_snapshots"("character_id", "season_id", "score_model_id", "scope_type", "scope_key", "input_fingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "dimension_scores_score_snapshot_id_dimension_key" ON "dimension_scores"("score_snapshot_id", "dimension");

-- CreateIndex
CREATE UNIQUE INDEX "red_flag_definitions_key_key" ON "red_flag_definitions"("key");

-- CreateIndex
CREATE INDEX "character_red_flags_character_id_status_idx" ON "character_red_flags"("character_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ingestion_jobs_dedupe_key_key" ON "ingestion_jobs"("dedupe_key");

-- CreateIndex
CREATE INDEX "ingestion_jobs_status_scheduled_at_idx" ON "ingestion_jobs"("status", "scheduled_at");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_auth_provider_external_subject_key" ON "users"("auth_provider", "external_subject");

-- CreateIndex
CREATE UNIQUE INDEX "entitlements_user_id_key_starts_at_key" ON "entitlements"("user_id", "key", "starts_at");

-- CreateIndex
CREATE INDEX "addon_exports_region_id_season_id_generated_at_idx" ON "addon_exports"("region_id", "season_id", "generated_at" DESC);

-- AddForeignKey
ALTER TABLE "realms" ADD CONSTRAINT "realms_region_id_fkey" FOREIGN KEY ("region_id") REFERENCES "regions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seasons" ADD CONSTRAINT "seasons_region_id_fkey" FOREIGN KEY ("region_id") REFERENCES "regions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "season_dungeons" ADD CONSTRAINT "season_dungeons_season_id_fkey" FOREIGN KEY ("season_id") REFERENCES "seasons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "season_dungeons" ADD CONSTRAINT "season_dungeons_dungeon_id_fkey" FOREIGN KEY ("dungeon_id") REFERENCES "dungeons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_specializations" ADD CONSTRAINT "game_specializations_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "game_classes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "characters" ADD CONSTRAINT "characters_region_id_fkey" FOREIGN KEY ("region_id") REFERENCES "regions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "characters" ADD CONSTRAINT "characters_realm_id_fkey" FOREIGN KEY ("realm_id") REFERENCES "realms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "characters" ADD CONSTRAINT "characters_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "game_classes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "characters" ADD CONSTRAINT "characters_active_spec_id_fkey" FOREIGN KEY ("active_spec_id") REFERENCES "game_specializations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "character_aliases" ADD CONSTRAINT "character_aliases_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "characters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "character_aliases" ADD CONSTRAINT "character_aliases_region_id_fkey" FOREIGN KEY ("region_id") REFERENCES "regions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "battlenet_accounts" ADD CONSTRAINT "battlenet_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "battlenet_accounts" ADD CONSTRAINT "battlenet_accounts_region_id_fkey" FOREIGN KEY ("region_id") REFERENCES "regions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_characters" ADD CONSTRAINT "account_characters_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "battlenet_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_characters" ADD CONSTRAINT "account_characters_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "characters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "character_snapshots" ADD CONSTRAINT "character_snapshots_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "characters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "character_snapshots" ADD CONSTRAINT "character_snapshots_active_spec_id_fkey" FOREIGN KEY ("active_spec_id") REFERENCES "game_specializations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment_snapshots" ADD CONSTRAINT "equipment_snapshots_character_snapshot_id_fkey" FOREIGN KEY ("character_snapshot_id") REFERENCES "character_snapshots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "talent_snapshots" ADD CONSTRAINT "talent_snapshots_character_snapshot_id_fkey" FOREIGN KEY ("character_snapshot_id") REFERENCES "character_snapshots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "talent_snapshots" ADD CONSTRAINT "talent_snapshots_specialization_id_fkey" FOREIGN KEY ("specialization_id") REFERENCES "game_specializations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_payloads" ADD CONSTRAINT "external_payloads_external_request_id_fkey" FOREIGN KEY ("external_request_id") REFERENCES "external_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_payloads" ADD CONSTRAINT "external_payloads_artifact_id_fkey" FOREIGN KEY ("artifact_id") REFERENCES "raw_artifacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mythic_runs" ADD CONSTRAINT "mythic_runs_season_id_fkey" FOREIGN KEY ("season_id") REFERENCES "seasons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mythic_runs" ADD CONSTRAINT "mythic_runs_dungeon_id_fkey" FOREIGN KEY ("dungeon_id") REFERENCES "dungeons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mythic_runs" ADD CONSTRAINT "mythic_runs_region_id_fkey" FOREIGN KEY ("region_id") REFERENCES "regions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "run_source_references" ADD CONSTRAINT "run_source_references_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "mythic_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "run_participants" ADD CONSTRAINT "run_participants_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "mythic_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "run_participants" ADD CONSTRAINT "run_participants_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "characters"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "run_participants" ADD CONSTRAINT "run_participants_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "game_classes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "run_participants" ADD CONSTRAINT "run_participants_spec_id_fkey" FOREIGN KEY ("spec_id") REFERENCES "game_specializations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "run_analyses" ADD CONSTRAINT "run_analyses_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "mythic_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "run_analyses" ADD CONSTRAINT "run_analyses_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "characters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "metric_observations" ADD CONSTRAINT "metric_observations_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "characters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "metric_observations" ADD CONSTRAINT "metric_observations_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "mythic_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "metric_observations" ADD CONSTRAINT "metric_observations_season_id_fkey" FOREIGN KEY ("season_id") REFERENCES "seasons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "metric_observations" ADD CONSTRAINT "metric_observations_metric_definition_id_fkey" FOREIGN KEY ("metric_definition_id") REFERENCES "metric_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mechanic_rules" ADD CONSTRAINT "mechanic_rules_season_id_fkey" FOREIGN KEY ("season_id") REFERENCES "seasons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mechanic_rules" ADD CONSTRAINT "mechanic_rules_dungeon_id_fkey" FOREIGN KEY ("dungeon_id") REFERENCES "dungeons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "score_models" ADD CONSTRAINT "score_models_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "score_snapshots" ADD CONSTRAINT "score_snapshots_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "characters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "score_snapshots" ADD CONSTRAINT "score_snapshots_season_id_fkey" FOREIGN KEY ("season_id") REFERENCES "seasons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "score_snapshots" ADD CONSTRAINT "score_snapshots_score_model_id_fkey" FOREIGN KEY ("score_model_id") REFERENCES "score_models"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dimension_scores" ADD CONSTRAINT "dimension_scores_score_snapshot_id_fkey" FOREIGN KEY ("score_snapshot_id") REFERENCES "score_snapshots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "character_red_flags" ADD CONSTRAINT "character_red_flags_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "characters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "character_red_flags" ADD CONSTRAINT "character_red_flags_season_id_fkey" FOREIGN KEY ("season_id") REFERENCES "seasons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "character_red_flags" ADD CONSTRAINT "character_red_flags_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "mythic_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "character_red_flags" ADD CONSTRAINT "character_red_flags_definition_id_fkey" FOREIGN KEY ("definition_id") REFERENCES "red_flag_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "character_red_flags" ADD CONSTRAINT "character_red_flags_score_model_id_fkey" FOREIGN KEY ("score_model_id") REFERENCES "score_models"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "score_disputes" ADD CONSTRAINT "score_disputes_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "characters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "score_disputes" ADD CONSTRAINT "score_disputes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "score_disputes" ADD CONSTRAINT "score_disputes_score_snapshot_id_fkey" FOREIGN KEY ("score_snapshot_id") REFERENCES "score_snapshots"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ingestion_jobs" ADD CONSTRAINT "ingestion_jobs_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "characters"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ingestion_jobs" ADD CONSTRAINT "ingestion_jobs_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "mythic_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entitlements" ADD CONSTRAINT "entitlements_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "addon_exports" ADD CONSTRAINT "addon_exports_region_id_fkey" FOREIGN KEY ("region_id") REFERENCES "regions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "addon_exports" ADD CONSTRAINT "addon_exports_season_id_fkey" FOREIGN KEY ("season_id") REFERENCES "seasons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "addon_exports" ADD CONSTRAINT "addon_exports_score_model_id_fkey" FOREIGN KEY ("score_model_id") REFERENCES "score_models"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "addon_exports" ADD CONSTRAINT "addon_exports_artifact_id_fkey" FOREIGN KEY ("artifact_id") REFERENCES "raw_artifacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
