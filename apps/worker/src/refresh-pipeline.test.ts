import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { loadEnv } from "@mplus/config";
import { checkDatabaseHealth, createPrismaClient, type PrismaClient } from "@mplus/database";
import { ExternalApiError, type ProviderName, type RefreshCharacterJob } from "@mplus/contracts";
import { createWorkerContainer, type WorkerContainer } from "./container.js";
import { negativeCache } from "./negative-cache.js";
import { runRefreshPipeline } from "./orchestration/refresh-pipeline.js";

const databaseUrl =
  process.env.DATABASE_URL ?? "postgresql://mplus:mplus@localhost:5433/mplus_trust?schema=public";

const prisma: PrismaClient = createPrismaClient(databaseUrl);
const health = await checkDatabaseHealth(prisma);
const dbAvailable = health.ok;

if (!dbAvailable) {
  console.warn(
    `Skipping refresh-pipeline tests: PostgreSQL not reachable at ${databaseUrl}. Run "pnpm dev:infra" first. ${health.error ?? ""}`,
  );
}

afterAll(async () => {
  await prisma.$disconnect();
});

function buildJob(name: string, overrides: Partial<RefreshCharacterJob> = {}): RefreshCharacterJob {
  return {
    region: "EU",
    realmSlug: "tarren-mill",
    name,
    priority: "normal",
    forceRefresh: false,
    requestedAt: new Date().toISOString(),
    ...overrides,
  } as RefreshCharacterJob;
}

function buildContainer(disabledProviders?: Set<ProviderName>): WorkerContainer {
  const env = loadEnv();
  return createWorkerContainer(env, { prisma, disabledProviders });
}

describe.skipIf(!dbAvailable)("runRefreshPipeline (fixture mode, real Postgres)", () => {
  it(
    "flows a happy-path refresh through to a persisted ScoreSnapshot",
    async () => {
      const container = buildContainer();
      const name = `Examplecharacter-${randomUUID().slice(0, 8)}`;
      const job = buildJob(name);

      const result = await runRefreshPipeline(container, job);

      expect(result.notFound).toBe(false);
      expect(result.character.displayName).toBe(name);
      expect(result.job.status).toBe("COMPLETED");
      expect(result.stagesSkipped).toEqual([]);
      expect(result.score).not.toBeNull();
      expect(result.score?.overallScore).toBeGreaterThanOrEqual(0);
      expect(result.score?.overallScore).toBeLessThanOrEqual(100);
      expect(["S", "A", "B", "C", "D"]).toContain(result.score?.grade);

      const persistedSnapshot = await prisma.scoreSnapshot.findFirst({
        where: { characterId: result.character.id },
      });
      expect(persistedSnapshot).not.toBeNull();

      const runParticipants = await prisma.runParticipant.count({
        where: { characterId: result.character.id, isTargetCharacter: true },
      });
      expect(runParticipants).toBeGreaterThan(0);

      const runAnalyses = await prisma.runAnalysis.count({
        where: { characterId: result.character.id },
      });
      expect(runAnalyses).toBeGreaterThan(0);

      const externalRequests = await prisma.externalRequest.count({
        where: { provider: { in: ["BLIZZARD", "WARCRAFT_LOGS", "RAIDER_IO"] } },
      });
      expect(externalRequests).toBeGreaterThan(0);

      const analysis = await prisma.runAnalysis.findFirst({
        where: { characterId: result.character.id },
      });
      expect(analysis?.summary).toMatchObject({
        combatFacts: expect.objectContaining({
          reportCode: expect.any(String),
          fightId: expect.any(Number),
        }),
      });
    },
    30_000,
  );

  it(
    "marks the job FAILED and negative-caches identities that resolve to NOT_FOUND",
    async () => {
      const container = buildContainer();
      const name = `MissingCharacter-${randomUUID().slice(0, 8)}`;
      const job = buildJob(name);

      await expect(runRefreshPipeline(container, job)).rejects.toThrow(ExternalApiError);
      expect(negativeCache.has({ region: job.region, realmSlug: job.realmSlug, name })).toBe(true);
    },
    30_000,
  );

  it(
    "soft-skips a container-disabled provider and still produces a neutral score",
    async () => {
      const container = buildContainer(new Set<ProviderName>(["warcraftlogs"]));
      const name = `DisabledProviderChar-${randomUUID().slice(0, 8)}`;
      const job = buildJob(name);

      const result = await runRefreshPipeline(container, job);

      expect(result.stagesSkipped).toContain("refresh-warcraftlogs-summary");
      expect(result.stagesSkipped).toContain("analyze-run");
      expect(result.score).not.toBeNull();

      const runParticipants = await prisma.runParticipant.count({
        where: { characterId: result.character.id, isTargetCharacter: true },
      });
      expect(runParticipants).toBe(0);
    },
    30_000,
  );

  it(
    "soft-skips all providers for identities flagged with 'disabled-test'",
    async () => {
      const container = buildContainer();
      const name = `disabled-test-${randomUUID().slice(0, 8)}`;
      const job = buildJob(name);

      const result = await runRefreshPipeline(container, job);

      expect(result.stagesSkipped).toContain("refresh-blizzard");
      expect(result.stagesSkipped).toContain("refresh-raiderio");
      expect(result.stagesSkipped).toContain("refresh-warcraftlogs-summary");
      expect(result.job.status).toBe("COMPLETED");
      expect(result.score).not.toBeNull();
    },
    30_000,
  );

  it(
    "collapses duplicate refresh requests onto the same IngestionJob dedupe key",
    async () => {
      const container = buildContainer();
      const name = `DedupeChar-${randomUUID().slice(0, 8)}`;
      const job = buildJob(name);

      const first = await runRefreshPipeline(container, job);
      const second = await runRefreshPipeline(container, buildJob(name, { requestedAt: job.requestedAt }));

      expect(first.job.dedupeKey).toBe(second.job.dedupeKey);
      // A repeat refresh reuses the same IngestionJob row (dedupe key is unique at the DB level).
      expect(first.job.id).toBe(second.job.id);
      const jobCount = await prisma.ingestionJob.count({ where: { dedupeKey: first.job.dedupeKey ?? undefined } });
      expect(jobCount).toBe(1);
    },
    30_000,
  );
});
