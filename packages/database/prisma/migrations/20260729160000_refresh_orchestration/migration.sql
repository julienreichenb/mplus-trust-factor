-- Agent 39: refresh orchestration durable state (schedules, cost ledger, profile views).

CREATE TYPE "RefreshScheduleMode" AS ENUM ('DRY_RUN', 'CACHED_BATCH', 'LIVE_ENQUEUE');
CREATE TYPE "RefreshScheduleRunStatus" AS ENUM ('PLANNING', 'RUNNING', 'PAUSED_BUDGET', 'COMPLETED', 'CANCELLED', 'FAILED');
CREATE TYPE "RefreshScheduleItemStatus" AS ENUM (
  'PLANNED',
  'SKIPPED_FRESH',
  'SKIPPED_COOLDOWN',
  'SKIPPED_BUDGET',
  'SKIPPED_FAIRNESS',
  'DEFERRED_RATE_LIMIT',
  'ENQUEUED',
  'COMPLETED',
  'FAILED'
);
CREATE TYPE "RefreshCostSource" AS ENUM ('MEASURED', 'ESTIMATED', 'UNKNOWN');

CREATE TABLE IF NOT EXISTS "refresh_schedule_runs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "mode" "RefreshScheduleMode" NOT NULL,
  "status" "RefreshScheduleRunStatus" NOT NULL DEFAULT 'PLANNING',
  "strategy" TEXT NOT NULL,
  "cadence_hint" TEXT,
  "dry_run" BOOLEAN NOT NULL DEFAULT true,
  "config_snapshot" JSONB NOT NULL DEFAULT '{}',
  "checkpoint" JSONB NOT NULL DEFAULT '{}',
  "denominator_key" TEXT,
  "denominator_count" INTEGER,
  "planned_job_count" INTEGER NOT NULL DEFAULT 0,
  "selected_count" INTEGER NOT NULL DEFAULT 0,
  "skipped_count" INTEGER NOT NULL DEFAULT 0,
  "deferred_count" INTEGER NOT NULL DEFAULT 0,
  "estimated_wcl_points" DOUBLE PRECISION,
  "consumed_wcl_points" DOUBLE PRECISION,
  "region_distribution" JSONB NOT NULL DEFAULT '{}',
  "spec_distribution" JSONB NOT NULL DEFAULT '{}',
  "next_resume_at" TIMESTAMPTZ(3),
  "notes" JSONB NOT NULL DEFAULT '[]',
  "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TIMESTAMPTZ(3),
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "refresh_schedule_runs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "refresh_schedule_runs_status_started_idx"
  ON "refresh_schedule_runs" ("status", "started_at" DESC);

CREATE TABLE IF NOT EXISTS "refresh_schedule_items" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "schedule_run_id" UUID NOT NULL,
  "character_id" UUID NOT NULL,
  "cadence_tier" TEXT NOT NULL,
  "region" TEXT NOT NULL,
  "spec_role" TEXT,
  "planned_datasets" JSONB NOT NULL DEFAULT '[]',
  "estimated_wcl_points" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "status" "RefreshScheduleItemStatus" NOT NULL DEFAULT 'PLANNED',
  "deterministic_job_key" TEXT NOT NULL,
  "skip_reason" TEXT,
  "deferred_until" TIMESTAMPTZ(3),
  "enqueued_job_id" UUID,
  "priority" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "refresh_schedule_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "refresh_schedule_items_schedule_run_id_fkey"
    FOREIGN KEY ("schedule_run_id") REFERENCES "refresh_schedule_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "refresh_schedule_items_character_id_fkey"
    FOREIGN KEY ("character_id") REFERENCES "characters"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "refresh_schedule_items_run_character_unique"
  ON "refresh_schedule_items" ("schedule_run_id", "character_id");
CREATE INDEX IF NOT EXISTS "refresh_schedule_items_status_deferred_idx"
  ON "refresh_schedule_items" ("status", "deferred_until");
CREATE INDEX IF NOT EXISTS "refresh_schedule_items_job_key_idx"
  ON "refresh_schedule_items" ("deterministic_job_key");

CREATE TABLE IF NOT EXISTS "refresh_cost_ledger_entries" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "provider" "Provider" NOT NULL,
  "operation" TEXT NOT NULL,
  "dataset" TEXT NOT NULL,
  "character_id" UUID,
  "run_id" UUID,
  "job_id" UUID,
  "schedule_run_id" UUID,
  "refresh_reason" TEXT NOT NULL,
  "cache_hit" BOOLEAN NOT NULL DEFAULT false,
  "estimated_cost" DOUBLE PRECISION,
  "measured_cost" DOUBLE PRECISION,
  "cost_source" "RefreshCostSource" NOT NULL,
  "model_only" BOOLEAN NOT NULL DEFAULT false,
  "provider_refetch" BOOLEAN NOT NULL DEFAULT false,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "recorded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "refresh_cost_ledger_entries_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "refresh_cost_ledger_entries_character_id_fkey"
    FOREIGN KEY ("character_id") REFERENCES "characters"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "refresh_cost_ledger_entries_schedule_run_id_fkey"
    FOREIGN KEY ("schedule_run_id") REFERENCES "refresh_schedule_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "refresh_cost_ledger_provider_op_idx"
  ON "refresh_cost_ledger_entries" ("provider", "operation", "recorded_at" DESC);
CREATE INDEX IF NOT EXISTS "refresh_cost_ledger_character_idx"
  ON "refresh_cost_ledger_entries" ("character_id", "recorded_at" DESC);
CREATE INDEX IF NOT EXISTS "refresh_cost_ledger_reason_idx"
  ON "refresh_cost_ledger_entries" ("refresh_reason", "recorded_at" DESC);

CREATE TABLE IF NOT EXISTS "character_profile_views" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "character_id" UUID NOT NULL,
  "viewed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "viewer_hash" TEXT,
  "source" TEXT NOT NULL DEFAULT 'public',
  CONSTRAINT "character_profile_views_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "character_profile_views_character_id_fkey"
    FOREIGN KEY ("character_id") REFERENCES "characters"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "character_profile_views_character_viewed_idx"
  ON "character_profile_views" ("character_id", "viewed_at" DESC);
CREATE INDEX IF NOT EXISTS "character_profile_views_viewed_idx"
  ON "character_profile_views" ("viewed_at" DESC);
