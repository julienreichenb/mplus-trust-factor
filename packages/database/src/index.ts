import { PrismaClient } from "@prisma/client";

export type { PrismaClient } from "@prisma/client";
export * from "@prisma/client";
export * from "./repositories/index.js";
export {
  backfillScoringMinimalCache,
  type ScoringCacheBackfillReport,
  type ScoringCacheBackfillOptions,
} from "./backfill-scoring-minimal-cache.js";
export {
  assertScoringTestResetAllowed,
  formatScoringResetGuardFailure,
  SCORING_RESET_CONFIRMATION_TOKEN,
  SCORING_RESET_TRUNCATE_TABLES,
  SCORING_RESET_RETAINED_TABLES,
  type ScoringResetGuardInput,
  type ScoringResetGuardResult,
} from "./reset/v2-test-reset-guard.js";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

export function createPrismaClient(databaseUrl?: string): PrismaClient {
  return new PrismaClient({
    datasources: databaseUrl
      ? {
          db: { url: databaseUrl },
        }
      : undefined,
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export async function checkDatabaseHealth(client: PrismaClient = prisma): Promise<{
  ok: boolean;
  latencyMs: number;
  error?: string;
}> {
  const started = Date.now();
  try {
    await client.$queryRaw`SELECT 1`;
    return { ok: true, latencyMs: Date.now() - started };
  } catch (err) {
    return {
      ok: false,
      latencyMs: Date.now() - started,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
