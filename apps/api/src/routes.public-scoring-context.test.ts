import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "@mplus/database";
import { SeasonScoreContextRepository } from "@mplus/database";
import type { QueueProducers } from "@mplus/worker";
import { buildApp } from "./app.js";
import { createApiContainer, type ApiContainer } from "./container.js";
import { buildTestEnv, createTestPrismaClient, uniqueName } from "./test-helpers.js";
import { PublicScoringContextService } from "./services/public-scoring-context-service.js";

const { prisma, dbAvailable } = await createTestPrismaClient();
const ADMIN_KEY = "test-admin-key-public-ctx";

afterAll(async () => {
  await prisma.$disconnect();
});

function stubProducers(): QueueProducers {
  const ok = async () => ({
    jobId: randomUUID(),
    dedupeKey: `stub-${randomUUID()}`,
    reused: false,
    enqueued: true,
  });
  return {
    enqueueRefreshCharacter: ok,
    enqueueAnalyzeRun: ok,
    enqueueRecalculateScore: ok,
    enqueueGenerateAddonExport: ok,
    enqueueDiscoverOwnedCharacters: ok,
    enqueueBulkCharacterProcessing: ok,
    enqueueCalibrationRun: ok,
    enqueueScoringEvidenceExport: ok,
    enqueueAnalyzeEvidenceSlot: ok,
    enqueueFinalizeEvidenceBatch: ok,
    enqueueKeyDistributionRefresh: ok,
    enqueueScoringSeasonDataSync: ok,
    registerScoringSeasonDataSyncSchedule: async () => undefined,
    getRefreshCharacterQueue: () => null,
    getCalibrationRunQueue: () => null,
    close: async () => undefined,
  } as QueueProducers;
}

describe.skipIf(!dbAvailable)("public scoring context", { timeout: 40_000 }, () => {
  let app: FastifyInstance;
  let container: ApiContainer;

  beforeAll(async () => {
    const env = buildTestEnv({ ADMIN_API_KEY: ADMIN_KEY });
    container = createApiContainer(env, {
      workerOverrides: { prisma: prisma as PrismaClient },
      producers: stubProducers(),
      skipQueues: true,
    });
    app = await buildApp({ env, container });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("is publicly readable and never includes draft scoring context", async () => {
    const response = await app.inject({ method: "GET", url: "/api/v1/scoring/context" });
    expect(response.statusCode).toBe(200);
    const body = response.json() as Record<string, unknown>;
    expect(body).not.toHaveProperty("draft");
    expect(typeof body.available).toBe("boolean");
  });

  it("uses the published revision rather than a later draft", async () => {
    const region = await prisma.region.findFirst();
    if (!region) throw new Error("Need a region");
    const blizzardSeasonId = 89_000 + Math.floor(Math.random() * 999);
    const season = await prisma.season.create({
      data: {
        id: randomUUID(),
        slug: uniqueName("faq-ctx"),
        name: "FAQ published context season",
        regionId: region.id,
        blizzardSeasonId,
        isCurrent: false,
      },
    });
    const repo = new SeasonScoreContextRepository(prisma as PrismaClient);
    const publishedDraft = await repo.createDraft({
      blizzardSeasonId,
      seasonId: season.id,
      tierFactors: { 1: 1.1, 2: 1.1, 3: 1.1, 4: 1.1, 5: 1.1 },
    });
    const published = await repo.publish(publishedDraft.id);
    await repo.createDraft({
      blizzardSeasonId,
      seasonId: season.id,
      tierFactors: { 1: 0.5, 2: 0.5, 3: 0.5, 4: 0.5, 5: 0.5 },
    });

    const spy = vi.spyOn(prisma.season, "findFirst").mockResolvedValue(season as never);
    try {
      const body = await new PublicScoringContextService(prisma as PrismaClient).getPublished();
      expect(body).not.toHaveProperty("draft");
      expect(body.available).toBe(true);
      expect(body.revision?.id).toBe(published.id);
      expect(body.revision?.version).toBe(published.version);
      expect(body.meta?.tierFactors[5]).toBe(1.1);
      expect(body.meta?.tierFactors[5]).not.toBe(0.5);

      const http = await app.inject({ method: "GET", url: "/api/v1/scoring/context" });
      expect(http.statusCode).toBe(200);
      const payload = http.json();
      expect(payload.available).toBe(true);
      expect(payload.meta.tierFactors[5] ?? payload.meta.tierFactors["5"]).toBe(1.1);
      expect(payload.meta.tierFactors[1] ?? payload.meta.tierFactors["1"]).toBe(1.1);
    } finally {
      spy.mockRestore();
    }
  });
});
