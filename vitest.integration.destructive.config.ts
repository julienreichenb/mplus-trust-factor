import { createIntegrationConfig } from "./vitest.integration.base.ts";
import { DESTRUCTIVE_INTEGRATION_FILES } from "./vitest.integration.destructive-files.ts";

/**
 * Destructive integration suite (identity-data reset / TRUNCATE).
 * Runs in its own disposable DB via a separate run-tests-isolated invocation.
 * Serial file execution keeps multiple destructive files from fighting each other.
 */
export default createIntegrationConfig({
  include: [...DESTRUCTIVE_INTEGRATION_FILES],
  exclude: ["**/node_modules/**", "**/dist/**"],
  fileParallelism: false,
});
