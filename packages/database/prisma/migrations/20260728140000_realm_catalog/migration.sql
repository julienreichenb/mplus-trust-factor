-- Extend realms for Blizzard-sourced retail catalog sync.
ALTER TABLE "realms" ADD COLUMN "name_normalized" TEXT;
ALTER TABLE "realms" ADD COLUMN "timezone" TEXT;
ALTER TABLE "realms" ADD COLUMN "category" TEXT;
ALTER TABLE "realms" ADD COLUMN "is_tournament" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "realms" ADD COLUMN "is_active" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "realms" ADD COLUMN "last_synced_at" TIMESTAMPTZ(3);

-- Backfill normalized names from existing display names (accent-insensitive fold done in app; ASCII-safe here).
UPDATE "realms"
SET "name_normalized" = lower(trim(both from "name"))
WHERE "name_normalized" IS NULL;

CREATE INDEX "realms_name_normalized_idx" ON "realms"("name_normalized");
CREATE INDEX "realms_is_active_is_tournament_idx" ON "realms"("is_active", "is_tournament");
