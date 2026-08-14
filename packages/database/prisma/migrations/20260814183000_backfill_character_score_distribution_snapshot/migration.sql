-- For databases that already applied the shared-policy split after the old
-- revision.distribution_snapshot_id column was dropped: reconstruct from the
-- frozen regional bindings copied during that split.
UPDATE "character_scores" cs
SET "context_distribution_snapshot_id" = bind."distribution_snapshot_id"
FROM "score_context_revision_region_snapshots" bind,
     "seasons" s,
     "regions" reg
WHERE cs."context_revision_id" = bind."revision_id"
  AND s."id" = cs."season_id"
  AND reg."id" = s."region_id"
  AND UPPER(bind."region_code") = UPPER(reg."code")
  AND cs."context_distribution_snapshot_id" IS NULL;
