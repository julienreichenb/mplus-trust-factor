import { afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { checkDatabaseHealth, createPrismaClient } from "@mplus/database";
import { assertTestDatabaseAllowed, DEV_DATABASE_NAME, parseDatabaseUrl } from "@mplus/test-utils";
import { ensureRegionalBlizzardSeason } from "./run-repository.js";

const databaseUrl = process.env.DATABASE_URL ?? "";
assertTestDatabaseAllowed(databaseUrl);
const prisma = createPrismaClient(databaseUrl);
const health = await checkDatabaseHealth(prisma);
const dbAvailable = health.ok;

afterAll(async () => {
  await prisma.$disconnect();
});

async function region(code: string) {
  return prisma.region.upsert({
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

describe.skipIf(!dbAvailable)("Season regional Blizzard identity", () => {
  it("A: EU Season 18 and US Season 18 may coexist", async () => {
    const eu = await region("EU");
    const us = await region("US");
    const a = await ensureRegionalBlizzardSeason(prisma, eu.id, 18);
    const b = await ensureRegionalBlizzardSeason(prisma, us.id, 18);
    expect(a.id).not.toBe(b.id);
    expect(a.blizzardSeasonId).toBe(18);
    expect(b.blizzardSeasonId).toBe(18);
  });

  it("B: two EU Season 18 rows cannot coexist", async () => {
    const eu = await region("EU");
    await ensureRegionalBlizzardSeason(prisma, eu.id, 18);
    try {
      await prisma.season.create({
        data: {
          regionId: eu.id,
          slug: `blizzard-season-18-dup-${randomUUID().slice(0, 8)}`,
          name: "dup",
          blizzardSeasonId: 18,
        },
      });
      expect.fail("expected unique conflict");
    } catch (err) {
      expect(err).toMatchObject({ code: "P2002" });
    }
  });

  it("C/D: repeated and concurrent EU discovery reuse one row", async () => {
    const eu = await region("EU");
    const first = await ensureRegionalBlizzardSeason(prisma, eu.id, 18);
    const second = await ensureRegionalBlizzardSeason(prisma, eu.id, 18);
    const [c1, c2, c3] = await Promise.all([
      ensureRegionalBlizzardSeason(prisma, eu.id, 18),
      ensureRegionalBlizzardSeason(prisma, eu.id, 18),
      ensureRegionalBlizzardSeason(prisma, eu.id, 18),
    ]);
    expect(second.id).toBe(first.id);
    expect(new Set([c1.id, c2.id, c3.id, first.id]).size).toBe(1);
  });

  it("I: this suite is not allowed to target the developer database", () => {
    const parsed = parseDatabaseUrl(databaseUrl);
    expect(parsed?.database).not.toBe(DEV_DATABASE_NAME);
    expect(parsed?.database.startsWith("mplus_itest_")).toBe(true);
  });

  it("J: creating EU 18 does not delete US 18", async () => {
    const eu = await region("EU");
    const us = await region("US");
    const usRow = await ensureRegionalBlizzardSeason(prisma, us.id, 18);
    await ensureRegionalBlizzardSeason(prisma, eu.id, 18);
    const still = await prisma.season.findUnique({ where: { id: usRow.id } });
    expect(still).not.toBeNull();
    expect(still?.blizzardSeasonId).toBe(18);
  });
});
