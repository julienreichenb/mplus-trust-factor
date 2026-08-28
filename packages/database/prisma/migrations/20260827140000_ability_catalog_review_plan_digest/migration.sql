-- Review plan digest vs source report digest lifecycle.
-- report_digest is no longer unique (same source may produce successive plans).
-- review_plan_digest is the idempotency key for normalized review semantics.

ALTER TABLE "ability_catalog_review_batches"
  ADD COLUMN IF NOT EXISTS "review_plan_digest" TEXT;

-- Backfill unique legacy digests for existing rows (content-derived placeholder until next import rebuild).
UPDATE "ability_catalog_review_batches"
SET "review_plan_digest" = encode(sha256(('legacy-review-plan:' || "id" || ':' || "report_digest")::bytea), 'hex')
WHERE "review_plan_digest" IS NULL;

ALTER TABLE "ability_catalog_review_batches"
  ALTER COLUMN "review_plan_digest" SET NOT NULL;

DROP INDEX IF EXISTS "ability_catalog_review_batches_report_digest_key";

CREATE UNIQUE INDEX IF NOT EXISTS "ability_catalog_review_batches_review_plan_digest_key"
  ON "ability_catalog_review_batches"("review_plan_digest");

CREATE INDEX IF NOT EXISTS "ability_catalog_review_batches_report_digest_idx"
  ON "ability_catalog_review_batches"("report_digest");
