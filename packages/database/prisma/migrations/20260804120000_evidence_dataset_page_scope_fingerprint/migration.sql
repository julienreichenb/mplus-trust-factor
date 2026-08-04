-- Durable actor/filter scope for EvidenceDatasetPage uniqueness.
-- Prevents cross-character collision of actor-scoped event pages within the same fight.

ALTER TABLE "evidence_dataset_pages"
  ADD COLUMN "scope_fingerprint" TEXT NOT NULL DEFAULT 'scope:unscoped';

DROP INDEX IF EXISTS "evidence_dataset_pages_report_code_fight_id_report_revision_dataset_key_page_index_provider_contract_version_schema_version_key";

CREATE UNIQUE INDEX "evidence_dataset_pages_scope_unique"
  ON "evidence_dataset_pages"(
    "report_code",
    "fight_id",
    "report_revision",
    "dataset_key",
    "page_index",
    "provider_contract_version",
    "schema_version",
    "scope_fingerprint"
  );

CREATE INDEX "evidence_dataset_pages_scope_lookup_idx"
  ON "evidence_dataset_pages"("report_code", "fight_id", "report_revision", "dataset_key", "scope_fingerprint");
