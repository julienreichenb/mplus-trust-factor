-- Immutable ranking snapshots + actor entries. Backfill existing overwrite-table rows.

CREATE TABLE "wcl_fight_ranking_snapshots" (
    "id" UUID NOT NULL,
    "raw_run_id" UUID NOT NULL,
    "ranking_acquisition_version" TEXT NOT NULL,
    "content_hash" TEXT NOT NULL,
    "fetched_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wcl_fight_ranking_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "wcl_fight_ranking_snapshots_raw_hash_key" ON "wcl_fight_ranking_snapshots"("raw_run_id", "content_hash");
CREATE INDEX "wcl_fight_ranking_snapshots_raw_run_id_fetched_at_idx" ON "wcl_fight_ranking_snapshots"("raw_run_id", "fetched_at" DESC);

CREATE TABLE "wcl_fight_ranking_entries" (
    "id" UUID NOT NULL,
    "snapshot_id" UUID NOT NULL,
    "report_actor_id" INTEGER NOT NULL,
    "wcl_character_id" INTEGER,
    "name" TEXT NOT NULL,
    "realm_name" TEXT,
    "role" TEXT,
    "spec" TEXT,
    "class_name" TEXT,
    "bracket_percent" DOUBLE PRECISION,
    "rank_percent" DOUBLE PRECISION,

    CONSTRAINT "wcl_fight_ranking_entries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "wcl_fight_ranking_entries_snapshot_actor_key" ON "wcl_fight_ranking_entries"("snapshot_id", "report_actor_id");
CREATE INDEX "wcl_fight_ranking_entries_wcl_character_id_idx" ON "wcl_fight_ranking_entries"("wcl_character_id");

ALTER TABLE "wcl_fight_ranking_snapshots" ADD CONSTRAINT "wcl_fight_ranking_snapshots_raw_run_id_fkey" FOREIGN KEY ("raw_run_id") REFERENCES "wcl_run_raw"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "wcl_fight_ranking_entries" ADD CONSTRAINT "wcl_fight_ranking_entries_snapshot_id_fkey" FOREIGN KEY ("snapshot_id") REFERENCES "wcl_fight_ranking_snapshots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "wcl_fight_ranking_snapshots" ("id", "raw_run_id", "ranking_acquisition_version", "content_hash", "fetched_at", "created_at")
SELECT
  gen_random_uuid(),
  grouped.raw_run_id,
  grouped.ranking_acquisition_version,
  grouped.content_hash,
  grouped.fetched_at,
  CURRENT_TIMESTAMP
FROM (
  SELECT
    r.raw_run_id,
    r.ranking_acquisition_version,
    r.fetched_at,
    md5(
      string_agg(
        concat_ws(
          '|',
          r.report_actor_id::text,
          COALESCE(r.wcl_character_id::text, ''),
          COALESCE(r.bracket_percent::text, ''),
          COALESCE(r.rank_percent::text, '')
        ),
        ','
        ORDER BY r.report_actor_id
      )
    ) AS content_hash
  FROM "wcl_fight_rankings" r
  GROUP BY r.raw_run_id, r.ranking_acquisition_version, r.fetched_at
) grouped
ON CONFLICT ("raw_run_id", "content_hash") DO NOTHING;

INSERT INTO "wcl_fight_ranking_entries" (
  "id", "snapshot_id", "report_actor_id", "wcl_character_id", "name", "realm_name",
  "role", "spec", "class_name", "bracket_percent", "rank_percent"
)
SELECT
  gen_random_uuid(),
  s.id,
  r.report_actor_id,
  r.wcl_character_id,
  r.name,
  r.realm_name,
  r.role,
  r.spec,
  r.class_name,
  r.bracket_percent,
  r.rank_percent
FROM "wcl_fight_rankings" r
JOIN "wcl_fight_ranking_snapshots" s
  ON s.raw_run_id = r.raw_run_id
 AND s.ranking_acquisition_version = r.ranking_acquisition_version
 AND s.fetched_at = r.fetched_at;

DROP TABLE "wcl_fight_rankings";
