import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "@mplus/database";
import {
  clearSeasonAuthorityCacheForTests,
  createWorkerContainer,
  seedRefreshEligibilityEvidenceForTest,
  synchronizeSeasonAuthority,
} from "@mplus/worker";
import { buildApp } from "./app.js";
import { createApiContainer, type ApiContainer } from "./container.js";
import {
  buildTestEnv,
  createTestPrismaClient,
  ensureActiveBootstrapCatalogReleaseForTests,
  uniqueName,
} from "./test-helpers.js";

const { prisma, dbAvailable } = await createTestPrismaClient();

afterAll(async () => {
  await prisma.$disconnect();
});

describe.skipIf(!dbAvailable)("refresh pipeline with a disabled provider", { timeout: 30_000 }, () => {
  let app: FastifyInstance;
  let container: ApiContainer;

  beforeEach(async () => {
    await ensureActiveBootstrapCatalogReleaseForTests(prisma);
  });

  beforeAll(async () => {
    clearSeasonAuthorityCacheForTests();
    await ensureActiveBootstrapCatalogReleaseForTests(prisma);
    const env = buildTestEnv();
    // Sync season authority with Blizzard enabled, then build the disabled-blizzard container.
    const syncContainer = createWorkerContainer(env, { prisma: prisma as PrismaClient });
    const region = await prisma.region.findFirst({ where: { code: "EU" } });
    if (region) {
      await synchronizeSeasonAuthority(
        {
          prisma: syncContainer.prisma,
          blizzard: syncContainer.providers.blizzard,
          logger: syncContainer.logger,
        },
        "EU",
        region.id,
        { forceRefresh: true },
      );
    }

    container = createApiContainer(env, {
      workerOverrides: { prisma: prisma as PrismaClient, disabledProviders: new Set(["blizzard"]) },
      skipQueues: true,
    });
    app = await buildApp({ env, container });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("still completes a refresh and produces a score when blizzard is disabled", async () => {
    const name = uniqueName("DisabledBlizzardChar");
    await seedRefreshEligibilityEvidenceForTest(container.worker, {
      region: "EU",
      realmSlug: "tarren-mill",
      name,
      allowProviderSync: false,
    });

    const first = await app.inject({ method: "GET", url: `/api/v1/characters/EU/tarren-mill/${name}` });
    expect(first.statusCode).toBe(202);

    const second = await app.inject({ method: "GET", url: `/api/v1/characters/EU/tarren-mill/${name}` });
    expect(second.statusCode).toBe(200);
    const body = second.json();
    expect(body.refreshStatus).toBe("FRESH");
    expect(body.score).not.toBeNull();

    // Blizzard should be absent from source attribution since it's disabled; other providers remain.
    const providers = (body.sources as Array<{ provider: string }>).map((source) => source.provider);
    expect(providers).not.toContain("blizzard");
  }, 30_000);

  it("reports refresh-status as FRESH after a degraded refresh completes", async () => {
    const name = uniqueName("DisabledBlizzardStatus");
    await seedRefreshEligibilityEvidenceForTest(container.worker, {
      region: "EU",
      realmSlug: "tarren-mill",
      name,
      allowProviderSync: false,
    });
    await app.inject({ method: "GET", url: `/api/v1/characters/EU/tarren-mill/${name}` });

    const statusResponse = await app.inject({
      method: "GET",
      url: `/api/v1/characters/EU/tarren-mill/${name}/refresh-status`,
    });
    expect(statusResponse.statusCode).toBe(200);
    expect(statusResponse.json().refreshStatus).toBe("FRESH");
  }, 30_000);
});
