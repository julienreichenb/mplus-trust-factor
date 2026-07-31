-- Additive folded search key for public character autocomplete (Scenario A).
-- Concurrent / optional trigram indexes are created by ops scripts outside this transaction.
ALTER TABLE "characters" ADD COLUMN "name_search_key" TEXT;

-- Provisional ASCII-only seed (lower/trim). This is NOT foldDiacritics-compatible:
-- accented names such as "Chérith" stay "chérith" here and will miss folded queries
-- like "cherith" until the app backfill runs.
-- Required after migrate deploy:
--   pnpm db:backfill:character-name-search-key
-- Write paths (upsertCharacter / applyProviderProfile) maintain normalizeCharacterSearchKey().
UPDATE "characters"
SET "name_search_key" = lower(trim(both from COALESCE("display_name", "normalized_name")))
WHERE "name_search_key" IS NULL;

CREATE INDEX "characters_name_search_key_idx" ON "characters"("name_search_key");
