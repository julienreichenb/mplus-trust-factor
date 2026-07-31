/**
 * Deterministic cancel vs publication race outcomes.
 * Exercises the real ScoreRepository transaction predicate (not a mocked helper).
 */
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { checkDatabaseHealth, createPrismaClient, type PrismaClient } from "@mplus/database";
import { createScoreRepository } from "./score-repository.js";
import { createJobRepository } from "./job-repository.js";
import { isRefreshCancellationRequested } from "../orchestration/refresh-job-control.js";

const databaseUrl =
  process.env.DATABASE_URL ?? "postgresql://mplus:mplus@localhost:5433/mplus_trust?schema=public";

const prisma: PrismaClient = createPrismaClient(databaseUrl);
const health = await checkDatabaseHealth(prisma);
const dbAvailable = health.ok;

if (!dbAvailable) {
  console.warn(
    `Skipping publication-cancel race tests: PostgreSQL not reachable at ${databaseUrl}. ${health.error ?? ""}`,
  );
}

afterAll(async () => {
  await prisma.$disconnect();
});

async function seedPublishContext(label: string) {
  const region = await prisma.region.upsert({
    where: { code: "EU" },
    update: {},
    create: {
      code: "EU",
      apiHost: "https://eu.api.blizzard.com",
      localeDefault: "en_GB",
      enabled: true,
    },
  });
  let realm = await prisma.realm.findFirst({ where: { regionId: region.id, slug: "pub-cancel-realm" } });
  if (!realm) {
    realm = await prisma.realm.create({
      data: {
        id: randomUUID(),
        regionId: region.id,
        slug: "pub-cancel-realm",
        name: "Pub Cancel Realm",
      },
    });
  }
  const character = await prisma.character.create({
    data: {
      id: randomUUID(),
      regionId: region.id,
      realmId: realm.id,
      normalizedName: `pubcancel${randomUUID().slice(0, 8)}`,
      displayName: `PubCancel${label}`,
      level: 90,
    },
  });
  const season =
    (await prisma.season.findFirst({
      where: { regionId: region.id, slug: "pub-cancel-season" },
    })) ??
    (await prisma.season.create({
      data: {
        id: randomUUID(),
        regionId: region.id,
        slug: "pub-cancel-season",
        name: "Pub Cancel Season",
        blizzardSeasonId: 999001,
        startsAt: new Date("2026-01-01"),
      },
    }));
  const modelKey = `pub-cancel-model-${randomUUID().slice(0, 8)}`;
  const model = await prisma.scoreModel.create({
    data: {
      id: randomUUID(),
      key: modelKey,
      version: 1,
      name: modelKey,
      status: "ACTIVE",
      config: {
        weights: { PERFORMANCE: 0.25, SURVIVAL: 0.25, UTILITY: 0.25, EXPERIENCE: 0.25 },
        authenticityBlend: { skillWeight: 0.5, authenticityWeight: 0.5 },
        gradeThresholds: { S: 90, A: 80, B: 70, C: 60 },
      },
    },
  });
  const job = await prisma.ingestionJob.create({
    data: {
      id: randomUUID(),
      jobType: "refresh-character",
      characterId: character.id,
      status: "ACTIVE",
      dedupeKey: `pub-cancel-${randomUUID()}`,
      priority: 0,
      payload: {
        region: "EU",
        realmSlug: realm.slug,
        name: character.displayName,
        refreshContractHash: "hash-race-1",
      },
      startedAt: new Date(),
    },
  });
  return { character, season, model, job };
}

const candidateSnapshot = {
  characterId: "unused",
  seasonSlug: "pub-cancel-season",
  modelKey: "m",
  modelVersion: 1,
  scopeType: "CHARACTER" as const,
  scopeKey: null,
  overallScore: 55,
  grade: "C" as const,
  skillScore: 55,
  authenticityScore: 55,
  confidence: 0.9,
  calculatedAt: new Date().toISOString(),
  inputFingerprint: `fp-${randomUUID()}`,
  dimensions: [],
  redFlags: [],
  explanation: { refreshContractHash: "hash-race-1" },
  availableModelWeight: 1,
  totalModelWeight: 1,
  modelCoverageRatio: 1,
  overallState: "DEFINITIVE" as const,
  provisionalReason: null,
};

describe.skipIf(!dbAvailable)("publication cancel race (transaction predicate)", () => {
  const scores = createScoreRepository(prisma);
  const jobs = createJobRepository(prisma);

  it("cancel wins: cancelRequestedAt committed before publication → no publish, job CANCELLED", async () => {
    const ctx = await seedPublishContext("cancel-wins");
    await jobs.requestCancel(ctx.job.id, "admin_cancel");

    const result = await scores.publishOrRejectCandidate({
      characterId: ctx.character.id,
      seasonId: ctx.season.id,
      scoreModelId: ctx.model.id,
      scopeType: "CHARACTER",
      scopeKey: null,
      snapshot: {
        ...candidateSnapshot,
        characterId: ctx.character.id,
        inputFingerprint: `fp-cancel-wins-${randomUUID()}`,
      },
      refreshContractHash: "hash-race-1",
      coverageState: "COMPLETE",
      coherence: { ok: true, violations: [] },
      publicationGuard: { ingestionJobId: ctx.job.id },
    });

    expect(result.published).toBe(false);
    expect(result.cancelled).toBe(true);
    expect(result.snapshot).toBeNull();

    const publicCount = await prisma.scoreSnapshot.count({
      where: { characterId: ctx.character.id, isPublic: true },
    });
    expect(publicCount).toBe(0);

    const cancelled = await jobs.markCancelled(ctx.job.id, { reason: "admin_cancel" });
    expect(cancelled.status).toBe("CANCELLED");
  });

  it("publication wins: publish commits, later cancel is terminal/idempotent and does not roll back", async () => {
    const ctx = await seedPublishContext("pub-wins");
    const fingerprint = `fp-pub-wins-${randomUUID()}`;

    const published = await scores.publishOrRejectCandidate({
      characterId: ctx.character.id,
      seasonId: ctx.season.id,
      scoreModelId: ctx.model.id,
      scopeType: "CHARACTER",
      scopeKey: null,
      snapshot: {
        ...candidateSnapshot,
        characterId: ctx.character.id,
        inputFingerprint: fingerprint,
      },
      refreshContractHash: "hash-race-1",
      coverageState: "COMPLETE",
      coherence: { ok: true, violations: [] },
      publicationGuard: { ingestionJobId: ctx.job.id },
    });
    expect(published.published).toBe(true);
    expect(published.snapshot?.isPublic).toBe(true);

    await prisma.ingestionJob.update({
      where: { id: ctx.job.id },
      data: { status: "COMPLETED", completedAt: new Date() },
    });

    const cancel = await jobs.requestCancel(ctx.job.id, "admin_cancel");
    // Terminal completed: requestCancel leaves status; cancelRefreshJob would report already_terminal.
    expect(cancel.status).toBe("COMPLETED");
    expect(cancel.cancelRequestedAt).toBeNull();

    const stillPublic = await prisma.scoreSnapshot.findFirst({
      where: { characterId: ctx.character.id, isPublic: true },
    });
    expect(stillPublic).not.toBeNull();
    expect(stillPublic?.inputFingerprint).toBe(fingerprint);
  });

  it("stalled/restarted worker: cancelRequestedAt survives and blocks publish before provider work", async () => {
    const ctx = await seedPublishContext("restart");
    await jobs.requestCancel(ctx.job.id, "admin_cancel");

    // Simulate worker restart redelivery: re-read cancel flag before any provider work.
    const requested = await isRefreshCancellationRequested(jobs, ctx.job.id);
    expect(requested).toBe(true);

    const afterRestart = await prisma.ingestionJob.findUniqueOrThrow({ where: { id: ctx.job.id } });
    expect(afterRestart.cancelRequestedAt).not.toBeNull();
    expect(afterRestart.status).toBe("ACTIVE");

    const result = await scores.publishOrRejectCandidate({
      characterId: ctx.character.id,
      seasonId: ctx.season.id,
      scoreModelId: ctx.model.id,
      scopeType: "CHARACTER",
      scopeKey: null,
      snapshot: {
        ...candidateSnapshot,
        characterId: ctx.character.id,
        inputFingerprint: `fp-restart-${randomUUID()}`,
      },
      refreshContractHash: "hash-race-1",
      coverageState: "COMPLETE",
      coherence: { ok: true, violations: [] },
      publicationGuard: { ingestionJobId: ctx.job.id },
    });
    expect(result.published).toBe(false);
    expect(result.cancelled).toBe(true);
  });
});
