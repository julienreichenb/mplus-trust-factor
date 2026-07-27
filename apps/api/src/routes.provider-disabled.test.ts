import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "@mplus/database";
import { buildApp } from "./app.js";
import { createApiContainer, type ApiContainer } from "./container.js";
import { buildTestEnv, createTestPrismaClient, uniqueName } from "./test-helpers.js";

const { prisma, dbAvailable } = await createTestPrismaClient();

afterAll(async () => {
  await prisma.$disconnect();
});

describe.skipIf(!dbAvailable)("refresh pipeline with a disabled provider", () => {
  let app: FastifyInstance;
  let container: ApiContainer;

  beforeAll(async () => {
    const env = buildTestEnv();
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
  });

  it("reports refresh-status as FRESH after a degraded refresh completes", async () => {
    const name = uniqueName("DisabledBlizzardStatus");
    await app.inject({ method: "GET", url: `/api/v1/characters/EU/tarren-mill/${name}` });

    const statusResponse = await app.inject({
      method: "GET",
      url: `/api/v1/characters/EU/tarren-mill/${name}/refresh-status`,
    });
    expect(statusResponse.statusCode).toBe(200);
    expect(statusResponse.json().refreshStatus).toBe("FRESH");
  });
});
