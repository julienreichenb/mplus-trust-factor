import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "@mplus/database";
import { seedRefreshEligibilityEvidenceForTest } from "@mplus/worker";
import { buildApp } from "./app.js";
import { createApiContainer, type ApiContainer } from "./container.js";
import {
  buildScoreModelConfig,
  buildTestEnv,
  cleanupTrackedScoreModels,
  createTestPrismaClient,
  uniqueName,
} from "./test-helpers.js";

const { prisma, dbAvailable } = await createTestPrismaClient();
const createdScoreModelIds: string[] = [];

afterAll(async () => {
  await cleanupTrackedScoreModels(prisma, createdScoreModelIds);
  await prisma.$disconnect();
});

describe.skipIf(!dbAvailable)("comparison routes", { timeout: 30_000 }, () => {
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

  it(
    "compares two scored characters; Utility-ineligible stay visible but excluded from ranking deltas",
    async () => {
      const nameA = uniqueName("CompareA");
      const nameB = uniqueName("CompareB");
      // Each GET runs the full inline fixture pipeline; two sequential pipelines easily exceed
      // the 5s default timeout — allow 30s.
      await seedRefreshEligibilityEvidenceForTest(container.worker, {
        region: "EU",
        realmSlug: "tarren-mill",
        name: nameA,
      });
      await seedRefreshEligibilityEvidenceForTest(container.worker, {
        region: "EU",
        realmSlug: "tarren-mill",
        name: nameB,
      });
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
        // Fixture pipeline has no published Utility → provisional / not ranking-complete.
        expect(entry.rankingIncluded).toBe(false);
        expect(entry.rankingEligibility?.utilityEligible).toBe(false);
        expect(entry.deltasFromMedian.overall).toBeNull();
        expect(entry.deltasFromBest.overall).toBeNull();
      }
    },
    30_000,
  );

  it(
    "includes ranking-eligible v6 profiles in median/best deltas",
    async () => {
      const nameA = uniqueName("RankEligA");
      const nameB = uniqueName("RankEligB");
      await seedRefreshEligibilityEvidenceForTest(container.worker, {
        region: "EU",
        realmSlug: "tarren-mill",
        name: nameA,
      });
      await seedRefreshEligibilityEvidenceForTest(container.worker, {
        region: "EU",
        realmSlug: "tarren-mill",
        name: nameB,
      });
      await app.inject({ method: "GET", url: `/api/v1/characters/${REALM_PATH}/${nameA}` });
      await app.inject({ method: "GET", url: `/api/v1/characters/${REALM_PATH}/${nameB}` });

      const season = await prisma.season.findFirst({ where: { slug: "placeholder-current" } });
      expect(season).not.toBeNull();
      const activeModel = await container.worker.repositories.score.getActiveModel("default");
      expect(activeModel).not.toBeNull();

      for (const [name, overall] of [
        [nameA, 70],
        [nameB, 80],
      ] as const) {
        const character = await container.worker.repositories.character.findByIdentity({
          region: "EU",
          realmSlug: "tarren-mill",
          name,
        });
        expect(character).not.toBeNull();
        await container.worker.repositories.score.saveScoreSnapshot({
          characterId: character!.id,
          seasonId: season!.id,
          scoreModelId: activeModel!.id,
          scopeType: "CHARACTER",
          scopeKey: null,
          snapshot: {
            characterId: character!.id,
            seasonSlug: season!.slug,
            modelKey: activeModel!.key,
            modelVersion: activeModel!.version,
            scopeType: "CHARACTER",
            scopeKey: null,
            overallScore: overall,
            grade: overall >= 80 ? "A" : "B",
            skillScore: overall,
            authenticityScore: overall,
            confidence: 0.9,
            calculatedAt: new Date().toISOString(),
            inputFingerprint: `comparison-rank-elig-${name}-${randomUUID()}`,
            dimensions: [
              {
                dimension: "UTILITY",
                score: 65,
                confidence: 0.8,
                weight: 0.25,
                state: "AVAILABLE",
                contributors: { strengths: [], risks: [], missing: [] },
              },
            ],
            redFlags: [],
            explanation: {
              rankingEligibility: {
                eligible: true,
                scoreModelVersion: activeModel!.version,
                utilityEligible: true,
                reasons: [],
              },
            },
          },
        });
      }

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
        expect(entry.rankingIncluded).toBe(true);
        expect(entry.deltasFromMedian.overall).not.toBeNull();
        expect(entry.deltasFromBest.overall).not.toBeNull();
      }
      const entryA = body.entries.find((e: { identity: { name: string } }) => e.identity.name === nameA);
      const entryB = body.entries.find((e: { identity: { name: string } }) => e.identity.name === nameB);
      expect(entryA.deltasFromMedian.overall).toBe(-5);
      expect(entryB.deltasFromMedian.overall).toBe(5);
      expect(entryA.deltasFromBest.overall).toBe(-10);
      expect(entryB.deltasFromBest.overall).toBe(0);
    },
    30_000,
  );

  it("rejects comparisons across mismatched score model versions", async () => {
    const nameA = uniqueName("MismatchA");
    const nameB = uniqueName("MismatchB");
    await seedRefreshEligibilityEvidenceForTest(container.worker, {
      region: "EU",
      realmSlug: "tarren-mill",
      name: nameA,
    });
    await seedRefreshEligibilityEvidenceForTest(container.worker, {
      region: "EU",
      realmSlug: "tarren-mill",
      name: nameB,
    });
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
    createdScoreModelIds.push(altModel.id);
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
