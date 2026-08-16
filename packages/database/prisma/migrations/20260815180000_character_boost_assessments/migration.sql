-- CreateTable
CREATE TABLE "character_boost_assessments" (
    "id" UUID NOT NULL,
    "character_id" UUID NOT NULL,
    "season_id" UUID NOT NULL,
    "detector_version" TEXT NOT NULL,
    "policy_version" TEXT NOT NULL,
    "context_revision_key" TEXT NOT NULL DEFAULT 'none',
    "context_revision_id" UUID,
    "suspicion_score" INTEGER,
    "suspicion_band" TEXT,
    "confidence" DECIMAL(5,4) NOT NULL,
    "status" TEXT NOT NULL,
    "signals" JSONB NOT NULL,
    "sample" JSONB NOT NULL,
    "evidence_fingerprint" TEXT NOT NULL,
    "calculated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "character_boost_assessments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "character_boost_assessments_fingerprint_uidx" ON "character_boost_assessments"("character_id", "season_id", "detector_version", "evidence_fingerprint");

-- CreateIndex
CREATE INDEX "character_boost_assessments_char_season_calc_idx" ON "character_boost_assessments"("character_id", "season_id", "calculated_at" DESC);

-- AddForeignKey
ALTER TABLE "character_boost_assessments" ADD CONSTRAINT "character_boost_assessments_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "characters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "character_boost_assessments" ADD CONSTRAINT "character_boost_assessments_season_id_fkey" FOREIGN KEY ("season_id") REFERENCES "seasons"("id") ON DELETE CASCADE ON UPDATE CASCADE;
