#!/usr/bin/env tsx
/**
 * Guarded destructive Scoring V2 test reset (Option A).
 *
 *   pnpm db:reset:scoring -- --confirm=RESET_scoring_TEST_DATA
 *   pnpm db:reset:scoring -- --confirm=RESET_scoring_TEST_DATA --execute
 */

import { PrismaClient } from "@prisma/client";
import {
  assertScoringTestResetAllowed,
  formatScoringResetGuardFailure,
  SCORING_RESET_RETAINED_TABLES,
  SCORING_RESET_TRUNCATE_TABLES,
} from "./v2-test-reset-guard.js";

function parseArgs(argv: string[]) {
  const out = {
    confirm: null as string | null,
    execute: false,
    allowNamedTestDb: false,
  };
  for (const arg of argv) {
    if (arg.startsWith("--confirm=")) out.confirm = arg.slice("--confirm=".length);
    else if (arg === "--execute") out.execute = true;
    else if (arg === "--allow-named-test-db") out.allowNamedTestDb = true;
  }
  return out;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const gate = assertScoringTestResetAllowed({
    confirmationToken: args.confirm ?? undefined,
    allowNamedTestDb: args.allowNamedTestDb,
  });
  if (!gate.ok) {
    console.error(formatScoringResetGuardFailure(gate));
    process.exit(2);
  }

  console.log("Scoring V2 test reset plan");
  console.log(`  target: ${gate.sanitized}`);
  console.log(`  mode: ${args.execute ? "EXECUTE" : "DRY-RUN"}`);
  console.log("  truncate:");
  for (const table of SCORING_RESET_TRUNCATE_TABLES) console.log(`    - ${table}`);
  console.log("  retain:");
  for (const table of SCORING_RESET_RETAINED_TABLES) console.log(`    - ${table}`);
  console.log("  prerequisite: export calibration cohort labels first");
  console.log("  rollback: restore from pre-reset pg_dump backup");

  if (!args.execute) {
    console.log("Dry-run complete. Re-run with --execute to truncate.");
    return;
  }

  const prisma = new PrismaClient({
    datasources: { db: { url: process.env.DATABASE_URL } },
  });
  try {
    const quoted = SCORING_RESET_TRUNCATE_TABLES.map((t) => `"${t}"`).join(", ");
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${quoted} RESTART IDENTITY CASCADE`);
    console.log("Truncate completed.");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
