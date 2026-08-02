-- Scoring V2 persistence: content-addressed artifacts, evidence manifests,
-- datasets, fact sets, dimension computations. Additive — V1 tables retained.

-- ---------------------------------------------------------------------------
-- RawArtifact: content-address uniqueness + size/refcount metadata
-- ---------------------------------------------------------------------------

-- Repoint FKs then drop duplicate content_hash rows (keep oldest).
WITH ranked AS (
  SELECT
    id,
    content_hash,
    ROW_NUMBER() OVER (PARTITION BY content_hash ORDER BY created_at ASC, id ASC) AS rn
  FROM "raw_artifacts"
),
dupes AS (
  SELECT keeper.id AS keep_id, loser.id AS drop_id
  FROM ranked keeper
  JOIN ranked loser
    ON keeper.content_hash = loser.content_hash
   AND keeper.rn = 1
   AND loser.rn > 1
)
UPDATE "external_payloads" ep
SET "artifact_id" = dupes.keep_id
FROM dupes
WHERE ep."artifact_id" = dupes.drop_id;

WITH ranked AS (
  SELECT
    id,
    content_hash,
    ROW_NUMBER() OVER (PARTITION BY content_hash ORDER BY created_at ASC, id ASC) AS rn
  FROM "raw_artifacts"
),
dupes AS (
  SELECT keeper.id AS keep_id, loser.id AS drop_id
  FROM ranked keeper
  JOIN ranked loser
    ON keeper.content_hash = loser.content_hash
   AND keeper.rn = 1
   AND loser.rn > 1
)
UPDATE "addon_exports" ae
SET "artifact_id" = dupes.keep_id
FROM dupes
WHERE ae."artifact_id" = dupes.drop_id;

WITH ranked AS (
  SELECT
    id,
    content_hash,
    ROW_NUMBER() OVER (PARTITION BY content_hash ORDER BY created_at ASC, id ASC) AS rn
  FROM "raw_artifacts"
)
DELETE FROM "raw_artifacts" ra
USING ranked
WHERE ra.id = ranked.id
  AND ranked.rn > 1;

DROP INDEX IF EXISTS "raw_artifacts_content_hash_idx";

ALTER TABLE "raw_artifacts"
  ADD COLUMN "uncompressed_size_bytes" BIGINT,
  ADD COLUMN "artifact_class" TEXT,
  ADD COLUMN "ref_count" INTEGER NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX "raw_artifacts_content_hash_key" ON "raw_artifacts"("content_hash");
CREATE INDEX "raw_artifacts_provider_created_at_idx" ON "raw_artifacts"("provider", "created_at" DESC);
CREATE INDEX "raw_artifacts_ref_count_retention_until_idx" ON "raw_artifacts"("ref_count", "retention_until");

-- ---------------------------------------------------------------------------
-- Artifact references (orphan prevention)
-- ---------------------------------------------------------------------------

CREATE TABLE "artifact_references" (
  "id" UUID NOT NULL,
  "artifact_id" UUID NOT NULL,
  "owner_type" TEXT NOT NULL,
  "owner_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "artifact_references_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "artifact_references_owner_type_owner_id_artifact_id_key"
  ON "artifact_references"("owner_type", "owner_id", "artifact_id");
CREATE INDEX "artifact_references_artifact_id_idx" ON "artifact_references"("artifact_id");

ALTER TABLE "artifact_references"
  ADD CONSTRAINT "artifact_references_artifact_id_fkey"
  FOREIGN KEY ("artifact_id") REFERENCES "raw_artifacts"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Evidence manifests / slots
-- ---------------------------------------------------------------------------

CREATE TABLE "evidence_manifests" (
  "id" UUID NOT NULL,
  "character_id" UUID NOT NULL,
  "season_id" UUID NOT NULL,
  "specialization_id" UUID,
  "role" "CharacterRole" NOT NULL,
  "refresh_contract_hash" TEXT NOT NULL,
  "selector_version" TEXT NOT NULL,
  "high_key_policy_id" TEXT NOT NULL,
  "evidence_cutoff_at" TIMESTAMPTZ(3) NOT NULL,
  "expected_slot_count" INTEGER NOT NULL,
  "selected_slot_count" INTEGER NOT NULL,
  "coverage_state" TEXT NOT NULL,
  "schema_version" TEXT NOT NULL,
  "content_hash" TEXT NOT NULL,
  "document" JSONB NOT NULL,
  "frozen_at" TIMESTAMPTZ(3) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "evidence_manifests_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "evidence_manifests_content_hash_key" ON "evidence_manifests"("content_hash");
CREATE INDEX "evidence_manifests_character_id_season_id_frozen_at_idx"
  ON "evidence_manifests"("character_id", "season_id", "frozen_at" DESC);
CREATE INDEX "evidence_manifests_frozen_at_idx" ON "evidence_manifests"("frozen_at" DESC);

ALTER TABLE "evidence_manifests"
  ADD CONSTRAINT "evidence_manifests_character_id_fkey"
  FOREIGN KEY ("character_id") REFERENCES "characters"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "evidence_manifests"
  ADD CONSTRAINT "evidence_manifests_season_id_fkey"
  FOREIGN KEY ("season_id") REFERENCES "seasons"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "evidence_manifests"
  ADD CONSTRAINT "evidence_manifests_specialization_id_fkey"
  FOREIGN KEY ("specialization_id") REFERENCES "game_specializations"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "evidence_manifest_slots" (
  "id" UUID NOT NULL,
  "manifest_id" UUID NOT NULL,
  "dungeon_id" UUID NOT NULL,
  "slot_index" INTEGER NOT NULL,
  "run_id" UUID,
  "report_code" TEXT,
  "fight_id" INTEGER,
  "report_revision" INTEGER,
  "key_level" INTEGER,
  "candidate_rank" INTEGER,
  "state" TEXT NOT NULL,
  "selection_reason" TEXT,
  "dimension_validity" JSONB NOT NULL DEFAULT '{}',
  "invalid_reasons" JSONB NOT NULL DEFAULT '[]',
  "provider_data_as_of" TIMESTAMPTZ(3),

  CONSTRAINT "evidence_manifest_slots_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "evidence_manifest_slots_manifest_id_dungeon_id_slot_index_key"
  ON "evidence_manifest_slots"("manifest_id", "dungeon_id", "slot_index");
-- Unique report/fight per manifest when a selected identity is present.
CREATE UNIQUE INDEX "evidence_manifest_slots_manifest_report_fight_uidx"
  ON "evidence_manifest_slots"("manifest_id", "report_code", "fight_id")
  WHERE "report_code" IS NOT NULL AND "fight_id" IS NOT NULL;
CREATE INDEX "evidence_manifest_slots_manifest_id_state_idx"
  ON "evidence_manifest_slots"("manifest_id", "state");
CREATE INDEX "evidence_manifest_slots_report_code_fight_id_idx"
  ON "evidence_manifest_slots"("report_code", "fight_id");

ALTER TABLE "evidence_manifest_slots"
  ADD CONSTRAINT "evidence_manifest_slots_manifest_id_fkey"
  FOREIGN KEY ("manifest_id") REFERENCES "evidence_manifests"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "evidence_manifest_slots"
  ADD CONSTRAINT "evidence_manifest_slots_dungeon_id_fkey"
  FOREIGN KEY ("dungeon_id") REFERENCES "dungeons"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "evidence_manifest_slots"
  ADD CONSTRAINT "evidence_manifest_slots_run_id_fkey"
  FOREIGN KEY ("run_id") REFERENCES "mythic_runs"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- WCL report revisions
-- ---------------------------------------------------------------------------

CREATE TABLE "wcl_report_revisions" (
  "id" UUID NOT NULL,
  "report_code" TEXT NOT NULL,
  "revision" INTEGER NOT NULL,
  "visibility" TEXT NOT NULL,
  "archive_state" TEXT,
  "start_time_ms" BIGINT NOT NULL,
  "end_time_ms" BIGINT NOT NULL,
  "zone_id" INTEGER,
  "master_data_artifact_id" UUID,
  "metadata_hash" TEXT NOT NULL,
  "fetched_at" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "wcl_report_revisions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "wcl_report_revisions_report_code_revision_key"
  ON "wcl_report_revisions"("report_code", "revision");
CREATE INDEX "wcl_report_revisions_report_code_idx" ON "wcl_report_revisions"("report_code");

ALTER TABLE "wcl_report_revisions"
  ADD CONSTRAINT "wcl_report_revisions_master_data_artifact_id_fkey"
  FOREIGN KEY ("master_data_artifact_id") REFERENCES "raw_artifacts"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Evidence datasets / fact sets / dimension computations
-- ---------------------------------------------------------------------------

CREATE TABLE "evidence_datasets" (
  "id" UUID NOT NULL,
  "manifest_slot_id" UUID NOT NULL,
  "dataset_key" TEXT NOT NULL,
  "compatibility_key" TEXT NOT NULL,
  "artifact_id" UUID,
  "schema_version" TEXT NOT NULL,
  "provider_contract_version" TEXT NOT NULL,
  "state" TEXT NOT NULL,
  "event_count" INTEGER NOT NULL DEFAULT 0,
  "page_count" INTEGER NOT NULL DEFAULT 0,
  "truncated" BOOLEAN NOT NULL DEFAULT false,
  "points_consumed" DOUBLE PRECISION,
  "cost_source" TEXT,
  "payload_fingerprint" TEXT,
  "fetched_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "evidence_datasets_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "evidence_datasets_compatibility_key_key"
  ON "evidence_datasets"("compatibility_key");
CREATE UNIQUE INDEX "evidence_datasets_manifest_slot_id_dataset_key_key"
  ON "evidence_datasets"("manifest_slot_id", "dataset_key");
CREATE INDEX "evidence_datasets_artifact_id_idx" ON "evidence_datasets"("artifact_id");

ALTER TABLE "evidence_datasets"
  ADD CONSTRAINT "evidence_datasets_manifest_slot_id_fkey"
  FOREIGN KEY ("manifest_slot_id") REFERENCES "evidence_manifest_slots"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "evidence_datasets"
  ADD CONSTRAINT "evidence_datasets_artifact_id_fkey"
  FOREIGN KEY ("artifact_id") REFERENCES "raw_artifacts"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "run_fact_sets" (
  "id" UUID NOT NULL,
  "manifest_slot_id" UUID NOT NULL,
  "character_id" UUID NOT NULL,
  "run_id" UUID,
  "extractor_family" TEXT NOT NULL,
  "extractor_version" TEXT NOT NULL,
  "schema_version" TEXT NOT NULL,
  "input_fingerprint" TEXT NOT NULL,
  "facts" JSONB NOT NULL,
  "coverage" JSONB NOT NULL DEFAULT '{}',
  "limitations" JSONB NOT NULL DEFAULT '[]',
  "computed_at" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "run_fact_sets_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "run_fact_sets_slot_family_version_fingerprint_key"
  ON "run_fact_sets"("manifest_slot_id", "extractor_family", "extractor_version", "input_fingerprint");
CREATE INDEX "run_fact_sets_character_id_computed_at_idx"
  ON "run_fact_sets"("character_id", "computed_at" DESC);

ALTER TABLE "run_fact_sets"
  ADD CONSTRAINT "run_fact_sets_manifest_slot_id_fkey"
  FOREIGN KEY ("manifest_slot_id") REFERENCES "evidence_manifest_slots"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "run_fact_sets"
  ADD CONSTRAINT "run_fact_sets_character_id_fkey"
  FOREIGN KEY ("character_id") REFERENCES "characters"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "run_fact_sets"
  ADD CONSTRAINT "run_fact_sets_run_id_fkey"
  FOREIGN KEY ("run_id") REFERENCES "mythic_runs"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "dimension_computations" (
  "id" UUID NOT NULL,
  "character_id" UUID NOT NULL,
  "season_id" UUID NOT NULL,
  "manifest_id" UUID NOT NULL,
  "score_model_id" UUID NOT NULL,
  "dimension" "ScoreDimension" NOT NULL,
  "algorithm_version" TEXT NOT NULL,
  "input_fingerprint" TEXT NOT NULL,
  "score" DECIMAL(8,4),
  "confidence" DECIMAL(5,4) NOT NULL,
  "state" TEXT NOT NULL,
  "metrics" JSONB NOT NULL DEFAULT '{}',
  "explanation" JSONB NOT NULL DEFAULT '{}',
  "computed_at" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "dimension_computations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "dimension_computations_identity_key"
  ON "dimension_computations"(
    "character_id",
    "season_id",
    "manifest_id",
    "score_model_id",
    "dimension",
    "input_fingerprint"
  );
CREATE INDEX "dimension_computations_character_season_model_computed_at_idx"
  ON "dimension_computations"("character_id", "season_id", "score_model_id", "computed_at" DESC);
CREATE INDEX "dimension_computations_manifest_id_dimension_idx"
  ON "dimension_computations"("manifest_id", "dimension");

ALTER TABLE "dimension_computations"
  ADD CONSTRAINT "dimension_computations_character_id_fkey"
  FOREIGN KEY ("character_id") REFERENCES "characters"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "dimension_computations"
  ADD CONSTRAINT "dimension_computations_season_id_fkey"
  FOREIGN KEY ("season_id") REFERENCES "seasons"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "dimension_computations"
  ADD CONSTRAINT "dimension_computations_manifest_id_fkey"
  FOREIGN KEY ("manifest_id") REFERENCES "evidence_manifests"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "dimension_computations"
  ADD CONSTRAINT "dimension_computations_score_model_id_fkey"
  FOREIGN KEY ("score_model_id") REFERENCES "score_models"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Publication / batch references to manifests
-- ---------------------------------------------------------------------------

ALTER TABLE "score_snapshots"
  ADD COLUMN "evidence_manifest_id" UUID;
CREATE INDEX "score_snapshots_evidence_manifest_id_idx"
  ON "score_snapshots"("evidence_manifest_id");
ALTER TABLE "score_snapshots"
  ADD CONSTRAINT "score_snapshots_evidence_manifest_id_fkey"
  FOREIGN KEY ("evidence_manifest_id") REFERENCES "evidence_manifests"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "score_analysis_batches"
  ADD COLUMN "evidence_manifest_id" UUID;
CREATE INDEX "score_analysis_batches_evidence_manifest_id_idx"
  ON "score_analysis_batches"("evidence_manifest_id");
ALTER TABLE "score_analysis_batches"
  ADD CONSTRAINT "score_analysis_batches_evidence_manifest_id_fkey"
  FOREIGN KEY ("evidence_manifest_id") REFERENCES "evidence_manifests"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Manifest immutability (content hash + document frozen after insert)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION evidence_manifest_immutability_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."content_hash" IS DISTINCT FROM OLD."content_hash"
     OR NEW."document" IS DISTINCT FROM OLD."document"
     OR NEW."frozen_at" IS DISTINCT FROM OLD."frozen_at"
     OR NEW."schema_version" IS DISTINCT FROM OLD."schema_version"
     OR NEW."selector_version" IS DISTINCT FROM OLD."selector_version"
     OR NEW."refresh_contract_hash" IS DISTINCT FROM OLD."refresh_contract_hash"
     OR NEW."character_id" IS DISTINCT FROM OLD."character_id"
     OR NEW."season_id" IS DISTINCT FROM OLD."season_id"
     OR NEW."role" IS DISTINCT FROM OLD."role" THEN
    RAISE EXCEPTION 'evidence_manifests rows are immutable after freeze (id=%)', OLD.id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER evidence_manifests_immutability_trg
  BEFORE UPDATE ON "evidence_manifests"
  FOR EACH ROW
  EXECUTE FUNCTION evidence_manifest_immutability_guard();

CREATE OR REPLACE FUNCTION evidence_manifest_slot_immutability_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."manifest_id" IS DISTINCT FROM OLD."manifest_id"
     OR NEW."dungeon_id" IS DISTINCT FROM OLD."dungeon_id"
     OR NEW."slot_index" IS DISTINCT FROM OLD."slot_index"
     OR NEW."report_code" IS DISTINCT FROM OLD."report_code"
     OR NEW."fight_id" IS DISTINCT FROM OLD."fight_id"
     OR NEW."report_revision" IS DISTINCT FROM OLD."report_revision" THEN
    RAISE EXCEPTION 'evidence_manifest_slots identity fields are immutable (id=%)', OLD.id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER evidence_manifest_slots_immutability_trg
  BEFORE UPDATE ON "evidence_manifest_slots"
  FOR EACH ROW
  EXECUTE FUNCTION evidence_manifest_slot_immutability_guard();
