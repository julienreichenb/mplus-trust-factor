-- AlterTable
ALTER TABLE "score_snapshots" ADD COLUMN "publication_status" TEXT NOT NULL DEFAULT 'PUBLIC';
ALTER TABLE "score_snapshots" ADD COLUMN "is_public" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "score_snapshots" ADD COLUMN "analysis_batch_id" UUID;

-- AlterTable
ALTER TABLE "dimension_scores" ALTER COLUMN "score" DROP NOT NULL;
ALTER TABLE "dimension_scores" ADD COLUMN "state" TEXT NOT NULL DEFAULT 'AVAILABLE';
ALTER TABLE "dimension_scores" ADD COLUMN "reason" TEXT;

-- CreateEnum (as TEXT + check via app; Prisma enums)
DO $$ BEGIN
  CREATE TYPE "ScorePublicationStatus" AS ENUM ('DRAFT', 'PUBLIC', 'SUPERSEDED');
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  CREATE TYPE "AnalysisRunJobStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'UNAVAILABLE', 'FAILED');
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  CREATE TYPE "ScoreFinalizationStatus" AS ENUM ('PENDING', 'READY_TO_FINALIZE', 'FINALIZING', 'FINALIZED', 'FAILED', 'EXPIRED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

ALTER TABLE "score_snapshots" ALTER COLUMN "publication_status" DROP DEFAULT;
ALTER TABLE "score_snapshots" ALTER COLUMN "publication_status" TYPE "ScorePublicationStatus" USING ("publication_status"::"ScorePublicationStatus");
ALTER TABLE "score_snapshots" ALTER COLUMN "publication_status" SET DEFAULT 'PUBLIC';

-- CreateTable
CREATE TABLE "score_analysis_batches" (
    "id" UUID NOT NULL,
    "character_id" UUID NOT NULL,
    "season_id" UUID NOT NULL,
    "refresh_id" UUID NOT NULL,
    "score_model_id" UUID NOT NULL,
    "expected_run_count" INTEGER NOT NULL,
    "terminal_run_count" INTEGER NOT NULL DEFAULT 0,
    "successful_run_count" INTEGER NOT NULL DEFAULT 0,
    "unavailable_run_count" INTEGER NOT NULL DEFAULT 0,
    "failed_run_count" INTEGER NOT NULL DEFAULT 0,
    "finalization_status" "ScoreFinalizationStatus" NOT NULL DEFAULT 'PENDING',
    "finalized_at" TIMESTAMPTZ(3),
    "deadline_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "score_analysis_batches_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "score_analysis_batch_runs" (
    "id" UUID NOT NULL,
    "batch_id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "status" "AnalysisRunJobStatus" NOT NULL DEFAULT 'PENDING',
    "terminal_reason" TEXT,
    "started_at" TIMESTAMPTZ(3),
    "finished_at" TIMESTAMPTZ(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "score_analysis_batch_runs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "score_analysis_batches_character_id_season_id_refresh_id_score_model_id_key" ON "score_analysis_batches"("character_id", "season_id", "refresh_id", "score_model_id");
CREATE INDEX "score_analysis_batches_finalization_status_updated_at_idx" ON "score_analysis_batches"("finalization_status", "updated_at");
CREATE UNIQUE INDEX "score_analysis_batch_runs_batch_id_run_id_key" ON "score_analysis_batch_runs"("batch_id", "run_id");
CREATE INDEX "score_analysis_batch_runs_status_finished_at_idx" ON "score_analysis_batch_runs"("status", "finished_at");
CREATE INDEX "score_snapshots_character_id_is_public_calculated_at_idx" ON "score_snapshots"("character_id", "is_public", "calculated_at" DESC);

ALTER TABLE "score_analysis_batches" ADD CONSTRAINT "score_analysis_batches_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "characters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "score_analysis_batches" ADD CONSTRAINT "score_analysis_batches_season_id_fkey" FOREIGN KEY ("season_id") REFERENCES "seasons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "score_analysis_batches" ADD CONSTRAINT "score_analysis_batches_score_model_id_fkey" FOREIGN KEY ("score_model_id") REFERENCES "score_models"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "score_analysis_batch_runs" ADD CONSTRAINT "score_analysis_batch_runs_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "score_analysis_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "score_analysis_batch_runs" ADD CONSTRAINT "score_analysis_batch_runs_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "mythic_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "score_snapshots" ADD CONSTRAINT "score_snapshots_analysis_batch_id_fkey" FOREIGN KEY ("analysis_batch_id") REFERENCES "score_analysis_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
