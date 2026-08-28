-- Phase 3B.5: activation history + at-most-one ACTIVE release.
-- Does not mutate release artifact bytes.

ALTER TABLE "ability_catalog_releases"
  ADD COLUMN IF NOT EXISTS "published_at" TIMESTAMPTZ(3);

CREATE TYPE "AbilityCatalogReleaseActivationType" AS ENUM ('PUBLISH', 'ROLLBACK');

CREATE TABLE IF NOT EXISTS "ability_catalog_release_activations" (
    "id" UUID NOT NULL,
    "release_id" UUID NOT NULL,
    "previous_release_id" UUID,
    "type" "AbilityCatalogReleaseActivationType" NOT NULL,
    "reason" TEXT,
    "notes" TEXT,
    "confirmation_digest" TEXT NOT NULL,
    "activated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activated_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ability_catalog_release_activations_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ability_catalog_release_activations_release_id_activated_at_idx"
  ON "ability_catalog_release_activations" ("release_id", "activated_at" DESC);

CREATE INDEX IF NOT EXISTS "ability_catalog_release_activations_activated_at_idx"
  ON "ability_catalog_release_activations" ("activated_at" DESC);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ability_catalog_release_activations_release_id_fkey'
  ) THEN
    ALTER TABLE "ability_catalog_release_activations"
      ADD CONSTRAINT "ability_catalog_release_activations_release_id_fkey"
      FOREIGN KEY ("release_id") REFERENCES "ability_catalog_releases"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ability_catalog_release_activations_previous_release_id_fkey'
  ) THEN
    ALTER TABLE "ability_catalog_release_activations"
      ADD CONSTRAINT "ability_catalog_release_activations_previous_release_id_fkey"
      FOREIGN KEY ("previous_release_id") REFERENCES "ability_catalog_releases"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ability_catalog_release_activations_activated_by_user_id_fkey'
  ) THEN
    ALTER TABLE "ability_catalog_release_activations"
      ADD CONSTRAINT "ability_catalog_release_activations_activated_by_user_id_fkey"
      FOREIGN KEY ("activated_by_user_id") REFERENCES "users"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- At most one ACTIVE release (partial unique index).
CREATE UNIQUE INDEX IF NOT EXISTS "ability_catalog_releases_one_active_uidx"
  ON "ability_catalog_releases" ("status")
  WHERE "status" = 'ACTIVE';
