import { randomUUID } from "node:crypto";
import { loadEnv, resetEnvCache, type AppEnv } from "@mplus/config";
import { checkDatabaseHealth, createPrismaClient, type PrismaClient } from "@mplus/database";
import type { ScoreModelConfig } from "@mplus/contracts";
import {
  assertTestDatabaseAllowed,
  isCanonicalScoreModelKey,
  isTestOwnedScoreModelKey,
  sanitizeDatabaseUrl,
} from "@mplus/test-utils";

/** Shared test fixtures for API route inject tests (`*.test.ts`), not itself a test suite. */

/** Must be set by `pnpm test` / `run-tests-isolated.mjs` — never falls back to the dev DB. */
export const TEST_DATABASE_URL = process.env.DATABASE_URL ?? "";
export const TEST_REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";

export function buildTestEnv(overrides: Record<string, string> = {}): AppEnv {
  assertTestDatabaseAllowed(TEST_DATABASE_URL);
  resetEnvCache();
  return loadEnv({
    ...process.env,
    DATABASE_URL: TEST_DATABASE_URL,
    REDIS_URL: TEST_REDIS_URL,
    ADMIN_API_KEY: "test-admin-key",
    ADMIN_API_KEY_EMERGENCY_FALLBACK: "true",
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
  assertTestDatabaseAllowed(TEST_DATABASE_URL);
  const prisma = createPrismaClient(TEST_DATABASE_URL);
  const health = await checkDatabaseHealth(prisma);
  if (!health.ok) {
    console.warn(
      `Skipping API route tests: PostgreSQL not reachable at ${sanitizeDatabaseUrl(TEST_DATABASE_URL)}. ` +
        `Run "pnpm bootstrap" or "pnpm dev:infra" first. ${health.error ?? ""}`,
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

/**
 * Best-effort cleanup of score models created by a test suite.
 * Deletes only the given IDs (never by status, never canonical `default`).
 * Isolation is primary: FK failures are logged and skipped.
 */
export async function cleanupTrackedScoreModels(
  prisma: PrismaClient,
  modelIds: readonly string[],
): Promise<void> {
  for (const id of modelIds) {
    try {
      const model = await prisma.scoreModel.findUnique({ where: { id } });
      if (!model) continue;
      if (isCanonicalScoreModelKey(model.key)) {
        console.warn(`Refusing to delete canonical score model key=${model.key} id=${id}`);
        continue;
      }
      if (!isTestOwnedScoreModelKey(model.key)) {
        console.warn(`Refusing to delete non-test-owned score model key=${model.key} id=${id}`);
        continue;
      }

      const snapshots = await prisma.scoreSnapshot.findMany({
        where: { scoreModelId: id },
        select: { id: true },
      });
      const snapshotIds = snapshots.map((s) => s.id);
      if (snapshotIds.length > 0) {
        await prisma.characterPublishedScore.deleteMany({
          where: { publishedSnapshotId: { in: snapshotIds } },
        });
        await prisma.dimensionScore.deleteMany({
          where: { scoreSnapshotId: { in: snapshotIds } },
        });
        await prisma.scoreDispute.deleteMany({
          where: { scoreSnapshotId: { in: snapshotIds } },
        });
        await prisma.scoreSnapshot.deleteMany({ where: { scoreModelId: id } });
      }

      await prisma.characterPublishedScore.deleteMany({ where: { scoreModelId: id } });
      await prisma.characterRedFlag.deleteMany({ where: { scoreModelId: id } });
      await prisma.addonExport.deleteMany({ where: { scoreModelId: id } });

      const batches = await prisma.scoreAnalysisBatch.findMany({
        where: { scoreModelId: id },
        select: { id: true },
      });
      if (batches.length > 0) {
        const batchIds = batches.map((b) => b.id);
        await prisma.scoreSnapshot.updateMany({
          where: { analysisBatchId: { in: batchIds } },
          data: { analysisBatchId: null },
        });
        await prisma.scoreAnalysisBatchRun.deleteMany({
          where: { batchId: { in: batchIds } },
        });
        await prisma.scoreAnalysisBatch.deleteMany({ where: { scoreModelId: id } });
      }

      // BulkOperation.scoreModelId is onDelete: SetNull
      await prisma.scoreModel.delete({ where: { id } });
    } catch (err) {
      console.warn(
        `Best-effort score model cleanup failed for id=${id}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
}
