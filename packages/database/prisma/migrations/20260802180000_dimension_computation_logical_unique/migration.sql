-- Scoring V2: enforce one DimensionComputation per logical identity.
-- input_fingerprint remains content integrity, not part of the unique key.
--
-- Safety:
-- - Fails closed if logical duplicates already exist (no silent delete/rewrite).
-- - Additive index swap only; does not mutate row payloads.
-- - Not run automatically by agents; apply via normal migrate deploy when ready.

DO $$
DECLARE
  dup_count integer;
BEGIN
  SELECT COUNT(*) INTO dup_count
  FROM (
    SELECT 1
    FROM "dimension_computations"
    GROUP BY "character_id", "season_id", "manifest_id", "score_model_id", "dimension"
    HAVING COUNT(*) > 1
  ) dups;

  IF dup_count > 0 THEN
    RAISE EXCEPTION
      'dimension_computations logical uniqueness migration blocked: % duplicate logical identity group(s) exist — resolve manually before applying',
      dup_count;
  END IF;
END $$;

DROP INDEX IF EXISTS "dimension_computations_identity_key";

CREATE UNIQUE INDEX "dimension_computations_logical_identity_key"
  ON "dimension_computations"(
    "character_id",
    "season_id",
    "manifest_id",
    "score_model_id",
    "dimension"
  );

CREATE INDEX IF NOT EXISTS "dimension_computations_input_fingerprint_idx"
  ON "dimension_computations"("input_fingerprint");
