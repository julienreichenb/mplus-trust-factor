-- Minimal scoring cache: WclRunRaw, CharacterRunDigest, RunRankingFact, CharacterScore.
-- Obsolete capability_evidence_package_records / participant_scoring_digests remain unused.

CREATE TABLE "wcl_run_raw" (
    "id" UUID NOT NULL,
    "report_code" TEXT NOT NULL,
    "fight_id" INTEGER NOT NULL,
    "report_revision" INTEGER NOT NULL,
    "acquisition_version" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "fetched_at" TIMESTAMPTZ(3) NOT NULL,
    "provider_cost" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "wcl_run_raw_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "wcl_run_raw_report_code_fight_id_report_revision_acquisition_version_key"
  ON "wcl_run_raw"("report_code", "fight_id", "report_revision", "acquisition_version");

CREATE INDEX "wcl_run_raw_report_code_fight_id_idx"
  ON "wcl_run_raw"("report_code", "fight_id");

CREATE TABLE "character_run_digests" (
    "id" UUID NOT NULL,
    "raw_run_id" UUID NOT NULL,
    "character_id" UUID NOT NULL,
    "extractor_version" TEXT NOT NULL,
    "offensive" JSONB NOT NULL,
    "utility" JSONB NOT NULL,
    "survival" JSONB NOT NULL,
    "source_metadata" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "character_run_digests_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "character_run_digests_raw_run_id_character_id_extractor_version_key"
  ON "character_run_digests"("raw_run_id", "character_id", "extractor_version");

CREATE INDEX "character_run_digests_character_id_idx"
  ON "character_run_digests"("character_id");

CREATE TABLE "run_ranking_facts" (
    "id" UUID NOT NULL,
    "raw_run_id" UUID NOT NULL,
    "character_id" UUID NOT NULL,
    "ranking_version" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "fetched_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "run_ranking_facts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "run_ranking_facts_raw_run_id_character_id_ranking_version_key"
  ON "run_ranking_facts"("raw_run_id", "character_id", "ranking_version");

CREATE INDEX "run_ranking_facts_character_id_idx"
  ON "run_ranking_facts"("character_id");

CREATE TABLE "character_scores" (
    "id" UUID NOT NULL,
    "character_id" UUID NOT NULL,
    "season_id" UUID NOT NULL,
    "scoring_version" TEXT NOT NULL,
    "performance" DOUBLE PRECISION,
    "utility" DOUBLE PRECISION,
    "survival" DOUBLE PRECISION,
    "experience" DOUBLE PRECISION,
    "composite" DOUBLE PRECISION,
    "confidence" DOUBLE PRECISION,
    "tier" TEXT,
    "dimension_details" JSONB,
    "selected_runs" JSONB NOT NULL,
    "calculated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "character_scores_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "character_scores_character_id_season_id_scoring_version_key"
  ON "character_scores"("character_id", "season_id", "scoring_version");

CREATE INDEX "character_scores_character_id_season_id_idx"
  ON "character_scores"("character_id", "season_id");

ALTER TABLE "character_run_digests"
  ADD CONSTRAINT "character_run_digests_raw_run_id_fkey"
  FOREIGN KEY ("raw_run_id") REFERENCES "wcl_run_raw"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "character_run_digests"
  ADD CONSTRAINT "character_run_digests_character_id_fkey"
  FOREIGN KEY ("character_id") REFERENCES "characters"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "run_ranking_facts"
  ADD CONSTRAINT "run_ranking_facts_raw_run_id_fkey"
  FOREIGN KEY ("raw_run_id") REFERENCES "wcl_run_raw"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "run_ranking_facts"
  ADD CONSTRAINT "run_ranking_facts_character_id_fkey"
  FOREIGN KEY ("character_id") REFERENCES "characters"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "character_scores"
  ADD CONSTRAINT "character_scores_character_id_fkey"
  FOREIGN KEY ("character_id") REFERENCES "characters"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "character_scores"
  ADD CONSTRAINT "character_scores_season_id_fkey"
  FOREIGN KEY ("season_id") REFERENCES "seasons"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
