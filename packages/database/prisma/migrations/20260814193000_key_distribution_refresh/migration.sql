-- Background Raider.IO addon median-key distribution refresh status (not character scoring).
CREATE TABLE "score_context_key_distribution_refreshes" (
    "id" UUID NOT NULL,
    "season_id" UUID NOT NULL,
    "region" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "error_message" TEXT,
    "snapshot_id" UUID,
    "requested_by_user_id" UUID,
    "started_at" TIMESTAMPTZ(3),
    "finished_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "score_context_key_distribution_refreshes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "score_context_key_distribution_refreshes_season_id_created_at_idx"
  ON "score_context_key_distribution_refreshes"("season_id", "created_at" DESC);

ALTER TABLE "score_context_key_distribution_refreshes"
  ADD CONSTRAINT "score_context_key_distribution_refreshes_season_id_fkey"
  FOREIGN KEY ("season_id") REFERENCES "seasons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "score_context_key_distribution_refreshes"
  ADD CONSTRAINT "score_context_key_distribution_refreshes_snapshot_id_fkey"
  FOREIGN KEY ("snapshot_id") REFERENCES "season_median_key_distribution_snapshots"("id") ON DELETE SET NULL ON UPDATE CASCADE;
