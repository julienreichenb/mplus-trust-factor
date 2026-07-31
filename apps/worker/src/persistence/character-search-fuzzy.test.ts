import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { checkDatabaseHealth, createPrismaClient, type PrismaClient } from "@mplus/database";
import { normalizeCharacterSearchKey, normalizeName } from "@mplus/domain";
import { createCharacterRepository } from "./character-repository.js";
import { ensureRealmRecord, ensureRegion } from "./realm-repository.js";

const databaseUrl =
  process.env.DATABASE_URL ?? "postgresql://mplus:mplus@localhost:5433/mplus_trust?schema=public";

const prisma: PrismaClient = createPrismaClient(databaseUrl);
const health = await checkDatabaseHealth(prisma);
const dbAvailable = health.ok;

let trgmAvailable = false;
if (dbAvailable) {
  try {
    const ext = await prisma.$queryRaw<Array<{ extname: string }>>`
      SELECT extname FROM pg_extension WHERE extname = 'pg_trgm'
    `;
    trgmAvailable = ext.length > 0;
    if (trgmAvailable) {
      const idx = await prisma.$queryRaw<Array<{ indexname: string }>>`
        SELECT indexname FROM pg_indexes
        WHERE tablename = 'characters' AND indexname = 'characters_name_search_key_trgm'
      `;
      trgmAvailable = idx.length > 0;
    }
  } catch {
    trgmAvailable = false;
  }
}

if (!dbAvailable) {
  console.warn(
    `Skipping character fuzzy search tests: PostgreSQL not reachable at ${databaseUrl}. ${health.error ?? ""}`,
  );
} else if (!trgmAvailable) {
  console.warn(
    "Skipping character fuzzy search tests: pg_trgm extension or GIN index missing (run pnpm db:migrate).",
  );
}

afterAll(async () => {
  await prisma.$disconnect();
});

describe.skipIf(!dbAvailable || !trgmAvailable)("character searchSuggestions pg_trgm fuzzy", () => {
  const characters = createCharacterRepository(prisma);

  async function seedWallidrixe(regionCode: string) {
    const region = await ensureRegion(prisma, regionCode);
    const realm = await ensureRealmRecord(prisma, region.id, "archimonde", "Archimonde");
    const displayName = "Wallidrixe";
    const suffix = randomUUID().slice(0, 8);
    const normalizedName = `${normalizeName(displayName)}-${suffix}`;
    const created = await prisma.character.create({
      data: {
        regionId: region.id,
        realmId: realm.id,
        normalizedName,
        displayName,
        nameSearchKey: normalizeCharacterSearchKey(displayName),
        lastSeenAt: new Date(),
      },
    });
    return { created, realm, region, displayName };
  }

  it("matches exact, prefix, substring, accent-folded, and conservative typo queries", async () => {
    const { created, displayName } = await seedWallidrixe("EU");
    const cherithRegion = await ensureRegion(prisma, "EU");
    const cherithRealm = await ensureRealmRecord(prisma, cherithRegion.id, "kazzak", "Kazzak");
    const cherith = await prisma.character.create({
      data: {
        regionId: cherithRegion.id,
        realmId: cherithRealm.id,
        normalizedName: `${normalizeName("Chérith")}-${randomUUID().slice(0, 8)}`,
        displayName: "Chérith",
        nameSearchKey: normalizeCharacterSearchKey("Chérith"),
        lastSeenAt: new Date(),
      },
    });

    try {
      const exact = await characters.searchSuggestions("EU", "wallidrixe", 8);
      expect(exact.some((s) => s.name === displayName)).toBe(true);

      const prefix = await characters.searchSuggestions("EU", "walli", 8);
      expect(prefix.some((s) => s.name === displayName)).toBe(true);

      const substring = await characters.searchSuggestions("EU", "lidrix", 8);
      expect(substring.some((s) => s.name === displayName)).toBe(true);

      const typo = await characters.searchSuggestions("EU", "wallidrxie", 8);
      expect(typo.some((s) => s.name === displayName)).toBe(true);

      const accent = await characters.searchSuggestions("EU", "cherith", 8);
      expect(accent.some((s) => s.name === "Chérith")).toBe(true);

      const short = await characters.searchSuggestions("EU", "wa", 8);
      // Length-2 may match prefix/substring paths but must not require trigram.
      expect(Array.isArray(short)).toBe(true);
    } finally {
      await prisma.character.delete({ where: { id: created.id } }).catch(() => undefined);
      await prisma.character.delete({ where: { id: cherith.id } }).catch(() => undefined);
    }
  });

  it("isolates regions and caps public results at 8 without exposing duplicates", async () => {
    const eu = await seedWallidrixe("EU");
    const usRegion = await ensureRegion(prisma, "US");
    const usRealm = await ensureRealmRecord(prisma, usRegion.id, "illidan", "Illidan");
    const usChar = await prisma.character.create({
      data: {
        regionId: usRegion.id,
        realmId: usRealm.id,
        normalizedName: `${normalizeName("Wallidrixe")}-us-${randomUUID().slice(0, 6)}`,
        displayName: "Wallidrixe",
        nameSearchKey: "wallidrixe",
        lastSeenAt: new Date(),
      },
    });

    try {
      const euHits = await characters.searchSuggestions("EU", "wallidrixe", 8);
      expect(euHits.every((s) => s.region === "EU")).toBe(true);
      expect(euHits.some((s) => s.realmSlug === "illidan")).toBe(false);

      const keys = new Set(euHits.map((s) => `${s.region}:${s.realmSlug}:${s.name}`));
      expect(keys.size).toBe(euHits.length);
      expect(euHits.length).toBeLessThanOrEqual(8);
    } finally {
      await prisma.character.delete({ where: { id: eu.created.id } }).catch(() => undefined);
      await prisma.character.delete({ where: { id: usChar.id } }).catch(() => undefined);
    }
  });

  it("exposes the trigram GIN index metadata", async () => {
    const rows = await prisma.$queryRaw<Array<{ indexdef: string }>>`
      SELECT indexdef FROM pg_indexes
      WHERE tablename = 'characters' AND indexname = 'characters_name_search_key_trgm'
    `;
    expect(rows[0]?.indexdef.toLowerCase()).toContain("gin");
    expect(rows[0]?.indexdef.toLowerCase()).toContain("gin_trgm_ops");
  });

  it("rejects empty / too-short queries safely", async () => {
    expect(await characters.searchSuggestions("EU", "", 8)).toEqual([]);
    expect(await characters.searchSuggestions("EU", "a", 8)).toEqual([]);
  });
});
