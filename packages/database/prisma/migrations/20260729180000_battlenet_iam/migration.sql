-- Agent 38: Battle.net OAuth / IAM foundation
-- Preserves characters, scores, and all non-stub tables.
-- Replaces unused stub account_characters; evolves unused battlenet_accounts / users.

CREATE TYPE "OwnershipStatus" AS ENUM ('CURRENT', 'HISTORICAL', 'STALE', 'REVOKED');
CREATE TYPE "AuditOutcome" AS ENUM ('SUCCESS', 'DENIED', 'FAILURE');

-- Drop unused stub join table (no application runtime usage).
DROP TABLE IF EXISTS "account_characters";

-- Evolve battlenet_accounts stub → production link store.
ALTER TABLE "battlenet_accounts" DROP CONSTRAINT IF EXISTS "battlenet_accounts_region_id_battletag_hash_key";
ALTER TABLE "battlenet_accounts" DROP CONSTRAINT IF EXISTS "battlenet_accounts_user_id_fkey";
ALTER TABLE "battlenet_accounts" DROP CONSTRAINT IF EXISTS "battlenet_accounts_region_id_fkey";

-- Stub table was unused at runtime; clear before tightening constraints.
DELETE FROM "battlenet_accounts";

ALTER TABLE "battlenet_accounts"
  ADD COLUMN IF NOT EXISTS "provider_account_id" TEXT,
  ADD COLUMN IF NOT EXISTS "battletag_display" TEXT,
  ADD COLUMN IF NOT EXISTS "unlinked_at" TIMESTAMPTZ(3),
  ADD COLUMN IF NOT EXISTS "access_token_encrypted" TEXT,
  ADD COLUMN IF NOT EXISTS "refresh_token_encrypted" TEXT,
  ADD COLUMN IF NOT EXISTS "token_expires_at" TIMESTAMPTZ(3),
  ADD COLUMN IF NOT EXISTS "granted_scopes" TEXT,
  ADD COLUMN IF NOT EXISTS "last_ownership_sync_at" TIMESTAMPTZ(3),
  ADD COLUMN IF NOT EXISTS "last_ownership_sync_error" TEXT;

ALTER TABLE "battlenet_accounts"
  ALTER COLUMN "user_id" SET NOT NULL,
  ALTER COLUMN "region_id" DROP NOT NULL,
  ALTER COLUMN "linked_at" SET DEFAULT CURRENT_TIMESTAMP,
  ALTER COLUMN "linked_at" SET NOT NULL,
  ALTER COLUMN "claimed" SET DEFAULT true,
  ALTER COLUMN "provider_account_id" SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "battlenet_accounts_provider_account_id_key"
  ON "battlenet_accounts"("provider_account_id");
CREATE INDEX IF NOT EXISTS "battlenet_accounts_user_id_idx" ON "battlenet_accounts"("user_id");
CREATE INDEX IF NOT EXISTS "battlenet_accounts_battletag_hash_idx" ON "battlenet_accounts"("battletag_hash");

ALTER TABLE "battlenet_accounts"
  ADD CONSTRAINT "battlenet_accounts_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "battlenet_accounts"
  ADD CONSTRAINT "battlenet_accounts_region_id_fkey"
    FOREIGN KEY ("region_id") REFERENCES "regions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Evolve users stub.
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "disabled_at" TIMESTAMPTZ(3),
  ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "entitlements" DROP CONSTRAINT IF EXISTS "entitlements_user_id_fkey";
ALTER TABLE "entitlements"
  ADD CONSTRAINT "entitlements_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "entitlements_user_id_key_idx" ON "entitlements"("user_id", "key");

CREATE TABLE "external_identities" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "provider" TEXT NOT NULL,
  "subject" TEXT NOT NULL,
  "display_name" TEXT,
  "raw_profile" JSONB NOT NULL DEFAULT '{}',
  "linked_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_login_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "external_identities_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "external_identities_provider_subject_key" ON "external_identities"("provider", "subject");
CREATE INDEX "external_identities_user_id_idx" ON "external_identities"("user_id");
ALTER TABLE "external_identities"
  ADD CONSTRAINT "external_identities_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "user_sessions" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "token_hash" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  "rotated_from_id" UUID,
  "revoked_at" TIMESTAMPTZ(3),
  "ip_hash" TEXT,
  "user_agent_hash" TEXT,
  "last_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "user_sessions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "user_sessions_token_hash_key" ON "user_sessions"("token_hash");
CREATE INDEX "user_sessions_user_id_expires_at_idx" ON "user_sessions"("user_id", "expires_at");
ALTER TABLE "user_sessions"
  ADD CONSTRAINT "user_sessions_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "roles" (
  "id" UUID NOT NULL,
  "key" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "roles_key_key" ON "roles"("key");

CREATE TABLE "permissions" (
  "id" UUID NOT NULL,
  "key" TEXT NOT NULL,
  "description" TEXT,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "permissions_key_key" ON "permissions"("key");

CREATE TABLE "role_permissions" (
  "role_id" UUID NOT NULL,
  "permission_id" UUID NOT NULL,
  CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("role_id", "permission_id")
);
ALTER TABLE "role_permissions"
  ADD CONSTRAINT "role_permissions_role_id_fkey"
    FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "role_permissions"
  ADD CONSTRAINT "role_permissions_permission_id_fkey"
    FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "user_role_assignments" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "role_id" UUID NOT NULL,
  "granted_by" UUID,
  "granted_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at" TIMESTAMPTZ(3),
  CONSTRAINT "user_role_assignments_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "user_role_assignments_user_id_role_id_key" ON "user_role_assignments"("user_id", "role_id");
CREATE INDEX "user_role_assignments_role_id_idx" ON "user_role_assignments"("role_id");
ALTER TABLE "user_role_assignments"
  ADD CONSTRAINT "user_role_assignments_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_role_assignments"
  ADD CONSTRAINT "user_role_assignments_role_id_fkey"
    FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "verified_character_ownerships" (
  "id" UUID NOT NULL,
  "battlenet_account_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "character_id" UUID,
  "blizzard_character_id" BIGINT NOT NULL,
  "region_id" UUID NOT NULL,
  "realm_slug" TEXT NOT NULL,
  "realm_name" TEXT,
  "character_name" TEXT NOT NULL,
  "normalized_name" TEXT NOT NULL,
  "playable_class_id" INTEGER,
  "playable_race_id" INTEGER,
  "character_level" INTEGER,
  "faction" TEXT,
  "confidence" "AccountLinkConfidence" NOT NULL DEFAULT 'CONFIRMED',
  "source" TEXT NOT NULL,
  "status" "OwnershipStatus" NOT NULL DEFAULT 'CURRENT',
  "is_primary" BOOLEAN NOT NULL DEFAULT false,
  "verified_at" TIMESTAMPTZ(3) NOT NULL,
  "last_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revoked_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "verified_character_ownerships_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "verified_character_ownerships_battlenet_account_id_blizzard_character_id_key"
  ON "verified_character_ownerships"("battlenet_account_id", "blizzard_character_id");
CREATE INDEX "verified_character_ownerships_user_id_status_idx"
  ON "verified_character_ownerships"("user_id", "status");
CREATE INDEX "verified_character_ownerships_character_id_idx"
  ON "verified_character_ownerships"("character_id");
CREATE INDEX "verified_character_ownerships_region_id_realm_slug_normalized_name_idx"
  ON "verified_character_ownerships"("region_id", "realm_slug", "normalized_name");
ALTER TABLE "verified_character_ownerships"
  ADD CONSTRAINT "verified_character_ownerships_battlenet_account_id_fkey"
    FOREIGN KEY ("battlenet_account_id") REFERENCES "battlenet_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "verified_character_ownerships"
  ADD CONSTRAINT "verified_character_ownerships_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "verified_character_ownerships"
  ADD CONSTRAINT "verified_character_ownerships_character_id_fkey"
    FOREIGN KEY ("character_id") REFERENCES "characters"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "verified_character_ownerships"
  ADD CONSTRAINT "verified_character_ownerships_region_id_fkey"
    FOREIGN KEY ("region_id") REFERENCES "regions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "audit_events" (
  "id" UUID NOT NULL,
  "user_id" UUID,
  "actor_type" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "resource_type" TEXT,
  "resource_id" TEXT,
  "outcome" "AuditOutcome" NOT NULL DEFAULT 'SUCCESS',
  "ip_hash" TEXT,
  "user_agent_hash" TEXT,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "audit_events_user_id_created_at_idx" ON "audit_events"("user_id", "created_at");
CREATE INDEX "audit_events_action_created_at_idx" ON "audit_events"("action", "created_at");
ALTER TABLE "audit_events"
  ADD CONSTRAINT "audit_events_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "feature_grants" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "feature_key" TEXT NOT NULL,
  "starts_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "ends_at" TIMESTAMPTZ(3),
  "usage_limit" INTEGER,
  "usage_count" INTEGER NOT NULL DEFAULT 0,
  "source" TEXT NOT NULL,
  "granted_by" UUID,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "feature_grants_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "feature_grants_user_id_feature_key_idx" ON "feature_grants"("user_id", "feature_key");
ALTER TABLE "feature_grants"
  ADD CONSTRAINT "feature_grants_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
