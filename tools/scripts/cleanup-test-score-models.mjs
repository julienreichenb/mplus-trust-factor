/**
 * Deprecated alias — use cleanup-test-artifacts.mjs.
 *
 * Score-model cleanup is now one part of the general test-artifacts cleanup
 * (score models + ingestion jobs + characters + bulk operations + realms/
 * dungeons/seasons + mechanic rules + Redis/BullMQ). Kept as a thin forwarder
 * so existing tooling/CI references keep working.
 *
 * Usage:
 *   pnpm db:cleanup:test-score-models -- --dry-run
 *   pnpm db:cleanup:test-score-models -- --confirm
 */
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  assertCleanupTargetAllowed,
  parseArgs,
  runCleanup,
} from "./cleanup-test-artifacts.mjs";

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
  runCleanup(process.argv.slice(2)).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

export { assertCleanupTargetAllowed, parseArgs, runCleanup };
