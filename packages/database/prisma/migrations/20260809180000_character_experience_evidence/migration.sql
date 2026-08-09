-- Immutable closed-season Experience evidence (rating / class-rank / elite).
-- No TTL: successful rows are permanent until repair / compatibility invalidation.

CREATE TABLE "character_experience_evidence" (
    "id" UUID NOT NULL,
    "character_id" UUID NOT NULL,
    "season_id" UUID NOT NULL,
    "blizzard_season_id" INTEGER,
    "raider_io_season_slug" TEXT,
    "evidence_kind" TEXT NOT NULL,
    "compatibility_version" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "source_payload_id" UUID,
    "source_request_fingerprint" TEXT,
    "content_hash" TEXT,
    "fetched_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "character_experience_evidence_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "character_experience_evidence_identity_key"
  ON "character_experience_evidence"("character_id", "season_id", "evidence_kind", "compatibility_version");

CREATE INDEX "character_experience_evidence_character_id_season_id_idx"
  ON "character_experience_evidence"("character_id", "season_id");

CREATE INDEX "character_experience_evidence_evidence_kind_compatibility_version_idx"
  ON "character_experience_evidence"("evidence_kind", "compatibility_version");

ALTER TABLE "character_experience_evidence"
  ADD CONSTRAINT "character_experience_evidence_character_id_fkey"
  FOREIGN KEY ("character_id") REFERENCES "characters"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "character_experience_evidence"
  ADD CONSTRAINT "character_experience_evidence_season_id_fkey"
  FOREIGN KEY ("season_id") REFERENCES "seasons"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
