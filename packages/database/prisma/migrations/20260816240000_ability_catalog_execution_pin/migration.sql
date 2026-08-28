-- Phase 3B.4: persist ability catalog execution pin on score outputs.
-- Does NOT create AbilityCatalogReleaseActivation.
-- Legacy rows remain STATIC with execution_key = 'static'.

ALTER TABLE "score_snapshots"
  ADD COLUMN IF NOT EXISTS "ability_catalog_execution_mode" TEXT,
  ADD COLUMN IF NOT EXISTS "ability_catalog_version_id" TEXT,
  ADD COLUMN IF NOT EXISTS "ability_catalog_release_id" UUID,
  ADD COLUMN IF NOT EXISTS "ability_catalog_content_digest" TEXT,
  ADD COLUMN IF NOT EXISTS "ability_catalog_release_key" TEXT;

ALTER TABLE "character_scores"
  ADD COLUMN IF NOT EXISTS "ability_catalog_execution_mode" TEXT NOT NULL DEFAULT 'STATIC',
  ADD COLUMN IF NOT EXISTS "ability_catalog_execution_key" TEXT NOT NULL DEFAULT 'static',
  ADD COLUMN IF NOT EXISTS "ability_catalog_version_id" TEXT,
  ADD COLUMN IF NOT EXISTS "ability_catalog_release_id" UUID,
  ADD COLUMN IF NOT EXISTS "ability_catalog_content_digest" TEXT,
  ADD COLUMN IF NOT EXISTS "ability_catalog_release_key" TEXT;

-- Replace unique constraint to include execution key (STATIC vs RELEASE coexist).
ALTER TABLE "character_scores" DROP CONSTRAINT IF EXISTS "character_scores_ctx_rev_uidx";
DROP INDEX IF EXISTS "character_scores_ctx_rev_uidx";

CREATE UNIQUE INDEX IF NOT EXISTS "character_scores_ctx_rev_exec_uidx"
  ON "character_scores" ("character_id", "season_id", "scoring_version", "context_revision_key", "ability_catalog_execution_key");

CREATE INDEX IF NOT EXISTS "score_snapshots_ability_catalog_release_id_idx"
  ON "score_snapshots" ("ability_catalog_release_id");

CREATE INDEX IF NOT EXISTS "character_scores_ability_catalog_release_id_idx"
  ON "character_scores" ("ability_catalog_release_id");

ALTER TABLE "score_snapshots"
  DROP CONSTRAINT IF EXISTS "score_snapshots_ability_catalog_release_id_fkey";
ALTER TABLE "score_snapshots"
  ADD CONSTRAINT "score_snapshots_ability_catalog_release_id_fkey"
  FOREIGN KEY ("ability_catalog_release_id") REFERENCES "ability_catalog_releases"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "character_scores"
  DROP CONSTRAINT IF EXISTS "character_scores_ability_catalog_release_id_fkey";
ALTER TABLE "character_scores"
  ADD CONSTRAINT "character_scores_ability_catalog_release_id_fkey"
  FOREIGN KEY ("ability_catalog_release_id") REFERENCES "ability_catalog_releases"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Soft check: RELEASE mode requires release id (enforced in app; DB CHECK optional for PG).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'character_scores_release_pin_chk'
  ) THEN
    ALTER TABLE "character_scores"
      ADD CONSTRAINT "character_scores_release_pin_chk"
      CHECK (
        ("ability_catalog_execution_mode" <> 'RELEASE')
        OR (
          "ability_catalog_release_id" IS NOT NULL
          AND "ability_catalog_content_digest" IS NOT NULL
        )
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'score_snapshots_release_pin_chk'
  ) THEN
    ALTER TABLE "score_snapshots"
      ADD CONSTRAINT "score_snapshots_release_pin_chk"
      CHECK (
        ("ability_catalog_execution_mode" IS NULL)
        OR ("ability_catalog_execution_mode" <> 'RELEASE')
        OR (
          "ability_catalog_release_id" IS NOT NULL
          AND "ability_catalog_content_digest" IS NOT NULL
        )
      );
  END IF;
END $$;
