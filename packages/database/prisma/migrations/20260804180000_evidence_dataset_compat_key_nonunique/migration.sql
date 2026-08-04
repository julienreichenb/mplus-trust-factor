-- EvidenceDataset.compatibilityKey is a logical identity shared across refreshes.
-- Each frozen manifest slot keeps its own auditable descriptor row
-- (unique on manifest_slot_id + dataset_key). Same compatibility identity +
-- same immutable content may bind to multiple slots; content conflicts fail closed.

DROP INDEX IF EXISTS "evidence_datasets_compatibility_key_key";

CREATE INDEX "evidence_datasets_compatibility_key_idx"
  ON "evidence_datasets"("compatibility_key");
