import { randomUUID } from "node:crypto";
import { loadEnv, resetEnvCache, type AppEnv } from "@mplus/config";
import { checkDatabaseHealth, createPrismaClient, type PrismaClient } from "@mplus/database";
import type { ScoreModelConfig } from "@mplus/contracts";
import {
  assertTestDatabaseAllowed,
  BOOTSTRAP_TEST_RELEASE_PIN,
  isCanonicalScoreModelKey,
  isTestOwnedScoreModelKey,
  sanitizeDatabaseUrl,
} from "@mplus/test-utils";
import { AbilityCatalogReleaseService } from "./services/ability-catalog-release-service.js";
import { AbilityCatalogReleaseActivationService } from "./services/ability-catalog-release-activation-service.js";

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

const testCatalogAudit = {
  userId: null as string | null,
  actorType: "system" as const,
  sessionSecret: "test-session-secret-at-least-32-chars",
};

const CATALOG_ACTIVE_TEST_LOCK_KEY = 0x4d50_4c53; // "MPLS"

let catalogActiveLockPrisma: PrismaClient | null = null;

function catalogActiveLockClient(): PrismaClient {
  if (!catalogActiveLockPrisma) {
    // connection_limit=1 keeps lock+unlock on the same Postgres session.
    const url = new URL(TEST_DATABASE_URL);
    url.searchParams.set("connection_limit", "1");
    catalogActiveLockPrisma = createPrismaClient(url.toString());
  }
  return catalogActiveLockPrisma;
}

/**
 * Serializes ACTIVE-catalog mutations across parallel integration tests.
 * Uses a Postgres session advisory lock on a dedicated single-connection client so
 * Vitest worker processes sharing the isolated DB cannot flip ACTIVE under each other.
 * (In-memory Promise locks do not span workers.)
 */
export async function withCatalogActiveTestLock<T>(
  _prisma: PrismaClient,
  fn: () => Promise<T>,
): Promise<T> {
  const lockPrisma = catalogActiveLockClient();
  await lockPrisma.$executeRaw`SELECT pg_advisory_lock(${CATALOG_ACTIVE_TEST_LOCK_KEY})`;
  try {
    return await fn();
  } finally {
    await lockPrisma.$executeRaw`SELECT pg_advisory_unlock(${CATALOG_ACTIVE_TEST_LOCK_KEY})`;
  }
}

/** Clears ACTIVE for activation failure tests — always pair with ensureActive in finally. */
export async function resetActiveCatalogReleaseForTests(prisma: PrismaClient): Promise<void> {
  await withCatalogActiveTestLock(prisma, async () => {
    await prisma.abilityCatalogRelease.updateMany({
      where: { status: "ACTIVE" },
      data: { status: "SUPERSEDED" },
    });
  });
}

/**
 * Ensures Bootstrap Release 0 is ACTIVE for integration tests.
 * Safe to call repeatedly; restores singleton ACTIVE state after tests that reset it.
 */
export async function ensureActiveBootstrapCatalogReleaseForTests(
  prisma: PrismaClient,
): Promise<void> {
  await withCatalogActiveTestLock(prisma, async () => {
    await ensureActiveBootstrapCatalogReleaseUnlocked(prisma);
  });
}

/** Caller must already hold `withCatalogActiveTestLock`. */
export async function ensureActiveBootstrapCatalogReleaseUnlocked(
  prisma: PrismaClient,
): Promise<void> {
  const releases = new AbilityCatalogReleaseService(prisma);
  const activation = new AbilityCatalogReleaseActivationService(prisma);
  const boot = await releases.persistBootstrapRelease0(testCatalogAudit);

  const existing = await prisma.abilityCatalogRelease.findFirst({
    where: { status: "ACTIVE" },
  });
  // Require Bootstrap specifically — a non-Bootstrap ACTIVE still fails closed for suites
  // that pin verifiedContractHash to Bootstrap (shared DB across parallel workers).
  if (existing?.id === boot.release.id) return;

  const replay = await prisma.abilityCatalogReleaseReplay.findFirst({
    where: { candidateReleaseId: boot.release.id, status: "PASSED" },
  });
  if (!replay) {
    await prisma.abilityCatalogReleaseReplay.create({
      data: {
        idempotencyKey: `test-ensure-active|${boot.release.id}|${randomUUID()}`,
        baseKind: "STATIC",
        baseReleaseId: null,
        candidateReleaseId: boot.release.id,
        corpusDigest: "0".repeat(64),
        replayInputDigest: "1".repeat(64),
        replayEngineVersion: "test",
        status: "PASSED",
        summary: { changedAnalyses: 0, unresolvedFailures: 0 },
        startedAt: new Date(),
        completedAt: new Date(),
      },
    });
  }

  await prisma.abilityCatalogRelease.update({
    where: { id: boot.release.id },
    data: { contentDigest: BOOTSTRAP_TEST_RELEASE_PIN.contentDigest, status: "VALIDATED" },
  });
  await activation.activate(
    {
      releaseId: boot.release.id,
      confirmationDigest: BOOTSTRAP_TEST_RELEASE_PIN.contentDigest,
      confirm: true,
      reason: existing ? "restore Bootstrap ACTIVE for tests" : undefined,
      expectedPreviousActiveId: existing?.id ?? null,
    },
    testCatalogAudit,
    { type: existing ? "ROLLBACK" : "PUBLISH" },
  );
}

/**
 * Runs fn while no ACTIVE catalog exists, then restores Bootstrap ACTIVE before releasing the lock.
 * Use for activation failure tests so parallel suites never observe a missing ACTIVE release.
 */
export async function withInactiveCatalogReleaseForTests<T>(
  prisma: PrismaClient,
  fn: () => Promise<T>,
): Promise<T> {
  return withCatalogActiveTestLock(prisma, async () => {
    await prisma.abilityCatalogRelease.updateMany({
      where: { status: "ACTIVE" },
      data: { status: "SUPERSEDED" },
    });
    try {
      return await fn();
    } finally {
      await ensureActiveBootstrapCatalogReleaseUnlocked(prisma);
    }
  });
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

/**
 * Best-effort cleanup of IngestionJobs + Characters created by a suite.
 * Deletes only the given IDs. Jobs first (Restrict FK), then characters.
 * Isolation remains primary protection.
 */
export async function cleanupTrackedIngestionJobs(
  prisma: PrismaClient,
  jobIds: readonly string[],
): Promise<void> {
  for (const id of jobIds) {
    try {
      await prisma.refreshAdmission.deleteMany({ where: { jobId: id } });
      await prisma.ingestionJob.delete({ where: { id } });
    } catch (err) {
      console.warn(
        `Best-effort ingestion job cleanup failed for id=${id}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
}

/**
 * Best-effort cleanup of Characters created by a suite (and remaining jobs).
 * Never deletes characters with verified ownership.
 */
export async function cleanupTrackedCharacters(
  prisma: PrismaClient,
  characterIds: readonly string[],
): Promise<void> {
  for (const id of characterIds) {
    try {
      const ownership = await prisma.verifiedCharacterOwnership.count({
        where: { characterId: id },
      });
      if (ownership > 0) {
        console.warn(`Refusing to delete character id=${id}: verified ownership present`);
        continue;
      }

      const jobs = await prisma.ingestionJob.findMany({
        where: { characterId: id },
        select: { id: true },
      });
      await cleanupTrackedIngestionJobs(
        prisma,
        jobs.map((j) => j.id),
      );

      await prisma.characterProviderState.deleteMany({ where: { characterId: id } });
      await prisma.characterProfileView.deleteMany({ where: { characterId: id } });
      await prisma.refreshScheduleItem.deleteMany({ where: { characterId: id } });
      await prisma.bulkOperationItem.updateMany({
        where: { characterId: id },
        data: { characterId: null },
      });
      await prisma.characterAlias.deleteMany({ where: { characterId: id } });
      await prisma.metricObservation.deleteMany({ where: { characterId: id } });
      await prisma.characterRedFlag.deleteMany({ where: { characterId: id } });
      await prisma.scoreDispute.deleteMany({ where: { characterId: id } });
      await prisma.characterPublishedScore.deleteMany({ where: { characterId: id } });

      const snapshots = await prisma.scoreSnapshot.findMany({
        where: { characterId: id },
        select: { id: true },
      });
      if (snapshots.length > 0) {
        const snapshotIds = snapshots.map((s) => s.id);
        await prisma.dimensionScore.deleteMany({
          where: { scoreSnapshotId: { in: snapshotIds } },
        });
        await prisma.scoreSnapshot.deleteMany({ where: { characterId: id } });
      }

      await prisma.equipmentSnapshot.deleteMany({
        where: { characterSnapshot: { characterId: id } },
      });
      await prisma.talentSnapshot.deleteMany({
        where: { characterSnapshot: { characterId: id } },
      });
      await prisma.characterSnapshot.deleteMany({ where: { characterId: id } });
      await prisma.scoreAnalysisBatch.deleteMany({ where: { characterId: id } });
      await prisma.refreshCostLedgerEntry.updateMany({
        where: { characterId: id },
        data: { characterId: null },
      });
      await prisma.refreshAdmission.updateMany({
        where: { characterId: id },
        data: { characterId: null },
      });

      await prisma.character.delete({ where: { id } });
    } catch (err) {
      console.warn(
        `Best-effort character cleanup failed for id=${id}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
}
