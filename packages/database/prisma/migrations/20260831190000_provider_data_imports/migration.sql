-- Portable provider-data import metadata (collector → consumer corpus sharing).
CREATE TABLE "provider_data_imports" (
    "id" UUID NOT NULL,
    "content_hash" TEXT NOT NULL,
    "schema_version" INTEGER NOT NULL,
    "source_environment" TEXT NOT NULL,
    "generated_at" TIMESTAMPTZ(3) NOT NULL,
    "imported_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "manifest" JSONB NOT NULL DEFAULT '{}',
    "counts" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "provider_data_imports_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "provider_data_imports_content_hash_key" ON "provider_data_imports"("content_hash");
CREATE INDEX "provider_data_imports_imported_at_idx" ON "provider_data_imports"("imported_at" DESC);
