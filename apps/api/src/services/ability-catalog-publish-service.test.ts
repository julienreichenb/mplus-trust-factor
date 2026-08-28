import { afterAll, describe, expect, it } from "vitest";
import { AbilityCatalogPublishService } from "./ability-catalog-publish-service.js";
import { createTestPrismaClient, ensureActiveBootstrapCatalogReleaseForTests } from "../test-helpers.js";

const { prisma, dbAvailable } = await createTestPrismaClient();

const audit = {
  userId: null as string | null,
  actorType: "system" as const,
  sessionSecret: "test-session-secret-at-least-32-chars",
};

afterAll(async () => {
  await prisma.$disconnect();
});

describe.skipIf(!dbAvailable)("AbilityCatalogPublishService", () => {
  const service = new AbilityCatalogPublishService(prisma);

  it("reports NO_CHANGES when no pending drafts or exclusions", async () => {
    await ensureActiveBootstrapCatalogReleaseForTests(prisma);
    const status = await service.getPublishStatus();
    expect(status.activeReleaseId).toBeTruthy();
    expect(["NO_CHANGES", "NEEDS_CLASSIFICATION"]).toContain(status.status);
  });

  it("rejects publish when there are no pending changes", async () => {
    await ensureActiveBootstrapCatalogReleaseForTests(prisma);
    await expect(service.publishChanges(audit)).rejects.toMatchObject({
      code: "NO_PENDING_CHANGES",
    });
  });
});
