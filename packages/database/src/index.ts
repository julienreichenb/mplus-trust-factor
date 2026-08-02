import { PrismaClient } from "@prisma/client";

export type { PrismaClient } from "@prisma/client";
export * from "@prisma/client";
export * from "./repositories/index.js";
export {
  assertScoringV2TestResetAllowed,
  formatScoringV2ResetGuardFailure,
  SCORING_V2_RESET_CONFIRMATION_TOKEN,
  SCORING_V2_RESET_TRUNCATE_TABLES,
  SCORING_V2_RESET_RETAINED_TABLES,
  type ScoringV2ResetGuardInput,
  type ScoringV2ResetGuardResult,
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
  } catch (error) {
    return {
      ok: false,
      latencyMs: Date.now() - started,
      error: error instanceof Error ? error.message : "Unknown database error",
    };
  }
}
