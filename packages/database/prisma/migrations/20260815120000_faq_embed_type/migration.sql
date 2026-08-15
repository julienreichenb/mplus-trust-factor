-- Optional typed FAQ artifact. No content rows.
CREATE TYPE "FaqEmbedType" AS ENUM (
  'META_TIER_TABLE',
  'KEY_PERCENTILE_TABLE',
  'SCORE_FLOW',
  'SCORING_DIMENSIONS'
);

ALTER TABLE "faq_entries" ADD COLUMN "embed_type" "FaqEmbedType";
