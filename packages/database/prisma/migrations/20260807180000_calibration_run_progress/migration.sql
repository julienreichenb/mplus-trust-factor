-- Sequential calibration run progress for admin UI observation.
ALTER TABLE "calibration_runs" ADD COLUMN "progress_json" JSONB NOT NULL DEFAULT '{}';
