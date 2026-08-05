-- Durable PostgreSQL-backed artifact payload storage (content-addressed bytea).
-- Payload rows are keyed by content_hash; RawArtifact metadata references the same hash.

CREATE TABLE "raw_artifact_payloads" (
    "content_hash" TEXT NOT NULL,
    "compression" "ArtifactCompression" NOT NULL,
    "payload" BYTEA NOT NULL,
    "compressed_size_bytes" BIGINT NOT NULL,
    "uncompressed_size_bytes" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "raw_artifact_payloads_pkey" PRIMARY KEY ("content_hash")
);
