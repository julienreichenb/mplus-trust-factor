import { createIntegrationConfig } from "./vitest.integration.base.ts";
import { DESTRUCTIVE_INTEGRATION_FILES } from "./vitest.integration.destructive-files.ts";

/**
 * Shared (non-destructive) integration suite.
 * Excludes whole-database reset/TRUNCATE tests so Vitest file parallelism
 * cannot deadlock against AccessExclusiveLock.
 */
export default createIntegrationConfig({
  include: ["**/*.integration.test.ts"],
  exclude: ["**/node_modules/**", "**/dist/**", ...DESTRUCTIVE_INTEGRATION_FILES],
});
