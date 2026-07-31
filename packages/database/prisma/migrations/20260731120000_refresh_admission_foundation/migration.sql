-- Additive RefreshAdmission durable audit (concurrency/admission foundation).
-- Does not activate Redis admission, Worker concurrency, or BullMQ multi-attempt retries.

CREATE TYPE "RefreshAdmissionStatus" AS ENUM (
  'RESERVED',
  'SETTLED',
  'RELEASED',
  'EXPIRED',
  'CANCELLED'
);

CREATE TABLE IF NOT EXISTS "refresh_admissions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "job_id" UUID NOT NULL,
  "character_id" UUID,
  "status" "RefreshAdmissionStatus" NOT NULL,
  "estimated_wcl_points" INTEGER NOT NULL,
  "measured_wcl_points" INTEGER,
  "emergency_override" BOOLEAN NOT NULL DEFAULT false,
  "window_id" TEXT NOT NULL,
  "reserved_at" TIMESTAMPTZ(3) NOT NULL,
  "lease_expires_at" TIMESTAMPTZ(3) NOT NULL,
  "settled_at" TIMESTAMPTZ(3),
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "refresh_admissions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "refresh_admissions_job_id_fkey"
    FOREIGN KEY ("job_id") REFERENCES "ingestion_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "refresh_admissions_character_id_fkey"
    FOREIGN KEY ("character_id") REFERENCES "characters"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "refresh_admissions_job_id_key"
  ON "refresh_admissions"("job_id");

CREATE INDEX IF NOT EXISTS "refresh_admissions_status_reserved_at_idx"
  ON "refresh_admissions"("status", "reserved_at");

CREATE INDEX IF NOT EXISTS "refresh_admissions_window_id_status_idx"
  ON "refresh_admissions"("window_id", "status");

CREATE INDEX IF NOT EXISTS "refresh_admissions_character_id_reserved_at_idx"
  ON "refresh_admissions"("character_id", "reserved_at" DESC);
