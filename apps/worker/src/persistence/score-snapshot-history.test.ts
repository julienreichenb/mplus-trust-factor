/**
 * Regression: two successful publications preserve immutable snapshots; pointer moves to latest.
 */
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { checkDatabaseHealth, createPrismaClient, type PrismaClient } from "@mplus/database";
import { assertTestDatabaseAllowed, sanitizeDatabaseUrl } from "@mplus/test-utils";
import { createScoreRepository } from "./score-repository.js";

const databaseUrl = process.env.DATABASE_URL ?? "";
assertTestDatabaseAllowed(databaseUrl);

const prisma: PrismaClient = createPrismaClient(databaseUrl);
const health = await checkDatabaseHealth(prisma);
const dbAvailable = health.ok;

if (!dbAvailable) {
  console.warn(
    `Skipping score snapshot history tests: PostgreSQL not reachable at ${sanitizeDatabaseUrl(databaseUrl)}. ${health.error ?? ""}`,
  );
}

afterAll(async () => {
  await prisma.$disconnect();
});

describe.skipIf(!dbAvailable)("score snapshot history", () => {
  it("keeps both snapshots after two publications and moves published pointer", async () => {
    const repo = createScoreRepository(prisma);
    const region = await prisma.region.upsert({
      where: { code: "EU" },
      update: {},
      create: { code: "EU", apiHost: "https://eu.api.blizzard.com", localeDefault: "en_GB", enabled: true },
    });
    const realm = await prisma.realm.create({
      data: {
        id: randomUUID(),
        regionId: region.id,
        slug: `snap-hist-${randomUUID().slice(0, 6)}`,
        name: "Snap Hist",
      },
    });
    const character = await prisma.character.create({
      data: {
        id: randomUUID(),
        regionId: region.id,
        realmId: realm.id,
        normalizedName: `snaphist${randomUUID().slice(0, 8)}`,
        displayName: "SnapHist",
        level: 90,
      },
    });
    const season = await prisma.season.create({
      data: {
        id: randomUUID(),
        regionId: region.id,
        slug: `snap-hist-${randomUUID().slice(0, 6)}`,
        name: "Snap Hist Season",
        blizzardSeasonId: 999002 + Math.floor(Math.random() * 1000),
        startsAt: new Date("2026-01-01"),
      },
    });
    const model = await prisma.scoreModel.create({
      data: {
        id: randomUUID(),
        key: `snap-hist-${randomUUID().slice(0, 8)}`,
        version: 1,
        name: "snap-hist",
        status: "DRAFT",
        config: {
          weights: { PERFORMANCE: 0.25, SURVIVAL: 0.25, UTILITY: 0.25, EXPERIENCE: 0.25 },
          authenticityBlend: { skillWeight: 0.5, authenticityWeight: 0.5 },
          gradeThresholds: { S: 90, A: 80, B: 70, C: 60 },
        },
      },
    });

    const baseSnapshot = {
      characterId: character.id,
      seasonSlug: season.slug,
      modelKey: model.key,
      modelVersion: model.version,
      scopeType: "CHARACTER" as const,
      scopeKey: null,
      overallScore: 80,
      grade: "B" as const,
      skillScore: 80,
      authenticityScore: 80,
      confidence: 0.8,
      calculatedAt: new Date().toISOString(),
      dimensions: [],
      redFlags: [],
      explanation: {},
      availableModelWeight: 1,
      totalModelWeight: 1,
      modelCoverageRatio: 1,
      overallState: "DEFINITIVE" as const,
      provisionalReason: null,
    };

    const first = await repo.publishOrRejectCandidate({
      characterId: character.id,
      seasonId: season.id,
      scoreModelId: model.id,
      scopeType: "CHARACTER",
      scopeKey: null,
      snapshot: { ...baseSnapshot, inputFingerprint: `fp-a-${randomUUID()}` },
      coherence: { ok: true, violations: [] },
      coverageState: "COMPLETE",
      refreshContractHash: "contract-a",
    });
    const second = await repo.publishOrRejectCandidate({
      characterId: character.id,
      seasonId: season.id,
      scoreModelId: model.id,
      scopeType: "CHARACTER",
      scopeKey: null,
      snapshot: { ...baseSnapshot, overallScore: 85, inputFingerprint: `fp-b-${randomUUID()}` },
      coherence: { ok: true, violations: [] },
      coverageState: "COMPLETE",
      refreshContractHash: "contract-b",
    });

    expect(first.published).toBe(true);
    expect(second.published).toBe(true);

    const snapshots = await prisma.scoreSnapshot.findMany({
      where: { characterId: character.id, seasonId: season.id, scoreModelId: model.id },
      orderBy: { calculatedAt: "asc" },
    });
    expect(snapshots.length).toBe(2);
    expect(snapshots.some((s) => s.id === first.snapshot!.id)).toBe(true);
    expect(snapshots.some((s) => s.id === second.snapshot!.id)).toBe(true);

    const pointer = await prisma.characterPublishedScore.findFirst({
      where: {
        characterId: character.id,
        seasonId: season.id,
        scoreModelId: model.id,
        scopeType: "CHARACTER",
        scopeKey: null,
      },
    });
    expect(pointer?.publishedSnapshotId).toBe(second.snapshot!.id);
  });
});
