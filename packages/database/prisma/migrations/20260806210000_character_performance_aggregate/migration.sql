-- Character/season WCL points_and_damage Performance aggregate cache.
-- Not fight-local; does not migrate RunRankingFact rows.

CREATE TABLE "character_performance_aggregates" (
    "id" UUID NOT NULL,
    "character_id" UUID NOT NULL,
    "season_id" UUID NOT NULL,
    "zone_id" INTEGER NOT NULL,
    "partition_key" TEXT NOT NULL,
    "ranking_version" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "raw_payload" JSONB NOT NULL,
    "dungeon_aggregates" JSONB NOT NULL,
    "global_summary" JSONB,
    "diagnostics" JSONB NOT NULL,
    "content_hash" TEXT NOT NULL,
    "source_request_fingerprint" TEXT NOT NULL,
    "fetched_at" TIMESTAMPTZ(3) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "character_performance_aggregates_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "character_performance_aggregates_identity_key"
  ON "character_performance_aggregates"("character_id", "season_id", "zone_id", "partition_key", "ranking_version");

CREATE INDEX "character_performance_aggregates_character_id_season_id_idx"
  ON "character_performance_aggregates"("character_id", "season_id");

CREATE INDEX "character_performance_aggregates_expires_at_idx"
  ON "character_performance_aggregates"("expires_at");

ALTER TABLE "character_performance_aggregates"
  ADD CONSTRAINT "character_performance_aggregates_character_id_fkey"
  FOREIGN KEY ("character_id") REFERENCES "characters"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "character_performance_aggregates"
  ADD CONSTRAINT "character_performance_aggregates_season_id_fkey"
  FOREIGN KEY ("season_id") REFERENCES "seasons"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
