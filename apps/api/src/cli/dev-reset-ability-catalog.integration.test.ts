import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { buildAbilityCatalogDevResetPlan } from "./dev-reset-ability-catalog-plan.js";
import { createTestPrismaClient } from "../test-helpers.js";

const { prisma, dbAvailable } = await createTestPrismaClient();

afterAll(async () => {
  await prisma.$disconnect();
});

describe.skipIf(!dbAvailable)("ability-catalog dev reset apply", () => {
  it("deletes mixed-decision review batches without removing ACTIVE releases", async () => {
    const activeBefore = await prisma.abilityCatalogRelease.findFirst({
      where: { status: "ACTIVE" },
      select: { id: true },
    });

    const batchId = randomUUID();
    const decidedItemId = randomUUID();
    const undecidedItemId = randomUUID();
    const reviewPlanDigest = randomUUID().replace(/-/g, "");

    await prisma.abilityCatalogReviewBatch.create({
      data: {
        id: batchId,
        reportDigest: randomUUID().replace(/-/g, ""),
        reviewPlanDigest,
        datasetKind: "PINNED",
        sourceIdentities: [],
        summaryCounts: { newAbilityCandidates: 2 },
        status: "OPEN",
        items: {
          create: [
            {
              id: decidedItemId,
              kind: "NEW_ABILITY_CANDIDATE",
              identityKey: "NEW_ABILITY_CANDIDATE:decided",
              name: "Decided Ability",
              reviewReason: "test",
              evidence: { stale: true },
              sourceProvenance: {},
              decisionAction: "ACCEPT",
            },
            {
              id: undecidedItemId,
              kind: "NEW_ABILITY_CANDIDATE",
              identityKey: "NEW_ABILITY_CANDIDATE:undecided",
              primarySpellId: 101545,
              name: "Flying Serpent Kick",
              reviewReason: "test",
              evidence: { stale: true },
              sourceProvenance: {},
            },
          ],
        },
      },
    });

    const createdBatch = await prisma.abilityCatalogReviewBatch.findUniqueOrThrow({
      where: { id: batchId },
      include: {
        items: {
          select: {
            id: true,
            decisionAction: true,
            draftRule: { select: { id: true } },
            draftTopology: { select: { id: true } },
            decisionEvents: { select: { id: true } },
          },
        },
      },
    });
    const plan = buildAbilityCatalogDevResetPlan({
      batches: [createdBatch],
      activeReleases: activeBefore
        ? [{ id: activeBefore.id, releaseKey: "active", status: "ACTIVE" }]
        : [],
      characterScoreReleaseIds: [],
      scoreSnapshotReleaseIds: [],
      allReleasesForLineage: [],
      candidateReleases: [],
    });

    expect(plan.removeBatchIds).toEqual([batchId]);

    await prisma.abilityCatalogReviewBatch.delete({ where: { id: batchId } });

    expect(await prisma.abilityCatalogReviewItem.findUnique({ where: { id: decidedItemId } })).toBeNull();
    expect(await prisma.abilityCatalogReviewItem.findUnique({ where: { id: undecidedItemId } })).toBeNull();

    if (activeBefore) {
      const activeAfter = await prisma.abilityCatalogRelease.findUnique({
        where: { id: activeBefore.id },
      });
      expect(activeAfter?.status).toBe("ACTIVE");
    }
  });
});
