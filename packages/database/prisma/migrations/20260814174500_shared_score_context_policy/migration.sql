-- Shared Blizzard-season score-context policy + frozen regional snapshot bindings.

ALTER TABLE "season_score_context_revisions"
  ADD COLUMN "blizzard_season_id" INTEGER;

UPDATE "season_score_context_revisions" r
SET "blizzard_season_id" = s."blizzard_season_id"
FROM "seasons" s
WHERE s."id" = r."season_id";

DELETE FROM "season_score_context_revisions"
WHERE "blizzard_season_id" IS NULL;

-- Keep one revision per (blizzard season, version): prefer PUBLISHED, then lowest version row id.
DELETE FROM "season_score_context_revisions" r
WHERE r."id" NOT IN (
  SELECT DISTINCT ON ("blizzard_season_id", "version") "id"
  FROM "season_score_context_revisions"
  ORDER BY "blizzard_season_id", "version",
    CASE "status" WHEN 'PUBLISHED' THEN 0 WHEN 'DRAFT' THEN 1 ELSE 2 END,
    "created_at" ASC
);

ALTER TABLE "season_score_context_revisions"
  ALTER COLUMN "blizzard_season_id" SET NOT NULL;

CREATE TABLE "score_context_revision_region_snapshots" (
    "id" UUID NOT NULL,
    "revision_id" UUID NOT NULL,
    "region_code" TEXT NOT NULL,
    "distribution_snapshot_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "score_context_revision_region_snapshots_pkey" PRIMARY KEY ("id")
);

INSERT INTO "score_context_revision_region_snapshots" ("id", "revision_id", "region_code", "distribution_snapshot_id")
SELECT gen_random_uuid(), r."id", UPPER(reg."code"), r."distribution_snapshot_id"
FROM "season_score_context_revisions" r
JOIN "season_median_key_distribution_snapshots" snap ON snap."id" = r."distribution_snapshot_id"
JOIN "seasons" s ON s."id" = snap."season_id"
JOIN "regions" reg ON reg."id" = s."region_id"
WHERE r."distribution_snapshot_id" IS NOT NULL;

ALTER TABLE "character_scores"
  ADD COLUMN "context_distribution_snapshot_id" UUID;

-- Reconstruct historical CharacterScore snapshot pins from the pre-split revision column
-- before that column is dropped.
UPDATE "character_scores" cs
SET "context_distribution_snapshot_id" = r."distribution_snapshot_id"
FROM "season_score_context_revisions" r
WHERE cs."context_revision_id" = r."id"
  AND r."distribution_snapshot_id" IS NOT NULL
  AND cs."context_distribution_snapshot_id" IS NULL;

ALTER TABLE "season_score_context_revisions"
  DROP CONSTRAINT IF EXISTS "season_score_context_revisions_distribution_snapshot_id_fkey";

ALTER TABLE "season_score_context_revisions"
  DROP COLUMN IF EXISTS "distribution_snapshot_id";

ALTER TABLE "season_score_context_revisions"
  DROP CONSTRAINT IF EXISTS "season_score_context_revisions_season_id_version_key";

ALTER TABLE "season_score_context_revisions"
  DROP CONSTRAINT IF EXISTS "season_score_context_revisions_season_id_fkey";

ALTER TABLE "season_score_context_revisions"
  ALTER COLUMN "season_id" DROP NOT NULL;

ALTER TABLE "season_score_context_revisions"
  ADD CONSTRAINT "season_score_context_revisions_season_id_fkey"
  FOREIGN KEY ("season_id") REFERENCES "seasons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE UNIQUE INDEX "season_score_context_revisions_blizzard_season_id_version_key"
  ON "season_score_context_revisions"("blizzard_season_id", "version");

CREATE INDEX "season_score_context_revisions_blizzard_season_id_status_idx"
  ON "season_score_context_revisions"("blizzard_season_id", "status");

DROP INDEX IF EXISTS "season_score_context_revisions_season_id_status_idx";

ALTER TABLE "score_context_revision_region_snapshots"
  ADD CONSTRAINT "score_context_revision_region_snapshots_revision_id_fkey"
  FOREIGN KEY ("revision_id") REFERENCES "season_score_context_revisions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "score_context_revision_region_snapshots"
  ADD CONSTRAINT "score_context_revision_region_snapshots_distribution_snapshot_id_fkey"
  FOREIGN KEY ("distribution_snapshot_id") REFERENCES "season_median_key_distribution_snapshots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "score_context_revision_region_snapshots_revision_id_region_code_key"
  ON "score_context_revision_region_snapshots"("revision_id", "region_code");

CREATE INDEX "score_context_revision_region_snapshots_distribution_snapshot_id_idx"
  ON "score_context_revision_region_snapshots"("distribution_snapshot_id");

ALTER TABLE "character_scores"
  ADD CONSTRAINT "character_scores_context_distribution_snapshot_id_fkey"
  FOREIGN KEY ("context_distribution_snapshot_id") REFERENCES "season_median_key_distribution_snapshots"("id") ON DELETE SET NULL ON UPDATE CASCADE;
