-- Ability catalog durable admin curation (shadow review only; no publication).

CREATE TYPE "AbilityCatalogReviewBatchStatus" AS ENUM ('OPEN', 'REVIEWED', 'SUPERSEDED', 'CANCELLED');
CREATE TYPE "AbilityCatalogReviewItemKind" AS ENUM ('NEW_ABILITY_CANDIDATE', 'SPELL_BINDING_REVIEW', 'TOPOLOGY_REVIEW', 'REMOVAL_REVIEW');
CREATE TYPE "AbilityCatalogDraftStatus" AS ENUM ('NEEDS_METADATA', 'READY_FOR_PUBLISH_REVIEW');

CREATE TABLE "ability_catalog_source_baselines" (
    "id" UUID NOT NULL,
    "source" TEXT NOT NULL,
    "source_revision" TEXT NOT NULL,
    "wow_build" TEXT,
    "data_mode" TEXT,
    "retrieved_at" TIMESTAMPTZ(3) NOT NULL,
    "schema_version" TEXT,
    "extractor_version" TEXT,
    "content_hash" TEXT NOT NULL,
    "artifact_id" UUID,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "designated_by_user_id" UUID,
    "designated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ability_catalog_source_baselines_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ability_catalog_review_batches" (
    "id" UUID NOT NULL,
    "report_digest" TEXT NOT NULL,
    "report_artifact_id" UUID,
    "dataset_kind" TEXT NOT NULL,
    "wow_build" TEXT,
    "simc_revision" TEXT,
    "blizzard_namespace" TEXT,
    "blizzard_revision" TEXT,
    "source_identities" JSONB NOT NULL,
    "status" "AbilityCatalogReviewBatchStatus" NOT NULL DEFAULT 'OPEN',
    "summary_counts" JSONB NOT NULL,
    "imported_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ability_catalog_review_batches_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ability_catalog_review_items" (
    "id" UUID NOT NULL,
    "batch_id" UUID NOT NULL,
    "kind" "AbilityCatalogReviewItemKind" NOT NULL,
    "identity_key" TEXT NOT NULL,
    "primary_spell_id" INTEGER,
    "name" TEXT NOT NULL,
    "matched_canonical_key" TEXT,
    "class_slug" TEXT,
    "spec_slugs" JSONB NOT NULL DEFAULT '[]',
    "race_slugs" JSONB NOT NULL DEFAULT '[]',
    "eligibility_state" TEXT,
    "eligibility_reasons" JSONB NOT NULL DEFAULT '[]',
    "review_reason" TEXT NOT NULL,
    "evidence" JSONB NOT NULL,
    "source_provenance" JSONB NOT NULL,
    "decision_action" TEXT,
    "decision_note" TEXT,
    "decided_at" TIMESTAMPTZ(3),
    "decided_by_user_id" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "imported_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ability_catalog_review_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ability_catalog_draft_rules" (
    "id" UUID NOT NULL,
    "review_item_id" UUID NOT NULL,
    "canonical_key" TEXT,
    "name" TEXT NOT NULL,
    "spell_ids" JSONB NOT NULL DEFAULT '[]',
    "bindings" JSONB NOT NULL DEFAULT '[]',
    "icon_name" TEXT,
    "class_slug" TEXT,
    "spec_slugs" JSONB NOT NULL DEFAULT '[]',
    "race_slugs" JSONB NOT NULL DEFAULT '[]',
    "category" TEXT,
    "dimension_tags" JSONB NOT NULL DEFAULT '[]',
    "availability" TEXT,
    "cooldown_seconds" INTEGER,
    "charges" INTEGER,
    "source_ownership" TEXT,
    "provenance" JSONB NOT NULL DEFAULT '{}',
    "validity_build" TEXT,
    "notes" TEXT,
    "status" "AbilityCatalogDraftStatus" NOT NULL DEFAULT 'NEEDS_METADATA',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ability_catalog_draft_rules_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ability_catalog_draft_topology" (
    "id" UUID NOT NULL,
    "review_item_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "display_name" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "evidence" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ability_catalog_draft_topology_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ability_catalog_review_decision_events" (
    "id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "actor_user_id" UUID,
    "actor_type" TEXT NOT NULL,
    "previous_state" JSONB NOT NULL,
    "new_state" JSONB NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ability_catalog_review_decision_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ability_catalog_source_baselines_source_content_hash_key" ON "ability_catalog_source_baselines"("source", "content_hash");
CREATE INDEX "ability_catalog_source_baselines_source_is_active_designated_at_idx" ON "ability_catalog_source_baselines"("source", "is_active", "designated_at" DESC);

CREATE UNIQUE INDEX "ability_catalog_review_batches_report_digest_key" ON "ability_catalog_review_batches"("report_digest");
CREATE INDEX "ability_catalog_review_batches_status_created_at_idx" ON "ability_catalog_review_batches"("status", "created_at" DESC);
CREATE INDEX "ability_catalog_review_batches_simc_revision_wow_build_idx" ON "ability_catalog_review_batches"("simc_revision", "wow_build");

CREATE UNIQUE INDEX "ability_catalog_review_items_batch_id_identity_key_key" ON "ability_catalog_review_items"("batch_id", "identity_key");
CREATE INDEX "ability_catalog_review_items_batch_id_kind_decision_action_idx" ON "ability_catalog_review_items"("batch_id", "kind", "decision_action");
CREATE INDEX "ability_catalog_review_items_primary_spell_id_idx" ON "ability_catalog_review_items"("primary_spell_id");
CREATE INDEX "ability_catalog_review_items_class_slug_idx" ON "ability_catalog_review_items"("class_slug");

CREATE UNIQUE INDEX "ability_catalog_draft_rules_review_item_id_key" ON "ability_catalog_draft_rules"("review_item_id");
CREATE INDEX "ability_catalog_draft_rules_canonical_key_idx" ON "ability_catalog_draft_rules"("canonical_key");
CREATE INDEX "ability_catalog_draft_rules_status_idx" ON "ability_catalog_draft_rules"("status");

CREATE UNIQUE INDEX "ability_catalog_draft_topology_review_item_id_key" ON "ability_catalog_draft_topology"("review_item_id");
CREATE INDEX "ability_catalog_draft_topology_kind_slug_idx" ON "ability_catalog_draft_topology"("kind", "slug");

CREATE INDEX "ability_catalog_review_decision_events_item_id_created_at_idx" ON "ability_catalog_review_decision_events"("item_id", "created_at" DESC);

ALTER TABLE "ability_catalog_source_baselines" ADD CONSTRAINT "ability_catalog_source_baselines_designated_by_user_id_fkey" FOREIGN KEY ("designated_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ability_catalog_review_batches" ADD CONSTRAINT "ability_catalog_review_batches_imported_by_user_id_fkey" FOREIGN KEY ("imported_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ability_catalog_review_items" ADD CONSTRAINT "ability_catalog_review_items_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "ability_catalog_review_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ability_catalog_review_items" ADD CONSTRAINT "ability_catalog_review_items_decided_by_user_id_fkey" FOREIGN KEY ("decided_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ability_catalog_draft_rules" ADD CONSTRAINT "ability_catalog_draft_rules_review_item_id_fkey" FOREIGN KEY ("review_item_id") REFERENCES "ability_catalog_review_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ability_catalog_draft_rules" ADD CONSTRAINT "ability_catalog_draft_rules_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ability_catalog_draft_topology" ADD CONSTRAINT "ability_catalog_draft_topology_review_item_id_fkey" FOREIGN KEY ("review_item_id") REFERENCES "ability_catalog_review_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ability_catalog_review_decision_events" ADD CONSTRAINT "ability_catalog_review_decision_events_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "ability_catalog_review_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ability_catalog_review_decision_events" ADD CONSTRAINT "ability_catalog_review_decision_events_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
