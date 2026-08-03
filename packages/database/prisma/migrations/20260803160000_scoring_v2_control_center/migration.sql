-- Scoring V2 Control Center: runtime settings, evidence exports, refresh workload class

CREATE TYPE "RefreshWorkloadClass" AS ENUM ('CALIBRATION', 'OPERATION');
CREATE TYPE "ScoringV2EvidenceExportStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED');

ALTER TYPE "Provider" ADD VALUE 'INTERNAL';

ALTER TABLE "ingestion_jobs"
  ADD COLUMN "workload_class" "RefreshWorkloadClass" NOT NULL DEFAULT 'OPERATION';

CREATE INDEX "ingestion_jobs_workload_class_status_scheduled_at_idx"
  ON "ingestion_jobs"("workload_class", "status", "scheduled_at");

CREATE TABLE "runtime_settings" (
  "key" TEXT NOT NULL,
  "value" JSONB NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "updated_by_user_id" UUID,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "runtime_settings_pkey" PRIMARY KEY ("key")
);

ALTER TABLE "runtime_settings"
  ADD CONSTRAINT "runtime_settings_updated_by_user_id_fkey"
  FOREIGN KEY ("updated_by_user_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Safe defaults for admin-controlled refresh lane concurrency (range 1–8).
INSERT INTO "runtime_settings" ("key", "value", "version", "created_at", "updated_at")
VALUES
  ('concurrency_calibration', '4'::jsonb, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('concurrency_operation', '2'::jsonb, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

CREATE TABLE "scoring_v2_evidence_exports" (
  "id" UUID NOT NULL,
  "cohort_id" UUID NOT NULL,
  "cohort_revision" INTEGER NOT NULL,
  "season_id" UUID,
  "score_model_id" UUID,
  "status" "ScoringV2EvidenceExportStatus" NOT NULL DEFAULT 'QUEUED',
  "progress" JSONB NOT NULL DEFAULT '{}',
  "summary" JSONB NOT NULL DEFAULT '{}',
  "blocker_count" INTEGER NOT NULL DEFAULT 0,
  "warning_count" INTEGER NOT NULL DEFAULT 0,
  "archive_content_hash" TEXT,
  "archive_byte_length" INTEGER,
  "archive_storage_uri" TEXT,
  "summary_content_hash" TEXT,
  "preflight_content_hash" TEXT,
  "markdown_content_hash" TEXT,
  "frozen_bundle_content_hash" TEXT,
  "frozen_bundle_byte_length" INTEGER,
  "frozen_bundle_storage_uri" TEXT,
  "frozen_at" TIMESTAMPTZ(3),
  "error_code" TEXT,
  "error_message" TEXT,
  "requested_by_user_id" UUID NOT NULL,
  "bullmq_job_id" TEXT,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "started_at" TIMESTAMPTZ(3),
  "completed_at" TIMESTAMPTZ(3),
  CONSTRAINT "scoring_v2_evidence_exports_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "scoring_v2_evidence_exports_status_created_at_idx"
  ON "scoring_v2_evidence_exports"("status", "created_at" DESC);
CREATE INDEX "scoring_v2_evidence_exports_cohort_id_created_at_idx"
  ON "scoring_v2_evidence_exports"("cohort_id", "created_at" DESC);
CREATE INDEX "scoring_v2_evidence_exports_requested_by_user_id_created_at_idx"
  ON "scoring_v2_evidence_exports"("requested_by_user_id", "created_at" DESC);
CREATE INDEX "scoring_v2_evidence_exports_archive_content_hash_idx"
  ON "scoring_v2_evidence_exports"("archive_content_hash");
CREATE INDEX "scoring_v2_evidence_exports_frozen_bundle_content_hash_idx"
  ON "scoring_v2_evidence_exports"("frozen_bundle_content_hash");

ALTER TABLE "scoring_v2_evidence_exports"
  ADD CONSTRAINT "scoring_v2_evidence_exports_cohort_id_fkey"
  FOREIGN KEY ("cohort_id") REFERENCES "calibration_cohorts"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "scoring_v2_evidence_exports"
  ADD CONSTRAINT "scoring_v2_evidence_exports_season_id_fkey"
  FOREIGN KEY ("season_id") REFERENCES "seasons"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "scoring_v2_evidence_exports"
  ADD CONSTRAINT "scoring_v2_evidence_exports_score_model_id_fkey"
  FOREIGN KEY ("score_model_id") REFERENCES "score_models"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "scoring_v2_evidence_exports"
  ADD CONSTRAINT "scoring_v2_evidence_exports_requested_by_user_id_fkey"
  FOREIGN KEY ("requested_by_user_id") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
