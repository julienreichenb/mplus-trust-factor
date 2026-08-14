import { afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { assertTestDatabaseAllowed, sanitizeDatabaseUrl } from "@mplus/test-utils";
import { PrismaClient } from "@prisma/client";
import { checkDatabaseHealth } from "./index.js";
import { defaultNeutralTierFactors } from "@mplus/scoring";

const databaseUrl = process.env.DATABASE_URL ?? "";
assertTestDatabaseAllowed(databaseUrl);
const prisma = new PrismaClient();
const health = await checkDatabaseHealth(prisma);
const dbAvailable = health.ok;

if (!dbAvailable) {
  console.warn(
    `Skipping character-score snapshot backfill tests: PostgreSQL not reachable at ${sanitizeDatabaseUrl(databaseUrl)}.`,
  );
}

afterAll(async () => {
  await prisma.$disconnect();
});

describe.runIf(dbAvailable)("character score distribution snapshot backfill", () => {
  it("H: reconstructs contextDistributionSnapshotId from regional bindings", async () => {
    const region = await prisma.region.findUniqueOrThrow({ where: { code: "EU" } });
    const realm =
      (await prisma.realm.findFirst({ where: { regionId: region.id } })) ??
      (await prisma.realm.create({
        data: {
          id: randomUUID(),
          regionId: region.id,
          slug: `backfill-${randomUUID().slice(0, 6)}`,
          name: "Backfill Realm",
          timezone: "Europe/Paris",
        },
      }));
    const season = await prisma.season.create({
      data: {
        id: randomUUID(),
        regionId: region.id,
        slug: `backfill-season-${randomUUID().slice(0, 8)}`,
        name: "Backfill Season",
        blizzardSeasonId: 88401,
      },
    });
    const snapshot = await prisma.seasonMedianKeyDistributionSnapshot.create({
      data: {
        id: randomUUID(),
        seasonId: season.id,
        source: "FIXTURE_LOCAL",
        provenance: {},
        sourceVersion: "v1",
        collectedAt: new Date(),
        contentHash: randomUUID(),
        points: [{ percentileBps: 9000, medianKeyThreshold: 18 }],
      },
    });
    const revision = await prisma.seasonScoreContextRevision.create({
      data: {
        id: randomUUID(),
        blizzardSeasonId: 88401,
        seasonId: season.id,
        version: 1,
        status: "PUBLISHED",
        tierFactors: defaultNeutralTierFactors() as object,
        specAssignments: [],
        percentileAnchors: [{ percentileBps: 9000, factor: 1 }],
      },
    });
    await prisma.scoreContextRevisionRegionSnapshot.create({
      data: {
        revisionId: revision.id,
        regionCode: "EU",
        distributionSnapshotId: snapshot.id,
      },
    });
    const character = await prisma.character.create({
      data: {
        id: randomUUID(),
        regionId: region.id,
        realmId: realm.id,
        normalizedName: `backfill${randomUUID().slice(0, 8)}`,
        displayName: "Backfill",
        role: "DPS",
      },
    });
    const score = await prisma.characterScore.create({
      data: {
        id: randomUUID(),
        characterId: character.id,
        seasonId: season.id,
        scoringVersion: "test-v1",
        contextRevisionKey: revision.id,
        contextRevisionId: revision.id,
        contextDistributionSnapshotId: null,
        selectedRuns: [],
        calculatedAt: new Date(),
      },
    });
    const orphan = await prisma.characterScore.create({
      data: {
        id: randomUUID(),
        characterId: character.id,
        seasonId: season.id,
        scoringVersion: "test-v1-orphan",
        contextRevisionKey: "orphan",
        contextRevisionId: null,
        contextDistributionSnapshotId: null,
        selectedRuns: [],
        calculatedAt: new Date(),
      },
    });

    await prisma.$executeRawUnsafe(
      `UPDATE "character_scores" cs
       SET "context_distribution_snapshot_id" = bind."distribution_snapshot_id"
       FROM "score_context_revision_region_snapshots" bind,
            "seasons" s,
            "regions" reg
       WHERE cs."context_revision_id" = bind."revision_id"
         AND s."id" = cs."season_id"
         AND reg."id" = s."region_id"
         AND UPPER(bind."region_code") = UPPER(reg."code")
         AND cs."context_distribution_snapshot_id" IS NULL
         AND cs."season_id" = $1::uuid`,
      season.id,
    );

    const filled = await prisma.characterScore.findUniqueOrThrow({ where: { id: score.id } });
    expect(filled.contextDistributionSnapshotId).toBe(snapshot.id);
    const stillOrphan = await prisma.characterScore.findUniqueOrThrow({ where: { id: orphan.id } });
    expect(stillOrphan.contextDistributionSnapshotId).toBeNull();
  });
});
