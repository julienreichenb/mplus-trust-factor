-- Admin calibration platform (Phase 1): cohorts, runs, immutable reports.
-- Calibration jobs use a dedicated BullMQ queue; they are not IngestionJob rows.

CREATE TYPE "CalibrationCohortStatus" AS ENUM ('DRAFT', 'READY', 'ARCHIVED');

CREATE TYPE "CalibrationRunStatus" AS ENUM (
  'QUEUED',
  'RUNNING',
  'SUCCEEDED',
  'FAILED',
  'CANCELLED'
);

CREATE TYPE "CalibrationRunMode" AS ENUM (
  'PERSISTED_SNAPSHOT_ONLY',
  'DRAFT_MODEL_EVALUATE',
  'ACTIVE_VERSUS_DRAFT'
);

CREATE TYPE "CalibrationExpectedLabel" AS ENUM (
  'EXCELLENT',
  'GOOD',
  'AVERAGE',
  'WEAK',
  'OVERRATED'
);

CREATE TYPE "CalibrationMemberSource" AS ENUM (
  'USER_SELECTED',
  'IMPORTED_STUDY',
  'STRATIFIED_AUTO'
);

CREATE TABLE "calibration_cohorts" (
  "id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT NOT NULL DEFAULT '',
  "season_id" UUID NOT NULL,
  "status" "CalibrationCohortStatus" NOT NULL DEFAULT 'DRAFT',
  "revision" INTEGER NOT NULL DEFAULT 1,
  "external_key" TEXT,
  "created_by_user_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  "archived_at" TIMESTAMPTZ(3),

  CONSTRAINT "calibration_cohorts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "calibration_cohort_members" (
  "id" UUID NOT NULL,
  "cohort_id" UUID NOT NULL,
  "character_id" UUID,
  "region" TEXT NOT NULL,
  "realm_slug" TEXT NOT NULL,
  "character_name" TEXT NOT NULL,
  "expected_label" "CalibrationExpectedLabel" NOT NULL,
  "provided_role" "CharacterRole",
  "class_slug" TEXT,
  "spec_slug" TEXT,
  "evidence_cutoff_at" TIMESTAMPTZ(3),
  "rationale" TEXT NOT NULL,
  "source" "CalibrationMemberSource" NOT NULL DEFAULT 'USER_SELECTED',
  "included" BOOLEAN NOT NULL DEFAULT true,
  "exclusion_code" TEXT,
  "exclusion_detail" TEXT,
  "preflight_snapshot" JSONB NOT NULL DEFAULT '{}',
  "external_member_key" TEXT,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "calibration_cohort_members_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "calibration_runs" (
  "id" UUID NOT NULL,
  "cohort_id" UUID NOT NULL,
  "cohort_revision" INTEGER NOT NULL,
  "season_id" UUID NOT NULL,
  "mode" "CalibrationRunMode" NOT NULL,
  "status" "CalibrationRunStatus" NOT NULL DEFAULT 'QUEUED',
  "active_model_id" UUID,
  "evaluation_model_id" UUID,
  "active_model_config" JSONB,
  "evaluation_model_config" JSONB,
  "evidence_policy" TEXT NOT NULL DEFAULT 'STRICT',
  "input_bundle_schema_version" TEXT NOT NULL,
  "input_bundle_content_hash" TEXT NOT NULL,
  "input_bundle" JSONB NOT NULL,
  "input_bundle_byte_length" INTEGER NOT NULL,
  "snapshot_ids" JSONB NOT NULL DEFAULT '[]',
  "evidence_fingerprint" TEXT,
  "deterministic_seed" INTEGER NOT NULL DEFAULT 0,
  "algorithm_versions" JSONB NOT NULL DEFAULT '{}',
  "cancel_requested_at" TIMESTAMPTZ(3),
  "error_code" TEXT,
  "error_message" TEXT,
  "created_by_user_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "started_at" TIMESTAMPTZ(3),
  "completed_at" TIMESTAMPTZ(3),
  "bullmq_job_id" TEXT,

  CONSTRAINT "calibration_runs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "calibration_reports" (
  "id" UUID NOT NULL,
  "run_id" UUID NOT NULL,
  "schema_version" TEXT NOT NULL,
  "digest_algorithm_version" TEXT NOT NULL,
  "recommendation_algorithm_version" TEXT,
  "summary_json" JSONB NOT NULL,
  "report_json" JSONB NOT NULL,
  "digest_json" JSONB NOT NULL,
  "limitations_json" JSONB NOT NULL DEFAULT '[]',
  "cohort_size" INTEGER NOT NULL,
  "evaluated_count" INTEGER NOT NULL,
  "failed_or_excluded_count" INTEGER NOT NULL,
  "spearman" DOUBLE PRECISION,
  "pairwise_concordance" DOUBLE PRECISION,
  "mean_score" DOUBLE PRECISION,
  "mean_confidence" DOUBLE PRECISION,
  "outlier_count" INTEGER NOT NULL DEFAULT 0,
  "content_hash" TEXT NOT NULL,
  "generated_at" TIMESTAMPTZ(3) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "calibration_reports_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "calibration_cohorts_external_key_key" ON "calibration_cohorts"("external_key");
CREATE INDEX "calibration_cohorts_status_updated_at_idx" ON "calibration_cohorts"("status", "updated_at" DESC);
CREATE INDEX "calibration_cohorts_created_by_user_id_updated_at_idx" ON "calibration_cohorts"("created_by_user_id", "updated_at" DESC);

CREATE UNIQUE INDEX "calibration_cohort_members_cohort_id_external_member_key_key"
  ON "calibration_cohort_members"("cohort_id", "external_member_key");
CREATE INDEX "calibration_cohort_members_cohort_id_included_idx"
  ON "calibration_cohort_members"("cohort_id", "included");
CREATE INDEX "calibration_cohort_members_cohort_id_region_realm_slug_character_name_idx"
  ON "calibration_cohort_members"("cohort_id", "region", "realm_slug", "character_name");
CREATE INDEX "calibration_cohort_members_character_id_idx"
  ON "calibration_cohort_members"("character_id");

CREATE INDEX "calibration_runs_status_created_at_idx" ON "calibration_runs"("status", "created_at" DESC);
CREATE INDEX "calibration_runs_cohort_id_created_at_idx" ON "calibration_runs"("cohort_id", "created_at" DESC);
CREATE INDEX "calibration_runs_created_by_user_id_created_at_idx" ON "calibration_runs"("created_by_user_id", "created_at" DESC);

CREATE UNIQUE INDEX "calibration_reports_run_id_key" ON "calibration_reports"("run_id");

ALTER TABLE "calibration_cohorts"
  ADD CONSTRAINT "calibration_cohorts_season_id_fkey"
  FOREIGN KEY ("season_id") REFERENCES "seasons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "calibration_cohorts"
  ADD CONSTRAINT "calibration_cohorts_created_by_user_id_fkey"
  FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "calibration_cohort_members"
  ADD CONSTRAINT "calibration_cohort_members_cohort_id_fkey"
  FOREIGN KEY ("cohort_id") REFERENCES "calibration_cohorts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "calibration_cohort_members"
  ADD CONSTRAINT "calibration_cohort_members_character_id_fkey"
  FOREIGN KEY ("character_id") REFERENCES "characters"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "calibration_runs"
  ADD CONSTRAINT "calibration_runs_cohort_id_fkey"
  FOREIGN KEY ("cohort_id") REFERENCES "calibration_cohorts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "calibration_runs"
  ADD CONSTRAINT "calibration_runs_season_id_fkey"
  FOREIGN KEY ("season_id") REFERENCES "seasons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "calibration_runs"
  ADD CONSTRAINT "calibration_runs_active_model_id_fkey"
  FOREIGN KEY ("active_model_id") REFERENCES "score_models"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "calibration_runs"
  ADD CONSTRAINT "calibration_runs_evaluation_model_id_fkey"
  FOREIGN KEY ("evaluation_model_id") REFERENCES "score_models"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "calibration_runs"
  ADD CONSTRAINT "calibration_runs_created_by_user_id_fkey"
  FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "calibration_reports"
  ADD CONSTRAINT "calibration_reports_run_id_fkey"
  FOREIGN KEY ("run_id") REFERENCES "calibration_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
