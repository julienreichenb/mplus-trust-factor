import { Redis } from "ioredis";
import { describe, expect, it } from "vitest";
import { loadEnv } from "@mplus/config";
import type { PrismaClient } from "@mplus/database";
import { createWorkerContainer } from "./container.js";
import { closeWorkers, createWorkers } from "./processors.js";

describe("worker shutdown", () => {
  it(
    "creates all four queue workers and closes them without hanging",
    async () => {
      const env = loadEnv();
      const connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
      // Processors never run (autorun: false, .run() never called), so Prisma is never touched.
      const container = createWorkerContainer(env, { prisma: {} as PrismaClient });

      const workers = createWorkers(connection, container);
      expect(workers).toHaveLength(4);

      await closeWorkers(workers);
      await connection.quit();
    },
    15_000,
  );
});
