-- Production ops (non-transactional). Run only when explicitly approved.
-- CREATE INDEX CONCURRENTLY cannot run inside Prisma migrate deploy transactions.
-- Application search works with the Prisma-migrated name_search_key column + btree
-- even if these concurrent builds are pending or skipped.

-- Optional: enable only when the environment supports pg_trgm and product enables
-- CHARACTER_SEARCH_TRGM_ENABLED=true at deploy time.
-- CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX CONCURRENTLY IF NOT EXISTS characters_name_search_key_btree
  ON characters (name_search_key);

-- CREATE INDEX CONCURRENTLY IF NOT EXISTS characters_name_search_key_trgm
--   ON characters USING gin (name_search_key gin_trgm_ops);

-- CREATE INDEX CONCURRENTLY IF NOT EXISTS characters_normalized_name_trgm
--   ON characters USING gin (normalized_name gin_trgm_ops);
