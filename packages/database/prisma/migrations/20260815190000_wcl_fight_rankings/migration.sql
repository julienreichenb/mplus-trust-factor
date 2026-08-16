-- CreateTable
CREATE TABLE "wcl_fight_rankings" (
    "id" UUID NOT NULL,
    "raw_run_id" UUID NOT NULL,
    "ranking_acquisition_version" TEXT NOT NULL,
    "report_actor_id" INTEGER NOT NULL,
    "wcl_character_id" INTEGER,
    "name" TEXT NOT NULL,
    "realm_name" TEXT,
    "role" TEXT,
    "spec" TEXT,
    "class_name" TEXT,
    "bracket_percent" DOUBLE PRECISION,
    "rank_percent" DOUBLE PRECISION,
    "fetched_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "wcl_fight_rankings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "wcl_fight_rankings_raw_actor_key" ON "wcl_fight_rankings"("raw_run_id", "report_actor_id");

-- CreateIndex
CREATE INDEX "wcl_fight_rankings_raw_run_id_idx" ON "wcl_fight_rankings"("raw_run_id");

-- CreateIndex
CREATE INDEX "wcl_fight_rankings_wcl_character_id_idx" ON "wcl_fight_rankings"("wcl_character_id");

-- AddForeignKey
ALTER TABLE "wcl_fight_rankings" ADD CONSTRAINT "wcl_fight_rankings_raw_run_id_fkey" FOREIGN KEY ("raw_run_id") REFERENCES "wcl_run_raw"("id") ON DELETE CASCADE ON UPDATE CASCADE;
