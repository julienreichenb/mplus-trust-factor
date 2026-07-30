-- Bulk character processing: durable operation + item checkpoint state

CREATE TYPE "BulkOperationMode" AS ENUM ('FULL_REFRESH', 'RECALCULATE_ONLY');

CREATE TYPE "BulkOperationStatus" AS ENUM (
  'PENDING',
  'SELECTING',
  'RUNNING',
  'PAUSED',
  'CANCELLED',
  'COMPLETED',
  'FAILED',
  'DRY_RUN_COMPLETED'
);

CREATE TYPE "BulkOperationItemStatus" AS ENUM (
  'PENDING',
  'ENQUEUED',
  'SKIPPED_INCOMPATIBLE',
  'SKIPPED_BUDGET',
  'SKIPPED_CANCELLED',
  'SKIPPED_DRY_RUN',
  'SKIPPED_CHARACTER_DELETED'
);

CREATE TABLE "bulk_operations" (
  "id" UUID NOT NULL,
  "mode" "BulkOperationMode" NOT NULL,
  "status" "BulkOperationStatus" NOT NULL DEFAULT 'PENDING',
  "logical_key" TEXT NOT NULL,
  "min_mythic_plus_score" DOUBLE PRECISION,
  "score_model_id" UUID,
  "batch_size" INTEGER NOT NULL,
  "max_characters" INTEGER,
  "max_wcl_calls" INTEGER,
  "dry_run" BOOLEAN NOT NULL DEFAULT false,
  "allow_full_refresh_on_incompatible" BOOLEAN NOT NULL DEFAULT false,
  "config_snapshot" JSONB NOT NULL DEFAULT '{}',
  "checkpoint" JSONB NOT NULL DEFAULT '{}',
  "selection_fingerprint" TEXT,
  "selected_count" INTEGER NOT NULL DEFAULT 0,
  "enqueued_count" INTEGER NOT NULL DEFAULT 0,
  "dispatched_count" INTEGER NOT NULL DEFAULT 0,
  "dispatch_failed_count" INTEGER NOT NULL DEFAULT 0,
  "skipped_count" INTEGER NOT NULL DEFAULT 0,
  "estimated_wcl_calls" DOUBLE PRECISION,
  "consumed_wcl_calls" DOUBLE PRECISION,
  "created_by_user_id" UUID,
  "cancel_requested_at" TIMESTAMPTZ(3),
  "pause_requested_at" TIMESTAMPTZ(3),
  "error" JSONB,
  "started_at" TIMESTAMPTZ(3),
  "completed_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "bulk_operations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "bulk_operation_items" (
  "id" UUID NOT NULL,
  "bulk_operation_id" UUID NOT NULL,
  "character_id" UUID,
  "position" INTEGER NOT NULL,
  "status" "BulkOperationItemStatus" NOT NULL DEFAULT 'PENDING',
  "region" TEXT NOT NULL,
  "realm_slug" TEXT NOT NULL,
  "character_name" TEXT NOT NULL,
  "mythic_plus_score" DOUBLE PRECISION,
  "evidence_compatible" BOOLEAN,
  "skip_reason" TEXT,
  "error" JSONB,
  "child_job_id" UUID,
  "child_job_type" TEXT,
  "processed_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "bulk_operation_items_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "bulk_operations_status_created_at_idx" ON "bulk_operations"("status", "created_at" DESC);
CREATE INDEX "bulk_operations_logical_key_idx" ON "bulk_operations"("logical_key");

-- At most one active operation per logical key (terminal statuses may reuse the key).
CREATE UNIQUE INDEX "bulk_operations_active_logical_key_uidx"
  ON "bulk_operations"("logical_key")
  WHERE "status" IN ('PENDING', 'SELECTING', 'RUNNING', 'PAUSED');

CREATE UNIQUE INDEX "bulk_operation_items_bulk_operation_id_character_id_key" ON "bulk_operation_items"("bulk_operation_id", "character_id");
CREATE UNIQUE INDEX "bulk_operation_items_bulk_operation_id_position_key" ON "bulk_operation_items"("bulk_operation_id", "position");
CREATE INDEX "bulk_operation_items_bulk_operation_id_status_position_idx" ON "bulk_operation_items"("bulk_operation_id", "status", "position");

ALTER TABLE "bulk_operations" ADD CONSTRAINT "bulk_operations_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "bulk_operations" ADD CONSTRAINT "bulk_operations_score_model_id_fkey" FOREIGN KEY ("score_model_id") REFERENCES "score_models"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "bulk_operation_items" ADD CONSTRAINT "bulk_operation_items_bulk_operation_id_fkey" FOREIGN KEY ("bulk_operation_id") REFERENCES "bulk_operations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "bulk_operation_items" ADD CONSTRAINT "bulk_operation_items_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "characters"("id") ON DELETE SET NULL ON UPDATE CASCADE;
