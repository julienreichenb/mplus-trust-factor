-- Scoring V2 Shadow Canary: durable WCL source digests, dataset pages, roster, canary runs.

ALTER TABLE "evidence_datasets" ADD COLUMN "digest_id" UUID;

CREATE TABLE "evidence_dataset_pages" (
    "id" UUID NOT NULL,
    "dataset_id" UUID,
    "report_code" TEXT NOT NULL,
    "fight_id" INTEGER NOT NULL,
    "report_revision" INTEGER NOT NULL,
    "dataset_key" TEXT NOT NULL,
    "page_index" INTEGER NOT NULL,
    "page_cursor" TEXT,
    "artifact_id" UUID NOT NULL,
    "content_hash" TEXT NOT NULL,
    "provider_contract_version" TEXT NOT NULL,
    "schema_version" TEXT NOT NULL,
    "event_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "evidence_dataset_pages_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "wcl_run_source_digests" (
    "id" UUID NOT NULL,
    "report_code" TEXT NOT NULL,
    "fight_id" INTEGER NOT NULL,
    "report_revision" INTEGER NOT NULL,
    "schema_version" TEXT NOT NULL,
    "provider_contract_version" TEXT NOT NULL,
    "content_fingerprint" TEXT NOT NULL,
    "digest" JSONB NOT NULL,
    "raw_bytes_stored" BIGINT,
    "digest_bytes" INTEGER,
    "completeness_state" TEXT NOT NULL,
    "visibility_state" TEXT NOT NULL,
    "region" TEXT,
    "dungeon_slug" TEXT,
    "key_level" INTEGER,
    "timed" BOOLEAN,
    "master_data_artifact_id" UUID,
    "acquired_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "wcl_run_source_digests_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "wcl_run_participants" (
    "id" UUID NOT NULL,
    "digest_id" UUID NOT NULL,
    "wcl_actor_id" INTEGER NOT NULL,
    "wcl_canonical_id" TEXT,
    "character_name" TEXT NOT NULL,
    "realm_slug" TEXT NOT NULL,
    "region_code" TEXT NOT NULL,
    "class_slug" TEXT,
    "spec_slug" TEXT,
    "role" TEXT,
    "character_id" UUID,
    "blizzard_character_id" TEXT,
    "mapping_state" TEXT NOT NULL DEFAULT 'UNRESOLVED',
    "mapping_confidence" DOUBLE PRECISION,
    "owned_pet_actor_ids" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "wcl_run_participants_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "scoring_v2_shadow_canaries" (
    "id" UUID NOT NULL,
    "character_id" UUID NOT NULL,
    "region_code" TEXT NOT NULL,
    "realm_slug" TEXT NOT NULL,
    "character_name" TEXT NOT NULL,
    "season_id" UUID,
    "analysis_batch_id" UUID,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "lifecycle" TEXT NOT NULL DEFAULT 'SHADOW',
    "class_slug" TEXT,
    "spec_slug" TEXT,
    "role" TEXT,
    "specialization_id" UUID,
    "catalog_version" TEXT,
    "catalog_support_state" TEXT,
    "progress" JSONB NOT NULL DEFAULT '{}',
    "diagnostics" JSONB NOT NULL DEFAULT '{}',
    "error_code" TEXT,
    "error_message" TEXT,
    "requested_by_user_id" UUID NOT NULL,
    "bullmq_job_id" TEXT,
    "idempotency_key" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "scoring_v2_shadow_canaries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "evidence_dataset_pages_report_code_fight_id_report_revision_dataset_key_page_index_provider_contract_version_schema_version_key"
  ON "evidence_dataset_pages"("report_code", "fight_id", "report_revision", "dataset_key", "page_index", "provider_contract_version", "schema_version");
CREATE INDEX "evidence_dataset_pages_dataset_id_page_index_idx" ON "evidence_dataset_pages"("dataset_id", "page_index");
CREATE INDEX "evidence_dataset_pages_artifact_id_idx" ON "evidence_dataset_pages"("artifact_id");
CREATE INDEX "evidence_dataset_pages_report_code_fight_id_report_revision_idx" ON "evidence_dataset_pages"("report_code", "fight_id", "report_revision");

CREATE UNIQUE INDEX "wcl_run_source_digests_report_code_fight_id_report_revision_key"
  ON "wcl_run_source_digests"("report_code", "fight_id", "report_revision");
CREATE INDEX "wcl_run_source_digests_content_fingerprint_idx" ON "wcl_run_source_digests"("content_fingerprint");
CREATE INDEX "wcl_run_source_digests_dungeon_slug_key_level_idx" ON "wcl_run_source_digests"("dungeon_slug", "key_level");
CREATE INDEX "wcl_run_source_digests_acquired_at_idx" ON "wcl_run_source_digests"("acquired_at" DESC);

CREATE UNIQUE INDEX "wcl_run_participants_digest_id_wcl_actor_id_key" ON "wcl_run_participants"("digest_id", "wcl_actor_id");
CREATE INDEX "wcl_run_participants_character_id_idx" ON "wcl_run_participants"("character_id");
CREATE INDEX "wcl_run_participants_blizzard_character_id_idx" ON "wcl_run_participants"("blizzard_character_id");
CREATE INDEX "wcl_run_participants_wcl_canonical_id_idx" ON "wcl_run_participants"("wcl_canonical_id");
CREATE INDEX "wcl_run_participants_region_code_realm_slug_character_name_idx"
  ON "wcl_run_participants"("region_code", "realm_slug", "character_name");

CREATE UNIQUE INDEX "scoring_v2_shadow_canaries_idempotency_key_key" ON "scoring_v2_shadow_canaries"("idempotency_key");
CREATE INDEX "scoring_v2_shadow_canaries_character_id_created_at_idx" ON "scoring_v2_shadow_canaries"("character_id", "created_at" DESC);
CREATE INDEX "scoring_v2_shadow_canaries_status_created_at_idx" ON "scoring_v2_shadow_canaries"("status", "created_at" DESC);
CREATE INDEX "scoring_v2_shadow_canaries_requested_by_user_id_created_at_idx" ON "scoring_v2_shadow_canaries"("requested_by_user_id", "created_at" DESC);

CREATE INDEX "evidence_datasets_digest_id_idx" ON "evidence_datasets"("digest_id");

ALTER TABLE "evidence_dataset_pages" ADD CONSTRAINT "evidence_dataset_pages_dataset_id_fkey"
  FOREIGN KEY ("dataset_id") REFERENCES "evidence_datasets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "evidence_dataset_pages" ADD CONSTRAINT "evidence_dataset_pages_artifact_id_fkey"
  FOREIGN KEY ("artifact_id") REFERENCES "raw_artifacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "wcl_run_source_digests" ADD CONSTRAINT "wcl_run_source_digests_master_data_artifact_id_fkey"
  FOREIGN KEY ("master_data_artifact_id") REFERENCES "raw_artifacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "wcl_run_participants" ADD CONSTRAINT "wcl_run_participants_digest_id_fkey"
  FOREIGN KEY ("digest_id") REFERENCES "wcl_run_source_digests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "wcl_run_participants" ADD CONSTRAINT "wcl_run_participants_character_id_fkey"
  FOREIGN KEY ("character_id") REFERENCES "characters"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "evidence_datasets" ADD CONSTRAINT "evidence_datasets_digest_id_fkey"
  FOREIGN KEY ("digest_id") REFERENCES "wcl_run_source_digests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "scoring_v2_shadow_canaries" ADD CONSTRAINT "scoring_v2_shadow_canaries_character_id_fkey"
  FOREIGN KEY ("character_id") REFERENCES "characters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "scoring_v2_shadow_canaries" ADD CONSTRAINT "scoring_v2_shadow_canaries_requested_by_user_id_fkey"
  FOREIGN KEY ("requested_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
