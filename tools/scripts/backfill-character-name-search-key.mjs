#!/usr/bin/env node
/**
 * Backfill characters.name_search_key with normalizeCharacterSearchKey (foldDiacritics).
 *
 * When to run:
 * - After deploying migration 20260731140000_character_name_search_key (once per DB).
 * - The migration's SQL seed is ASCII lower/trim only and is NOT foldDiacritics-compatible.
 * - Safe to re-run; skips rows already matching the folded key.
 * - Normal write paths (upsertCharacter / applyProviderProfile) already maintain the key.
 *
 * Usage:
 *   pnpm db:backfill:character-name-search-key
 *   pnpm db:backfill:character-name-search-key -- --batch-size 200
 */
import { loadEnv } from "@mplus/config";
import { createLogger } from "@mplus/observability";
import { backfillCharacterNameSearchKeys, createWorkerContainer } from "@mplus/worker";

function parseBatchSize(argv) {
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--batch-size" && argv[i + 1]) {
      const n = Number(argv[++i]);
      if (!Number.isInteger(n) || n < 1) {
        throw new Error(`Invalid --batch-size: ${argv[i]}`);
      }
      return n;
    }
    if (argv[i] === "--help" || argv[i] === "-h") {
      console.log("Usage: db:backfill:character-name-search-key [--batch-size N]");
      process.exit(0);
    }
  }
  return 500;
}

const env = loadEnv();
const logger = createLogger({ level: env.LOG_LEVEL, name: "name-search-key-backfill" });
const batchSize = parseBatchSize(process.argv.slice(2));
const container = createWorkerContainer(env);

try {
  const result = await backfillCharacterNameSearchKeys(container.prisma, { batchSize });
  logger.info({ ...result, batchSize }, "character name_search_key backfill complete");
  console.log(JSON.stringify({ ok: true, batchSize, ...result }, null, 2));
  process.exit(0);
} catch (error) {
  logger.error({ err: error }, "character name_search_key backfill failed");
  process.exit(1);
} finally {
  await container.prisma.$disconnect();
}
