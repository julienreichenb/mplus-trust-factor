-- Explicit supersession pointer on the *new* package only.
-- Superseded rows are never mutated or deleted; lookup excludes keys named here.
ALTER TABLE "capability_evidence_package_records"
  ADD COLUMN "supersedes_compatibility_key" TEXT;

CREATE INDEX "capability_evidence_package_records_supersedes_compatibility_key_idx"
  ON "capability_evidence_package_records"("supersedes_compatibility_key");
