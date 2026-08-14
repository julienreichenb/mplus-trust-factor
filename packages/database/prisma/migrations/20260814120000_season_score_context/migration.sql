CREATE TYPE "SeasonScoreContextRevisionStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');
-- CharacterScore.composite remains the raw P/S/U/E aggregate.
-- contextual_score stores the clamped post-context final; rows are unique per context revision.

ALTER TABLE "character_scores"
  ADD COLUMN "context_revision_key" TEXT NOT NULL DEFAULT 'none',
  ADD COLUMN "context_revision_id" UUID,
  ADD COLUMN "contextual_score" DOUBLE PRECISION;

DROP INDEX IF EXISTS "character_scores_character_id_season_id_scoring_version_key";

CREATE UNIQUE INDEX "character_scores_ctx_rev_uidx"
  ON "character_scores"("character_id", "season_id", "scoring_version", "context_revision_key");

CREATE INDEX "character_scores_season_id_calculated_at_idx"
  ON "character_scores"("season_id", "calculated_at");

CREATE TABLE "season_median_key_distribution_snapshots" (
    "id" UUID NOT NULL,
    "season_id" UUID NOT NULL,
    "source" TEXT NOT NULL,
    "provenance" JSONB NOT NULL DEFAULT '{}',
    "source_version" TEXT,
    "collected_at" TIMESTAMPTZ(3) NOT NULL,
    "effective_at" TIMESTAMPTZ(3),
    "content_hash" TEXT NOT NULL,
    "points" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "season_median_key_distribution_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "season_median_key_distribution_snapshots_season_id_collected_at_idx"
  ON "season_median_key_distribution_snapshots"("season_id", "collected_at" DESC);

CREATE UNIQUE INDEX "season_median_key_distribution_snapshots_season_id_content_hash_key"
  ON "season_median_key_distribution_snapshots"("season_id", "content_hash");

CREATE TABLE "season_score_context_revisions" (
    "id" UUID NOT NULL,
    "season_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "SeasonScoreContextRevisionStatus" NOT NULL DEFAULT 'DRAFT',
    "distribution_snapshot_id" UUID,
    "tier_factors" JSONB NOT NULL,
    "spec_assignments" JSONB NOT NULL,
    "percentile_anchors" JSONB NOT NULL,
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_at" TIMESTAMPTZ(3),
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "season_score_context_revisions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "season_score_context_revisions_season_id_version_key"
  ON "season_score_context_revisions"("season_id", "version");

CREATE INDEX "season_score_context_revisions_season_id_status_idx"
  ON "season_score_context_revisions"("season_id", "status");

ALTER TABLE "season_median_key_distribution_snapshots"
  ADD CONSTRAINT "season_median_key_distribution_snapshots_season_id_fkey"
  FOREIGN KEY ("season_id") REFERENCES "seasons"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "season_score_context_revisions"
  ADD CONSTRAINT "season_score_context_revisions_season_id_fkey"
  FOREIGN KEY ("season_id") REFERENCES "seasons"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "season_score_context_revisions"
  ADD CONSTRAINT "season_score_context_revisions_distribution_snapshot_id_fkey"
  FOREIGN KEY ("distribution_snapshot_id") REFERENCES "season_median_key_distribution_snapshots"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "season_score_context_revisions"
  ADD CONSTRAINT "season_score_context_revisions_created_by_user_id_fkey"
  FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "character_scores"
  ADD CONSTRAINT "character_scores_context_revision_id_fkey"
  FOREIGN KEY ("context_revision_id") REFERENCES "season_score_context_revisions"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
