/**
 * Retired — score-model-only cleanup is now one part of the general
 * test-artifacts cleanup (score models + ingestion jobs + characters + bulk
 * operations + realms/dungeons/seasons + mechanic rules + Redis/BullMQ).
 *
 * This file no longer forwards to the general purge automatically: silently
 * running the full cleanup under the old model-only command name could
 * surprise a caller who only wanted to touch score models. It fails loudly
 * with migration guidance instead.
 *
 * Usage:
 *   pnpm db:cleanup:test-artifacts -- --dry-run
 *   pnpm db:cleanup:test-artifacts -- --dry-run --models-only   (score models only)
 */
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { assertCleanupTargetAllowed, parseArgs } from "./cleanup-test-artifacts.mjs";

function isMainModule() {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return import.meta.url === pathToFileURL(resolve(entry)).href;
  } catch {
    return entry.replace(/\\/g, "/").endsWith("/tools/scripts/cleanup-test-score-models.mjs");
  }
}

if (isMainModule()) {
  console.error("db:cleanup:test-score-models is retired.");
  console.error("Use: pnpm db:cleanup:test-artifacts -- --dry-run");
  console.error("Or for models-only: pnpm db:cleanup:test-artifacts -- --dry-run --models-only");
  process.exit(2);
}

export { assertCleanupTargetAllowed, parseArgs };
