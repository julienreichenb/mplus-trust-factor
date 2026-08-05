-- Scoring V2 run orchestration: durable capability package + participant digest indexes.

CREATE TABLE "capability_evidence_package_records" (
    "id" UUID NOT NULL,
    "compatibility_key" TEXT NOT NULL,
    "report_code" TEXT NOT NULL,
    "fight_id" INTEGER NOT NULL,
    "report_revision" INTEGER NOT NULL,
    "actor_set_hash" TEXT NOT NULL,
    "ability_filter_hash" TEXT NOT NULL,
    "catalog_version" TEXT NOT NULL,
    "acquisition_plan_version" TEXT NOT NULL,
    "graphql_query_version" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "content_hash" TEXT NOT NULL,
    "artifact_id" UUID NOT NULL,
    "participant_actor_ids" JSONB NOT NULL DEFAULT '[]',
    "complete" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "capability_evidence_package_records_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "capability_evidence_package_records_compatibility_key_key"
  ON "capability_evidence_package_records"("compatibility_key");

CREATE INDEX "capability_evidence_package_records_report_code_fight_id_report_revision_idx"
  ON "capability_evidence_package_records"("report_code", "fight_id", "report_revision");

CREATE INDEX "capability_evidence_package_records_content_hash_idx"
  ON "capability_evidence_package_records"("content_hash");

ALTER TABLE "capability_evidence_package_records"
  ADD CONSTRAINT "capability_evidence_package_records_artifact_id_fkey"
  FOREIGN KEY ("artifact_id") REFERENCES "raw_artifacts"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "participant_scoring_digests" (
    "id" UUID NOT NULL,
    "compatibility_key" TEXT NOT NULL,
    "report_code" TEXT NOT NULL,
    "fight_id" INTEGER NOT NULL,
    "report_revision" INTEGER NOT NULL,
    "participant_actor_id" INTEGER NOT NULL,
    "character_id" UUID,
    "digest_schema_version" TEXT NOT NULL,
    "extractor_compat_version" TEXT NOT NULL,
    "catalog_version" TEXT NOT NULL,
    "capability_package_content_hash" TEXT NOT NULL,
    "capability_package_artifact_id" TEXT NOT NULL,
    "content_hash" TEXT NOT NULL,
    "artifact_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "participant_scoring_digests_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "participant_scoring_digests_compatibility_key_key"
  ON "participant_scoring_digests"("compatibility_key");

CREATE INDEX "participant_scoring_digests_report_code_fight_id_report_revision_participant_actor_id_idx"
  ON "participant_scoring_digests"("report_code", "fight_id", "report_revision", "participant_actor_id");

CREATE INDEX "participant_scoring_digests_capability_package_content_hash_idx"
  ON "participant_scoring_digests"("capability_package_content_hash");

CREATE INDEX "participant_scoring_digests_character_id_idx"
  ON "participant_scoring_digests"("character_id");

CREATE INDEX "participant_scoring_digests_content_hash_idx"
  ON "participant_scoring_digests"("content_hash");

ALTER TABLE "participant_scoring_digests"
  ADD CONSTRAINT "participant_scoring_digests_artifact_id_fkey"
  FOREIGN KEY ("artifact_id") REFERENCES "raw_artifacts"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "participant_scoring_digests"
  ADD CONSTRAINT "participant_scoring_digests_character_id_fkey"
  FOREIGN KEY ("character_id") REFERENCES "characters"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
