-- Manual catalog edits from the explorer (no review batch required).
CREATE TYPE "AbilityCatalogDraftSource" AS ENUM ('REVIEW', 'MANUAL');

ALTER TABLE "ability_catalog_draft_rules"
  ALTER COLUMN "review_item_id" DROP NOT NULL;

ALTER TABLE "ability_catalog_draft_rules"
  ADD COLUMN "source" "AbilityCatalogDraftSource" NOT NULL DEFAULT 'REVIEW';

CREATE UNIQUE INDEX "ability_catalog_draft_rules_manual_canonical_key_key"
  ON "ability_catalog_draft_rules" ("canonical_key")
  WHERE "source" = 'MANUAL' AND "canonical_key" IS NOT NULL;
