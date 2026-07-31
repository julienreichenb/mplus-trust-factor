import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { checkDatabaseHealth, createPrismaClient, type PrismaClient } from "@mplus/database";
import { normalizeCharacterSearchKey, normalizeName } from "@mplus/domain";
import { assertTestDatabaseAllowed, sanitizeDatabaseUrl } from "@mplus/test-utils";
import {
  backfillCharacterNameSearchKeys,
  createCharacterRepository,
} from "./character-repository.js";
import { ensureRealmRecord, ensureRegion } from "./realm-repository.js";

const databaseUrl = process.env.DATABASE_URL ?? "";
assertTestDatabaseAllowed(databaseUrl);

const prisma: PrismaClient = createPrismaClient(databaseUrl);
const health = await checkDatabaseHealth(prisma);
const dbAvailable = health.ok;

if (!dbAvailable) {
  console.warn(
    `Skipping character-search accent tests: PostgreSQL not reachable at ${sanitizeDatabaseUrl(databaseUrl)}. ${health.error ?? ""}`,
  );
}

afterAll(async () => {
  await prisma.$disconnect();
});

describe.skipIf(!dbAvailable)("character searchSuggestions accent fold", () => {
  const characters = createCharacterRepository(prisma);

  it("returns an existing accented character for an unaccented query after backfill", async () => {
    const region = await ensureRegion(prisma, "EU");
    const realm = await ensureRealmRecord(prisma, region.id, "kazzak", "Kazzak");
    const displayName = "Chérith";
    const suffix = randomUUID().slice(0, 8);
    // Keep accent in normalizedName so unaccented contains("cherith") cannot match without name_search_key.
    const normalizedName = `${normalizeName(displayName)}-${suffix}`;

    const created = await prisma.character.create({
      data: {
        regionId: region.id,
        realmId: realm.id,
        normalizedName,
        displayName,
        // Mimic migration SQL seed: lower/trim only — keeps the accent.
        nameSearchKey: displayName.toLocaleLowerCase("en-US").trim(),
        lastSeenAt: new Date(),
      },
    });

    try {
      expect(created.nameSearchKey).toBe("chérith");
      expect(normalizeCharacterSearchKey(displayName)).toBe("cherith");
      expect(created.nameSearchKey).not.toBe(normalizeCharacterSearchKey(displayName));

      const result = await backfillCharacterNameSearchKeys(prisma, { batchSize: 100 });
      expect(result.updated).toBeGreaterThanOrEqual(1);

      const refreshed = await prisma.character.findUniqueOrThrow({ where: { id: created.id } });
      expect(refreshed.nameSearchKey).toBe("cherith");

      // After fold backfill, accent-insensitive substring/prefix paths match without relying on fuzzy alone.
      const after = await characters.searchSuggestions("EU", "Cherith", 8);
      expect(after.some((s) => s.name === displayName && s.realmSlug === "kazzak")).toBe(true);
    } finally {
      await prisma.character.delete({ where: { id: created.id } }).catch(() => undefined);
    }
  });
});
