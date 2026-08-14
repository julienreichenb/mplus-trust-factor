import { afterAll, describe, expect, it, vi } from "vitest";
import { checkDatabaseHealth, createPrismaClient } from "@mplus/database";
import { assertTestDatabaseAllowed } from "@mplus/test-utils";
import { synchronizeScoringSeasonData } from "./synchronize-scoring-season-data.js";
import { KEY_CONTEXT_REGION_CODES } from "@mplus/contracts";

const databaseUrl = process.env.DATABASE_URL ?? "";
assertTestDatabaseAllowed(databaseUrl);
const prisma = createPrismaClient(databaseUrl);
const health = await checkDatabaseHealth(prisma);
const dbAvailable = health.ok;

afterAll(async () => {
  await prisma.$disconnect();
});

describe.skipIf(!dbAvailable)("synchronizeScoringSeasonData", () => {
  it("J/K: fans out canonical Season identities without duplicating rows", async () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    const blizzardSeasonId = 19;
    for (const code of KEY_CONTEXT_REGION_CODES) {
      await prisma.region.upsert({
        where: { code },
        update: {},
        create: {
          code,
          apiHost: `https://${code.toLowerCase()}.api.blizzard.com`,
          localeDefault: "en_US",
          enabled: true,
        },
      });
    }
    const first = await synchronizeScoringSeasonData({
      prisma,
      logger: logger as never,
      blizzardSeasonId,
      selectionMode: "PINNED",
    });
    const second = await synchronizeScoringSeasonData({
      prisma,
      logger: logger as never,
      blizzardSeasonId,
      selectionMode: "PINNED",
    });
    expect(first.regions).toHaveLength(4);
    expect(second.regions).toHaveLength(4);
    for (const code of KEY_CONTEXT_REGION_CODES) {
      const rows = await prisma.season.findMany({
        where: { blizzardSeasonId, region: { code } },
      });
      expect(rows).toHaveLength(1);
    }
  });
});
