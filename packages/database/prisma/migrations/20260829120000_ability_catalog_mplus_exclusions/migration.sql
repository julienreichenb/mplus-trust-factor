-- Durable M+ business exclusions (cross-refresh spell/catalog identity).

CREATE TABLE "ability_catalog_exclusions" (
    "id" UUID NOT NULL,
    "stable_ability_identity" TEXT NOT NULL,
    "excluded_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ability_catalog_exclusions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ability_catalog_exclusions_stable_ability_identity_key" ON "ability_catalog_exclusions"("stable_ability_identity");

ALTER TABLE "ability_catalog_exclusions" ADD CONSTRAINT "ability_catalog_exclusions_excluded_by_user_id_fkey" FOREIGN KEY ("excluded_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
