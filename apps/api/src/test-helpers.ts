import { randomUUID } from "node:crypto";
import { loadEnv, resetEnvCache, type AppEnv } from "@mplus/config";
import { checkDatabaseHealth, createPrismaClient, type PrismaClient } from "@mplus/database";
import type { ScoreModelConfig } from "@mplus/contracts";

/** Shared test fixtures for API route inject tests (`*.test.ts`), not itself a test suite. */

export const TEST_DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://mplus:mplus@localhost:5433/mplus_trust?schema=public";
export const TEST_REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";

export function buildTestEnv(overrides: Record<string, string> = {}): AppEnv {
  resetEnvCache();
  return loadEnv({
    ...process.env,
    DATABASE_URL: TEST_DATABASE_URL,
    REDIS_URL: TEST_REDIS_URL,
    ADMIN_API_KEY: "test-admin-key",
    SESSION_SECRET: "test-session-secret-at-least-32-chars",
    PROVIDER_MODE: "fixture",
    WEB_ORIGIN: "http://localhost:5173",
    PUBLIC_BASE_URL: "http://localhost:3000",
    ...overrides,
  });
}

export function uniqueName(prefix: string): string {
  return `${prefix}-${randomUUID().slice(0, 8)}`;
}

/** Mirrors the DB-availability guard pattern used by `apps/worker/src/refresh-pipeline.test.ts`. */
export async function createTestPrismaClient(): Promise<{ prisma: PrismaClient; dbAvailable: boolean }> {
  const prisma = createPrismaClient(TEST_DATABASE_URL);
  const health = await checkDatabaseHealth(prisma);
  if (!health.ok) {
    console.warn(
      `Skipping API route tests: PostgreSQL not reachable at ${TEST_DATABASE_URL}. Run "pnpm dev:infra" first. ${health.error ?? ""}`,
    );
  }
  return { prisma, dbAvailable: health.ok };
}

export function buildScoreModelConfig(key: string): ScoreModelConfig {
  return {
    key,
    version: 1,
    weights: {
      performance: 0.32,
      survival: 0.27,
      utility: 0.23,
      experienceConsistency: 0.13,
      mythicRaid: 0.05,
    },
    authenticityBlend: { skillWeight: 0.6, authenticityWeight: 0.4 },
    confidenceNeutralScore: 50,
    gradeThresholds: { S: 90, A: 80, B: 65, C: 50 },
  };
}
