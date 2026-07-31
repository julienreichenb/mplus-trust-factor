-- Additive folded search key for public character autocomplete (Scenario A).
-- Concurrent / trigram indexes are created by ops scripts outside this transaction.
ALTER TABLE "characters" ADD COLUMN "name_search_key" TEXT;

-- ASCII-safe backfill; write path maintains foldDiacritics-compatible keys going forward.
UPDATE "characters"
SET "name_search_key" = lower(trim(both from COALESCE("display_name", "normalized_name")))
WHERE "name_search_key" IS NULL;

CREATE INDEX "characters_name_search_key_idx" ON "characters"("name_search_key");
