import { afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@mplus/database";
import { createTestPrismaClient, uniqueName } from "../test-helpers.js";
import { resolveProductScoreDto } from "./product-score-resolve.js";

const { prisma, dbAvailable } = await createTestPrismaClient();

afterAll(async () => {
  await prisma.$disconnect();
});

const eight = [
  "ara-kara",
  "city-of-threads",
  "the-dawnbreaker",
  "the-stonevault",
  "mists-of-tirna-scithe",
  "the-necrotic-wake",
  "siege-of-boralus",
  "grim-batol",
];

describe.skipIf(!dbAvailable)("product-read score context smoke", () => {
  it("A: legacy CharacterScore without context remains readable through resolveProductScoreDto", async () => {
    const realm = await prisma.realm.findFirst();
    if (!realm) throw new Error("Need a realm");
    const season = await prisma.season.findFirst({ where: { regionId: realm.regionId } });
    if (!season) throw new Error("Need a season");
    const character = await prisma.character.create({
      data: {
        id: randomUUID(),
        regionId: realm.regionId,
        realmId: realm.id,
        normalizedName: uniqueName("smoke-a").toLowerCase(),
        displayName: uniqueName("SmokeA"),
      },
    });
    await prisma.characterScore.create({
      data: {
        id: randomUUID(),
        characterId: character.id,
        seasonId: season.id,
        scoringVersion: "scoring-v1",
        contextRevisionKey: "none",
        performance: 80,
        utility: 70,
        survival: 70,
        experience: 70,
        composite: 73.421,
        contextualScore: null,
        calculatedAt: new Date("2026-08-01T00:00:00.000Z"),
        selectedRuns: [],
        dimensionDetails: {},
      },
    });

    const resolved = await resolveProductScoreDto({
      prisma: prisma as PrismaClient,
      characterId: character.id,
      publishedSnapshot: null,
      modelKey: "default",
      modelVersion: 6,
      gradeThresholds: { S: 90, A: 80, B: 65, C: 50 },
    });
    expect(resolved.source).toBe("character_score");
    expect(resolved.score?.overallScore).toBe(73.421);
    expect(resolved.score?.scoreContext).toBeUndefined();
    expect(resolved.score?.overallScore?.toFixed(3)).toBe("73.421");
  });

  it("B: persisted fixture context projects through product read; N row stays intact", async () => {
    const realm = await prisma.realm.findFirst();
    if (!realm) throw new Error("Need a realm");
    const season = await prisma.season.create({
      data: {
        id: randomUUID(),
        slug: uniqueName("smoke-s"),
        name: "Smoke Season",
        regionId: realm.regionId,
      },
    });
    const character = await prisma.character.create({
      data: {
        id: randomUUID(),
        regionId: realm.regionId,
        realmId: realm.id,
        normalizedName: uniqueName("smoke-b").toLowerCase(),
        displayName: uniqueName("SmokeB"),
      },
    });

    const snapshot = await prisma.seasonMedianKeyDistributionSnapshot.create({
      data: {
        id: randomUUID(),
        seasonId: season.id,
        source: "FIXTURE_LOCAL",
        provenance: { note: "agent-04-local-smoke" },
        sourceVersion: "local-dev",
        collectedAt: new Date("2026-08-01T00:00:00.000Z"),
        contentHash: `fixture-local-${randomUUID()}`,
        points: [
          { percentileBps: 9000, medianKeyThreshold: 18 },
          { percentileBps: 9900, medianKeyThreshold: 22 },
        ],
      },
    });
    const revN = await prisma.seasonScoreContextRevision.create({
      data: {
        id: randomUUID(),
        seasonId: season.id,
        version: 1,
        status: "ARCHIVED",
        distributionSnapshotId: snapshot.id,
        tierFactors: { 1: 1, 2: 1, 3: 1, 4: 1, 5: 1 },
        specAssignments: [],
        percentileAnchors: [{ percentileBps: 9900, factor: 1 }],
        publishedAt: new Date("2026-08-02T00:00:00.000Z"),
      },
    });
    const revN1 = await prisma.seasonScoreContextRevision.create({
      data: {
        id: randomUUID(),
        seasonId: season.id,
        version: 2,
        status: "PUBLISHED",
        distributionSnapshotId: snapshot.id,
        tierFactors: { 1: 1, 2: 1, 3: 1, 4: 1.05, 5: 1 },
        specAssignments: [{ classSlug: "mage", specSlug: "frost", tier: 4 }],
        percentileAnchors: [{ percentileBps: 9900, factor: 1.1 }],
        publishedAt: new Date("2026-08-03T00:00:00.000Z"),
      },
    });

    const canonicalRuns = eight.map((dungeonSlug, i) => ({
      dungeonSlug,
      canonicalRunId: `run-${i}`,
      keyLevel: [18, 18, 19, 19, 20, 20, 21, 22][i],
    }));
    const combined = 1.1 * 1.05;
    const preClamp = 75 * combined;

    const nContext = {
      schemaVersion: "score-context-v1",
      seasonId: season.id,
      contextRevisionId: revN.id,
      contextRevisionKey: revN.id,
      contextRevisionVersion: 1,
      distributionSnapshotId: snapshot.id,
      rawScoreBeforeContext: 75,
      rawGrade: "B",
      finalGrade: "B",
      key: {
        status: "AVAILABLE",
        canonicalRuns,
        medianKeyLevel: 19.5,
        appliedAnchorPercentileBps: 9900,
        appliedAnchorKeyThreshold: 22,
        nextAnchorPercentileBps: null,
        nextAnchorKeyThreshold: null,
        factor: 1,
        distributionSnapshotId: snapshot.id,
        distributionSource: "FIXTURE_LOCAL",
        distributionVersion: "local-dev",
        distributionCollectedAt: "2026-08-01T00:00:00.000Z",
        reason: null,
      },
      meta: {
        status: "NOT_CONFIGURED",
        classSlug: "mage",
        specSlug: "frost",
        specSource: "test",
        tier: null,
        factor: 1,
        reason: "NOT_CONFIGURED",
      },
      combinedFactor: 1,
      preClampAdjustedScore: 75,
      wasClamped: false,
      finalScore: 75,
    };

    await prisma.characterScore.create({
      data: {
        id: randomUUID(),
        characterId: character.id,
        seasonId: season.id,
        scoringVersion: "scoring-v1",
        contextRevisionKey: revN.id,
        contextRevisionId: revN.id,
        composite: 75,
        contextualScore: 75,
        calculatedAt: new Date("2026-08-14T12:00:00.000Z"),
        selectedRuns: [],
        dimensionDetails: { scoreContext: nContext },
      },
    });

    const n1Context = {
      ...nContext,
      contextRevisionId: revN1.id,
      contextRevisionKey: revN1.id,
      contextRevisionVersion: 2,
      rawGrade: "B",
      finalGrade: "A",
      key: { ...nContext.key, factor: 1.1 },
      meta: {
        status: "AVAILABLE",
        classSlug: "mage",
        specSlug: "frost",
        specSource: "test",
        tier: 4,
        factor: 1.05,
        reason: null,
      },
      combinedFactor: combined,
      preClampAdjustedScore: preClamp,
      wasClamped: false,
      finalScore: preClamp,
    };

    await prisma.characterScore.create({
      data: {
        id: randomUUID(),
        characterId: character.id,
        seasonId: season.id,
        scoringVersion: "scoring-v1",
        contextRevisionKey: revN1.id,
        contextRevisionId: revN1.id,
        composite: 75,
        contextualScore: preClamp,
        calculatedAt: new Date("2026-08-14T11:00:00.000Z"),
        selectedRuns: [],
        dimensionDetails: { scoreContext: n1Context },
      },
    });

    const resolved = await resolveProductScoreDto({
      prisma: prisma as PrismaClient,
      characterId: character.id,
      publishedSnapshot: null,
      modelKey: "default",
      modelVersion: 6,
      gradeThresholds: { S: 90, A: 80, B: 65, C: 50 },
    });
    const ctx = resolved.score?.scoreContext;
    expect(resolved.source).toBe("character_score");
    expect(resolved.score?.overallScore).toBeCloseTo(preClamp, 12);
    expect(resolved.score?.grade).toBe("A");
    expect(ctx?.rawScoreBeforeContext).toBe(75);
    expect(ctx?.keyContext.canonicalRuns).toHaveLength(8);
    expect(ctx?.keyContext.medianKeyLevel).toBe(19.5);
    expect(ctx?.keyContext.factor).toBe(1.1);
    expect(ctx?.metaContext.tier).toBe(4);
    expect(ctx?.metaContext.factor).toBe(1.05);
    expect(ctx?.combinedFactor).toBeCloseTo(combined, 12);
    expect(ctx?.preClampAdjustedScore).toBeCloseTo(preClamp, 12);
    expect(ctx?.finalScore).toBeCloseTo(preClamp, 12);
    expect(ctx?.finalGrade).toBe("A");
    expect(ctx?.contextRevisionId).toBe(revN1.id);
    expect(ctx?.finalScore?.toFixed(3)).toBe(preClamp.toFixed(3));

    const historical = await prisma.characterScore.findFirst({
      where: { characterId: character.id, contextRevisionKey: revN.id },
    });
    expect(historical?.composite).toBe(75);
    expect(historical?.contextualScore).toBe(75);
    const histCtx = (historical?.dimensionDetails as { scoreContext?: { contextRevisionVersion?: number } } | null)
      ?.scoreContext;
    expect(histCtx?.contextRevisionVersion).toBe(1);
  });
});
