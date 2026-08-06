/**
 * CLI: provider-free backfill of capability packages → WclRunRaw.
 *
 *   pnpm --filter @mplus/database backfill:scoring-cache
 *   pnpm --filter @mplus/database backfill:scoring-cache -- --dry-run
 *   pnpm --filter @mplus/database backfill:scoring-cache -- --limit 50
 */
import { createPrismaClient } from "./index.js";
import { backfillScoringMinimalCache } from "./backfill-scoring-minimal-cache.js";

function parseArgs(argv: string[]) {
  let dryRun = false;
  let limit: number | undefined;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dry-run") dryRun = true;
    if (arg === "--limit") {
      const n = Number(argv[i + 1]);
      if (Number.isFinite(n) && n > 0) limit = Math.floor(n);
      i += 1;
    }
  }
  return { dryRun, limit };
}

async function main() {
  const { dryRun, limit } = parseArgs(process.argv.slice(2));
  const prisma = createPrismaClient();
  try {
    const report = await backfillScoringMinimalCache({ prisma, dryRun, limit });
    console.log(JSON.stringify({ dryRun, limit: limit ?? null, ...report }, null, 2));
    if (report.rawInvalid > 0 && report.rawMigrated + report.rawReused === 0) {
      process.exitCode = 2;
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
