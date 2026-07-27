-- AlterEnum
CREATE TYPE "ProviderLifecycleState" AS ENUM ('OK', 'STALE', 'UNAVAILABLE', 'RATE_LIMITED', 'PRIVATE_OR_HIDDEN', 'NOT_FOUND');

-- CreateTable
CREATE TABLE "character_provider_states" (
    "id" UUID NOT NULL,
    "character_id" UUID NOT NULL,
    "provider" "Provider" NOT NULL,
    "state" "ProviderLifecycleState" NOT NULL,
    "detail" TEXT,
    "warnings" JSONB NOT NULL DEFAULT '[]',
    "disagreements" JSONB NOT NULL DEFAULT '[]',
    "excluded_observations" JSONB NOT NULL DEFAULT '[]',
    "wcl_visibility" TEXT,
    "last_attempt_at" TIMESTAMPTZ(3) NOT NULL,
    "last_success_at" TIMESTAMPTZ(3),
    "fetched_at" TIMESTAMPTZ(3),
    "expires_at" TIMESTAMPTZ(3),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "character_provider_states_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "character_provider_states_provider_state_idx" ON "character_provider_states"("provider", "state");

-- CreateIndex
CREATE UNIQUE INDEX "character_provider_states_character_id_provider_key" ON "character_provider_states"("character_id", "provider");

-- AddForeignKey
ALTER TABLE "character_provider_states" ADD CONSTRAINT "character_provider_states_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "characters"("id") ON DELETE CASCADE ON UPDATE CASCADE;
