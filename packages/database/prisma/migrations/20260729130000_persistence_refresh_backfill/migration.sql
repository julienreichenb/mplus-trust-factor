-- Persistence refresh hardening (part 2): backfill after enum values are committed.

UPDATE "score_snapshots"
SET "publication_status" = 'PUBLISHED',
    "published_at" = COALESCE("published_at", "calculated_at")
WHERE "publication_status" = 'PUBLIC' AND "is_public" = true;

INSERT INTO "character_published_scores" (
  "character_id", "season_id", "score_model_id", "scope_type", "scope_key", "published_snapshot_id"
)
SELECT DISTINCT ON (s."character_id", s."season_id", s."score_model_id", s."scope_type", s."scope_key")
  s."character_id",
  s."season_id",
  s."score_model_id",
  s."scope_type",
  s."scope_key",
  s."id"
FROM "score_snapshots" s
WHERE s."is_public" = true
  AND s."publication_status" IN ('PUBLIC', 'PUBLISHED')
ORDER BY s."character_id", s."season_id", s."score_model_id", s."scope_type", s."scope_key", s."calculated_at" DESC
ON CONFLICT DO NOTHING;
