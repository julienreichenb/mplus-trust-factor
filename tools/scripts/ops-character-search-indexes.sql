-- Optional character-search indexes (non-transactional). Run only when explicitly approved.
-- CREATE INDEX CONCURRENTLY cannot run inside Prisma migrate deploy transactions.
--
-- The Prisma migration already creates a normal btree on name_search_key
-- (characters_name_search_key_idx). Do not recreate that btree here.
--
-- Application search works with the migrated column + Prisma btree even if these
-- optional concurrent builds are pending or skipped.
--
-- Trigram / pg_trgm is deferred (not part of V1). Enable only after a dedicated
-- product/ops change that ships a gated query path and tests.

-- CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- CREATE INDEX CONCURRENTLY IF NOT EXISTS characters_name_search_key_trgm
--   ON characters USING gin (name_search_key gin_trgm_ops);

-- CREATE INDEX CONCURRENTLY IF NOT EXISTS characters_normalized_name_trgm
--   ON characters USING gin (normalized_name gin_trgm_ops);
