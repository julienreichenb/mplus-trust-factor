-- Enable pg_trgm for bounded typo-tolerant public character autocomplete.
-- Fail closed during migrate if the role cannot create extensions (do not ship a
-- silent non-functional fuzzy path). Regular CREATE INDEX (not CONCURRENTLY) so
-- Prisma's transactional migrate deploy can apply this safely.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- GIN trigram index on the accent-folded search key. Write paths already maintain
-- name_search_key via normalizeCharacterSearchKey (foldDiacritics). Existing rows
-- keep working; incomplete keys are fixed by pnpm db:backfill:character-name-search-key.
CREATE INDEX IF NOT EXISTS "characters_name_search_key_trgm"
  ON "characters" USING gin ("name_search_key" gin_trgm_ops);
