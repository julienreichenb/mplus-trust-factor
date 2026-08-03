import { Redis } from "ioredis";
import { describe, expect, it } from "vitest";
import { loadEnv } from "@mplus/config";
import { QUEUE_NAMES } from "@mplus/contracts";
import type { PrismaClient } from "@mplus/database";
import { createWorkerContainer } from "./container.js";
import { closeWorkers, createWorkers } from "./processors.js";

/** Queue identities that `createWorkers` must always register (order matches return array). */
const EXPECTED_WORKER_QUEUES = [
  QUEUE_NAMES.refreshCharacter,
  QUEUE_NAMES.refreshCharacterCalibration,
  QUEUE_NAMES.analyzeRun,
  QUEUE_NAMES.recalculateScore,
  QUEUE_NAMES.generateAddonExport,
  QUEUE_NAMES.discoverOwnedCharacters,
  QUEUE_NAMES.bulkCharacterProcessing,
  QUEUE_NAMES.calibrationRun,
  QUEUE_NAMES.scoringV2EvidenceExport,
  QUEUE_NAMES.scoringV2ShadowCanary,
  QUEUE_NAMES.analyzeEvidenceSlot,
  QUEUE_NAMES.finalizeAnalysisBatch,
] as const;

describe("worker shutdown", () => {
  it(
    "creates workers for every expected queue and closes them without hanging",
    async () => {
      const env = loadEnv();
      const connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
      // Processors never run (autorun: false, .run() never called), so Prisma is never touched.
      const container = createWorkerContainer(env, { prisma: {} as PrismaClient });

      const workers = createWorkers(connection, container);
      expect(workers.map((worker) => worker.name)).toEqual([...EXPECTED_WORKER_QUEUES]);

      await closeWorkers(workers);
      await connection.quit();
    },
    15_000,
  );
});
