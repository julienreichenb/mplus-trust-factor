-- Additive index for Stage 4 refresh ETA throughput reads.
-- Supports: WHERE job_type = 'refresh-character' AND status = 'COMPLETED' AND completed_at >= $since
-- ORDER BY completed_at DESC LIMIT N
-- Does not change refresh execution, concurrency, or BullMQ priority behaviour.

CREATE INDEX IF NOT EXISTS "ingestion_jobs_job_type_status_completed_at_idx"
  ON "ingestion_jobs"("job_type", "status", "completed_at");
