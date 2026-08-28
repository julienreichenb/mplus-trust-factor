-- Ability catalog release replay (Phase 3B.3). Shadow/diagnostic only.
-- No activation. Does not mutate ScoreSnapshot / Trust / profiles.

CREATE TYPE "AbilityCatalogReleaseReplayStatus" AS ENUM ('PENDING', 'RUNNING', 'PASSED', 'FAILED');
CREATE TYPE "AbilityCatalogReplayBaseKind" AS ENUM ('STATIC', 'RELEASE');

CREATE TABLE "ability_catalog_release_replays" (
    "id" UUID NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "base_kind" "AbilityCatalogReplayBaseKind" NOT NULL,
    "base_release_id" UUID,
    "candidate_release_id" UUID NOT NULL,
    "corpus_digest" TEXT NOT NULL,
    "replay_input_digest" TEXT NOT NULL,
    "replay_engine_version" TEXT NOT NULL,
    "status" "AbilityCatalogReleaseReplayStatus" NOT NULL,
    "report_artifact_id" UUID,
    "report_digest" TEXT,
    "summary" JSONB NOT NULL,
    "timing" JSONB,
    "error_summary" TEXT,
    "created_by_user_id" UUID,
    "started_at" TIMESTAMPTZ(3) NOT NULL,
    "completed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ability_catalog_release_replays_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ability_catalog_release_replays_idempotency_key_key" ON "ability_catalog_release_replays"("idempotency_key");
CREATE INDEX "ability_catalog_release_replays_candidate_release_id_created_at_idx" ON "ability_catalog_release_replays"("candidate_release_id", "created_at" DESC);
CREATE INDEX "ability_catalog_release_replays_base_release_id_candidate_release_id_idx" ON "ability_catalog_release_replays"("base_release_id", "candidate_release_id");
CREATE INDEX "ability_catalog_release_replays_status_created_at_idx" ON "ability_catalog_release_replays"("status", "created_at" DESC);

ALTER TABLE "ability_catalog_release_replays" ADD CONSTRAINT "ability_catalog_release_replays_base_release_id_fkey" FOREIGN KEY ("base_release_id") REFERENCES "ability_catalog_releases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ability_catalog_release_replays" ADD CONSTRAINT "ability_catalog_release_replays_candidate_release_id_fkey" FOREIGN KEY ("candidate_release_id") REFERENCES "ability_catalog_releases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ability_catalog_release_replays" ADD CONSTRAINT "ability_catalog_release_replays_report_artifact_id_fkey" FOREIGN KEY ("report_artifact_id") REFERENCES "raw_artifacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ability_catalog_release_replays" ADD CONSTRAINT "ability_catalog_release_replays_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
