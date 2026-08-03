-- B3 / M3: deterministic evidence export identity + recovery lease fields.
-- Additive only; do not recreate ScoringV2EvidenceExportStatus.

ALTER TYPE "ScoringV2EvidenceExportStatus" ADD VALUE IF NOT EXISTS 'RETRYABLE';

ALTER TABLE "scoring_v2_evidence_exports"
  ADD COLUMN "generated_at" TIMESTAMPTZ(3),
  ADD COLUMN "evidence_cutoff_at" TIMESTAMPTZ(3),
  ADD COLUMN "attempt" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lease_owner" TEXT,
  ADD COLUMN "lease_expires_at" TIMESTAMPTZ(3),
  ADD COLUMN "heartbeat_at" TIMESTAMPTZ(3),
  ADD COLUMN "artifact_set_hash" TEXT,
  ADD COLUMN "freeze_snapshot" JSONB;

CREATE INDEX "scoring_v2_evidence_exports_status_lease_expires_at_idx"
  ON "scoring_v2_evidence_exports"("status", "lease_expires_at");
