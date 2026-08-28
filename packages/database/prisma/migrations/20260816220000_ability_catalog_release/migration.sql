-- Ability catalog immutable release persistence (Phase 3B.2).
-- No activation table. ACTIVE/SUPERSEDED reserved for later; unused by 3B.2 code paths.

CREATE TYPE "AbilityCatalogReleaseStatus" AS ENUM ('DRAFT_BUILD', 'VALIDATED', 'REJECTED', 'ACTIVE', 'SUPERSEDED');

CREATE TABLE "ability_catalog_releases" (
    "id" UUID NOT NULL,
    "release_key" TEXT NOT NULL,
    "schema_version" TEXT NOT NULL,
    "content_digest" TEXT NOT NULL,
    "topology_digest" TEXT NOT NULL,
    "cas_content_hash" TEXT NOT NULL,
    "game_version" TEXT NOT NULL,
    "wow_build" TEXT NOT NULL,
    "season_slug" TEXT NOT NULL,
    "previous_release_id" UUID,
    "artifact_id" UUID NOT NULL,
    "rule_count" INTEGER NOT NULL,
    "class_count" INTEGER NOT NULL,
    "spec_count" INTEGER NOT NULL,
    "race_count" INTEGER NOT NULL,
    "status" "AbilityCatalogReleaseStatus" NOT NULL,
    "manifest" JSONB NOT NULL,
    "diff" JSONB NOT NULL,
    "notes" TEXT,
    "generated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_user_id" UUID,
    "validated_at" TIMESTAMPTZ(3),
    "validation_status" TEXT,
    "validation_error_count" INTEGER,
    "validation_warning_count" INTEGER,
    "validation_report_digest" TEXT,
    "validation_report_artifact_id" UUID,
    "validator_version" TEXT,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ability_catalog_releases_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ability_catalog_releases_release_key_key" ON "ability_catalog_releases"("release_key");
CREATE UNIQUE INDEX "ability_catalog_releases_content_digest_key" ON "ability_catalog_releases"("content_digest");
CREATE INDEX "ability_catalog_releases_status_created_at_idx" ON "ability_catalog_releases"("status", "created_at" DESC);
CREATE INDEX "ability_catalog_releases_wow_build_created_at_idx" ON "ability_catalog_releases"("wow_build", "created_at" DESC);
CREATE INDEX "ability_catalog_releases_previous_release_id_idx" ON "ability_catalog_releases"("previous_release_id");

ALTER TABLE "ability_catalog_releases" ADD CONSTRAINT "ability_catalog_releases_previous_release_id_fkey" FOREIGN KEY ("previous_release_id") REFERENCES "ability_catalog_releases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ability_catalog_releases" ADD CONSTRAINT "ability_catalog_releases_artifact_id_fkey" FOREIGN KEY ("artifact_id") REFERENCES "raw_artifacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ability_catalog_releases" ADD CONSTRAINT "ability_catalog_releases_validation_report_artifact_id_fkey" FOREIGN KEY ("validation_report_artifact_id") REFERENCES "raw_artifacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ability_catalog_releases" ADD CONSTRAINT "ability_catalog_releases_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
