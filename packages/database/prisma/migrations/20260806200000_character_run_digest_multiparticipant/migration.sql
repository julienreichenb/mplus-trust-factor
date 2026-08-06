-- Persist CharacterRunDigest for all fight participants.
-- Identity becomes raw_run_id + participant_actor_id + extractor_version.
-- character_id is an optional link to an internal Character (never auto-created).

-- 1. Add participant identity columns (participant_actor_id nullable until backfill).
ALTER TABLE "character_run_digests"
  ADD COLUMN "participant_actor_id" INTEGER,
  ADD COLUMN "character_name" TEXT,
  ADD COLUMN "realm_slug" TEXT,
  ADD COLUMN "region_code" TEXT,
  ADD COLUMN "class_slug" TEXT,
  ADD COLUMN "spec_slug" TEXT,
  ADD COLUMN "role" TEXT;

-- 2. Make character_id nullable (drop NOT NULL + recreate FK with ON DELETE SET NULL).
ALTER TABLE "character_run_digests"
  DROP CONSTRAINT "character_run_digests_character_id_fkey";

ALTER TABLE "character_run_digests"
  ALTER COLUMN "character_id" DROP NOT NULL;

ALTER TABLE "character_run_digests"
  ADD CONSTRAINT "character_run_digests_character_id_fkey"
  FOREIGN KEY ("character_id") REFERENCES "characters"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- 3. Backfill identity columns from embedded digest / top-level source_metadata.
UPDATE "character_run_digests"
SET
  "participant_actor_id" = COALESCE(
    CASE
      WHEN ("source_metadata"->'digest'->>'participantActorId') ~ '^[1-9][0-9]*$'
        THEN ("source_metadata"->'digest'->>'participantActorId')::integer
      ELSE NULL
    END,
    CASE
      WHEN ("source_metadata"->>'participantActorId') ~ '^[1-9][0-9]*$'
        THEN ("source_metadata"->>'participantActorId')::integer
      ELSE NULL
    END
  ),
  "character_name" = COALESCE(
    NULLIF(trim("source_metadata"->'digest'->>'characterName'), ''),
    NULLIF(trim("source_metadata"->>'characterName'), '')
  ),
  "realm_slug" = CASE
    WHEN lower(COALESCE("source_metadata"->'digest'->>'realmSlug', '')) IN ('', 'unknown')
      THEN NULL
    ELSE NULLIF(trim("source_metadata"->'digest'->>'realmSlug'), '')
  END,
  "region_code" = CASE
    WHEN lower(COALESCE("source_metadata"->'digest'->>'regionCode', '')) IN ('', 'unknown')
      THEN NULL
    ELSE NULLIF(trim("source_metadata"->'digest'->>'regionCode'), '')
  END,
  "class_slug" = NULLIF(trim("source_metadata"->'digest'->>'classSlug'), ''),
  "spec_slug" = NULLIF(trim("source_metadata"->'digest'->>'specSlug'), ''),
  "role" = NULLIF(trim("source_metadata"->'digest'->>'role'), '');

-- 4. Refuse unsafe migration: never fabricate actor IDs or character names.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "character_run_digests"
    WHERE "participant_actor_id" IS NULL
  ) THEN
    RAISE EXCEPTION
      'character_run_digests migration failed: one or more rows lack participant_actor_id in source_metadata.digest (or source_metadata.participantActorId). Reset the development database or repair rows before migrating. Actor IDs are never fabricated.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "character_run_digests"
    WHERE "character_name" IS NULL OR trim("character_name") = ''
  ) THEN
    RAISE EXCEPTION
      'character_run_digests migration failed: one or more rows lack character_name in source_metadata.digest. Reset the development database or repair rows before migrating.';
  END IF;
END $$;

ALTER TABLE "character_run_digests"
  ALTER COLUMN "participant_actor_id" SET NOT NULL,
  ALTER COLUMN "character_name" SET NOT NULL;

-- 5. Replace uniqueness: actor-scoped instead of character-scoped.
DROP INDEX IF EXISTS "character_run_digests_raw_run_id_character_id_extractor_version_key";

CREATE UNIQUE INDEX "character_run_digests_raw_run_actor_extractor_key"
  ON "character_run_digests"("raw_run_id", "participant_actor_id", "extractor_version");

-- 6. Lookup indexes for optional Character link and name/realm/region matching.
CREATE INDEX IF NOT EXISTS "character_run_digests_character_id_idx"
  ON "character_run_digests"("character_id");

CREATE INDEX "character_run_digests_region_code_realm_slug_character_name_idx"
  ON "character_run_digests"("region_code", "realm_slug", "character_name");
