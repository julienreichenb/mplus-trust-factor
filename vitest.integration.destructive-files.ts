/**
 * Integration tests that perform whole-database destructive work
 * (TRUNCATE / identity reset / broad shared-table deletes).
 *
 * These must not share a disposable DB with the normal integration suite —
 * AccessExclusiveLock from TRUNCATE deadlocks with concurrent writers.
 */
export const DESTRUCTIVE_INTEGRATION_FILES = [
  "packages/database/src/identity-data-reset.integration.test.ts",
] as const;
