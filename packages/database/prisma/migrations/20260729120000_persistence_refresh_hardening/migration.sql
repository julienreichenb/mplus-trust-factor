-- Persistence refresh hardening (part 1): enum values and columns.
-- Enum values must be committed before use — see part 2 migration.

ALTER TYPE "ScorePublicationStatus" ADD VALUE IF NOT EXISTS 'CANDIDATE';
ALTER TYPE "ScorePublicationStatus" ADD VALUE IF NOT EXISTS 'PUBLISHED';
ALTER TYPE "ScorePublicationStatus" ADD VALUE IF NOT EXISTS 'REJECTED_INCOMPLETE';

ALTER TABLE "score_snapshots"
  ADD COLUMN IF NOT EXISTS "refresh_contract_hash" TEXT,
  ADD COLUMN IF NOT EXISTS "provider_data_as_of" TIMESTAMPTZ(3),
  ADD COLUMN IF NOT EXISTS "coverage_state" TEXT,
  ADD COLUMN IF NOT EXISTS "rejection_reason" TEXT,
  ADD COLUMN IF NOT EXISTS "published_at" TIMESTAMPTZ(3);

ALTER TABLE "metric_observations"
  ADD COLUMN IF NOT EXISTS "observation_key" TEXT,
  ADD COLUMN IF NOT EXISTS "analysis_version" TEXT,
  ADD COLUMN IF NOT EXISTS "schema_version" TEXT,
  ADD COLUMN IF NOT EXISTS "source_payload_fingerprint" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "metric_observations_character_season_key_unique"
  ON "metric_observations" ("character_id", "season_id", "observation_key")
  WHERE "observation_key" IS NOT NULL;

CREATE TABLE IF NOT EXISTS "character_published_scores" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "character_id" UUID NOT NULL,
  "season_id" UUID NOT NULL,
  "score_model_id" UUID NOT NULL,
  "scope_type" "ScopeType" NOT NULL,
  "scope_key" TEXT,
  "published_snapshot_id" UUID NOT NULL,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "character_published_scores_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "character_published_scores_character_id_fkey"
    FOREIGN KEY ("character_id") REFERENCES "characters"("id") ON DELETE CASCADE,
  CONSTRAINT "character_published_scores_season_id_fkey"
    FOREIGN KEY ("season_id") REFERENCES "seasons"("id") ON DELETE CASCADE,
  CONSTRAINT "character_published_scores_published_snapshot_id_fkey"
    FOREIGN KEY ("published_snapshot_id") REFERENCES "score_snapshots"("id") ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS "character_published_scores_scope_unique"
  ON "character_published_scores" ("character_id", "season_id", "score_model_id", "scope_type", "scope_key");
