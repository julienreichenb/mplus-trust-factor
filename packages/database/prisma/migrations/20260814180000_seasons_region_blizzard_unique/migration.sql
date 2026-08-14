-- Canonical Blizzard-backed Season identity: (region_id, blizzard_season_id).
-- PostgreSQL UNIQUE allows multiple NULLs, so synthetic rows without a Blizzard id may coexist.
CREATE UNIQUE INDEX "seasons_region_blizzard_season_id_key"
ON "seasons" ("region_id", "blizzard_season_id");
