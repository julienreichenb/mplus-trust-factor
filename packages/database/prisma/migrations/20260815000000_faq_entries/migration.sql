-- Public FAQ entries (admin-managed). No seed data.
CREATE TABLE "faq_entries" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "is_published" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "faq_entries_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "faq_entries_is_published_position_created_at_idx"
  ON "faq_entries"("is_published", "position", "created_at");

CREATE INDEX "faq_entries_position_created_at_idx"
  ON "faq_entries"("position", "created_at");
