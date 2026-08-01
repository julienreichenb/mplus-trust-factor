/**
 * Refresh-status ETA additive fields — backward compatible when flag off.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "@mplus/database";
import {
  clearSeasonAuthorityCacheForTests,
  resolveActiveRefreshContract,
  seedRefreshEligibilityEvidenceForTest,
  synchronizeSeasonAuthority,
} from "@mplus/worker";
import { buildApp } from "./app.js";
import { createApiContainer, type ApiContainer } from "./container.js";
import { buildTestEnv, createTestPrismaClient, uniqueName } from "./test-helpers.js";

const { prisma, dbAvailable } = await createTestPrismaClient();

afterAll(async () => {
  await prisma.$disconnect();
});

describe.skipIf(!dbAvailable)("refresh-status ETA fields", { timeout: 30_000 }, () => {
  const REALM_PATH = "EU/tarren-mill";

  describe("flag off (default)", () => {
    let app: FastifyInstance;
    let container: ApiContainer;

    beforeAll(async () => {
      clearSeasonAuthorityCacheForTests();
      const env = buildTestEnv({ REFRESH_ETA_ENABLED: "false" });
      container = createApiContainer(env, {
        workerOverrides: { prisma: prisma as PrismaClient },
        skipQueues: true,
      });
      app = await buildApp({ env, container });
      await app.ready();
    });

    afterAll(async () => {
      await app.close();
    });

    it("omits ETA fields on refresh-status (backward compatible)", async () => {
      const name = uniqueName("EtaOff");
      await seedRefreshEligibilityEvidenceForTest(container.worker, {
        region: "EU",
        realmSlug: "tarren-mill",
        name,
      });
      await app.inject({ method: "GET", url: `/api/v1/characters/${REALM_PATH}/${name}` });

      const status = await app.inject({
        method: "GET",
        url: `/api/v1/characters/${REALM_PATH}/${name}/refresh-status`,
      });
      expect(status.statusCode).toBe(200);
      const body = status.json();
      expect(body.characterId).toBeTruthy();
      expect(body.refreshStatus).toBeTruthy();
      if (body.job) {
        expect(body.job).not.toHaveProperty("queuePosition");
        expect(body.job).not.toHaveProperty("estimatedWaitSeconds");
        expect(body.job).not.toHaveProperty("schedulingState");
        expect(body.job).not.toHaveProperty("estimateConfidence");
        expect(body.job).not.toHaveProperty("activeRefreshCount");
        expect(body.job).not.toHaveProperty("effectiveWorkerCapacity");
        expect(body.job).not.toHaveProperty("observedThroughput");
      }
    });
  });

  describe("flag on", () => {
    let app: FastifyInstance;
    let container: ApiContainer;
    let verifiedContractHash: string;
    let verifiedSeasonId: number;

    beforeAll(async () => {
      clearSeasonAuthorityCacheForTests();
      const env = buildTestEnv({ REFRESH_ETA_ENABLED: "true" });
      container = createApiContainer(env, {
        workerOverrides: { prisma: prisma as PrismaClient },
        skipQueues: true,
      });
      app = await buildApp({ env, container });
      await app.ready();

      const region = await prisma.region.findFirst({ where: { code: "EU" } });
      if (region) {
        const authority = await synchronizeSeasonAuthority(
          {
            prisma: container.worker.prisma,
            blizzard: container.worker.providers.blizzard,
            logger: container.logger,
          },
          "EU",
          region.id,
          { forceRefresh: true },
        );
        verifiedSeasonId = authority.blizzardSeasonId;
        verifiedContractHash = resolveActiveRefreshContract({
          scoringModelKey: env.ACTIVE_SCORE_MODEL_KEY,
          scoringModelVersion: env.ACTIVE_SCORE_MODEL_VERSION,
          activeSeasonId: authority.slug,
          providerMode: env.PROVIDER_MODE,
          env: process.env,
        }).hash;
      }
      void verifiedContractHash;
      void verifiedSeasonId;
    });

    afterAll(async () => {
      await app.close();
    });

    it("includes additive ETA fields on in-flight refresh-status", async () => {
      const name = uniqueName("EtaOn");
      const seeded = await seedRefreshEligibilityEvidenceForTest(container.worker, {
        region: "EU",
        realmSlug: "tarren-mill",
        name,
      });

      await prisma.ingestionJob.create({
        data: {
          jobType: "refresh-character",
          characterId: seeded.characterId,
          status: "QUEUED",
          priority: 0,
          payload: {
            region: "EU",
            realmSlug: "tarren-mill",
            name,
            refreshContractHash: verifiedContractHash,
            blizzardSeasonId: verifiedSeasonId,
          },
          dedupeKey: `eta-test-${name}`,
        },
      });

      const status = await app.inject({
        method: "GET",
        url: `/api/v1/characters/${REALM_PATH}/${name}/refresh-status`,
      });
      expect(status.statusCode).toBe(200);
      const body = status.json();
      expect(body.job).toBeTruthy();
      expect(body.job).toHaveProperty("schedulingState");
      expect(body.job).toHaveProperty("estimateConfidence");
      expect(body.job).toHaveProperty("activeRefreshCount");
      expect(body.job).toHaveProperty("effectiveWorkerCapacity");
      expect(body.job).toHaveProperty("queuePosition");
      // No provider / queue mutation from this GET — job still QUEUED.
      const row = await prisma.ingestionJob.findFirst({
        where: { characterId: seeded.characterId, status: "QUEUED" },
      });
      expect(row).toBeTruthy();
    });
  });
});
