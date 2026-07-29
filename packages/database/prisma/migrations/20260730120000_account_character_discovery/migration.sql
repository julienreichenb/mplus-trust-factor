-- Account character discovery: relevance + discovery provenance on ownership / Battle.net account

ALTER TABLE "battlenet_accounts"
  ADD COLUMN IF NOT EXISTS "last_discovery_job_id" UUID,
  ADD COLUMN IF NOT EXISTS "last_discovery_status" TEXT,
  ADD COLUMN IF NOT EXISTS "last_discovery_started_at" TIMESTAMPTZ(3),
  ADD COLUMN IF NOT EXISTS "last_discovery_finished_at" TIMESTAMPTZ(3),
  ADD COLUMN IF NOT EXISTS "last_discovery_error" TEXT,
  ADD COLUMN IF NOT EXISTS "last_discovery_counters" JSONB,
  ADD COLUMN IF NOT EXISTS "last_discovery_ownership_sync_at" TIMESTAMPTZ(3);

ALTER TABLE "verified_character_ownerships"
  ADD COLUMN IF NOT EXISTS "relevance_policy_version" TEXT,
  ADD COLUMN IF NOT EXISTS "relevance_eligible" BOOLEAN,
  ADD COLUMN IF NOT EXISTS "relevance_reasons" JSONB,
  ADD COLUMN IF NOT EXISTS "relevance_evaluated_at" TIMESTAMPTZ(3),
  ADD COLUMN IF NOT EXISTS "current_season_mythic_rating" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "current_season_mythic_season_id" TEXT,
  ADD COLUMN IF NOT EXISTS "current_season_mythic_fetched_at" TIMESTAMPTZ(3),
  ADD COLUMN IF NOT EXISTS "current_season_mythic_source" TEXT,
  ADD COLUMN IF NOT EXISTS "current_season_mythic_state" TEXT;

CREATE INDEX IF NOT EXISTS "verified_character_ownerships_user_id_relevance_eligible_idx"
  ON "verified_character_ownerships"("user_id", "relevance_eligible");
