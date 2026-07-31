-- Additive cancellation / queue tracking for IngestionJob (non-destructive).

ALTER TABLE "ingestion_jobs" ADD COLUMN IF NOT EXISTS "queue_job_id" TEXT;
ALTER TABLE "ingestion_jobs" ADD COLUMN IF NOT EXISTS "cancel_requested_at" TIMESTAMPTZ(3);
ALTER TABLE "ingestion_jobs" ADD COLUMN IF NOT EXISTS "cancelled_at" TIMESTAMPTZ(3);
ALTER TABLE "ingestion_jobs" ADD COLUMN IF NOT EXISTS "cancel_reason" TEXT;

CREATE INDEX IF NOT EXISTS "ingestion_jobs_job_type_status_scheduled_at_idx"
  ON "ingestion_jobs"("job_type", "status", "scheduled_at");

CREATE INDEX IF NOT EXISTS "ingestion_jobs_cancel_requested_at_idx"
  ON "ingestion_jobs"("cancel_requested_at");
