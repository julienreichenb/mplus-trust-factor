-- M2: persist CAS byte digest alongside logical frozen bundle content hash.
-- Additive only.

ALTER TABLE "scoring_v2_evidence_exports"
  ADD COLUMN IF NOT EXISTS "frozen_bundle_byte_digest" TEXT;
