import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "@mplus/database";
import { buildApp } from "./app.js";
import { createApiContainer, type ApiContainer } from "./container.js";
import { buildScoreModelConfig, buildTestEnv, createTestPrismaClient, uniqueName } from "./test-helpers.js";

const { prisma, dbAvailable } = await createTestPrismaClient();

afterAll(async () => {
  await prisma.$disconnect();
});

describe.skipIf(!dbAvailable)("comparison routes", () => {
  let app: FastifyInstance;
  let container: ApiContainer;

  const REALM_PATH = "EU/tarren-mill";

  beforeAll(async () => {
    const env = buildTestEnv();
    container = createApiContainer(env, { workerOverrides: { prisma: prisma as PrismaClient }, skipQueues: true });
    app = await buildApp({ env, container });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("rejects fewer than 2 characters", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/comparisons",
      payload: { characters: [{ region: "EU", realmSlug: "tarren-mill", name: "Solo" }] },
    });
    expect(response.statusCode).toBe(400);
  });

  it("rejects more than 10 characters", async () => {
    const characters = Array.from({ length: 11 }, (_, index) => ({
      region: "EU",
      realmSlug: "tarren-mill",
      name: `Bulk${index}`,
    }));
    const response = await app.inject({ method: "POST", url: "/api/v1/comparisons", payload: { characters } });
    expect(response.statusCode).toBe(400);
  });

  it("compares two scored characters and computes deltas from median/best", async () => {
    const nameA = uniqueName("CompareA");
    const nameB = uniqueName("CompareB");
    await app.inject({ method: "GET", url: `/api/v1/characters/${REALM_PATH}/${nameA}` });
    await app.inject({ method: "GET", url: `/api/v1/characters/${REALM_PATH}/${nameB}` });

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/comparisons",
      payload: {
        characters: [
          { region: "EU", realmSlug: "tarren-mill", name: nameA },
          { region: "EU", realmSlug: "tarren-mill", name: nameB },
        ],
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.entries).toHaveLength(2);
    for (const entry of body.entries) {
      expect(entry.overallScore).not.toBeNull();
      expect(entry.deltasFromMedian.overall).not.toBeNull();
      expect(entry.deltasFromBest.overall).not.toBeNull();
    }
  });

  it("rejects comparisons across mismatched score model versions", async () => {
    const nameA = uniqueName("MismatchA");
    const nameB = uniqueName("MismatchB");
    await app.inject({ method: "GET", url: `/api/v1/characters/${REALM_PATH}/${nameA}` });
    await app.inject({ method: "GET", url: `/api/v1/characters/${REALM_PATH}/${nameB}` });

    const characterB = await container.worker.repositories.character.findByIdentity({
      region: "EU",
      realmSlug: "tarren-mill",
      name: nameB,
    });
    expect(characterB).not.toBeNull();

    const altKey = `alt-model-${randomUUID().slice(0, 8)}`;
    const altModel = await container.worker.repositories.score.createDraftModel({
      key: altKey,
      name: "Alternate comparison test model",
      config: buildScoreModelConfig(altKey),
    });
    const season = await prisma.season.findFirst({ where: { slug: "placeholder-current" } });
    expect(season).not.toBeNull();

    await container.worker.repositories.score.saveScoreSnapshot({
      characterId: characterB!.id,
      seasonId: season!.id,
      scoreModelId: altModel.id,
      scopeType: "CHARACTER",
      scopeKey: null,
      snapshot: {
        characterId: characterB!.id,
        seasonSlug: season!.slug,
        modelKey: altModel.key,
        modelVersion: altModel.version,
        scopeType: "CHARACTER",
        scopeKey: null,
        overallScore: 70,
        grade: "B",
        skillScore: 70,
        authenticityScore: 70,
        confidence: 0.9,
        calculatedAt: new Date().toISOString(),
        inputFingerprint: `comparison-mismatch-${randomUUID()}`,
        dimensions: [],
        redFlags: [],
        explanation: {},
      },
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/comparisons",
      payload: {
        characters: [
          { region: "EU", realmSlug: "tarren-mill", name: nameA },
          { region: "EU", realmSlug: "tarren-mill", name: nameB },
        ],
      },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("MODEL_VERSION_MISMATCH");
  });
});
