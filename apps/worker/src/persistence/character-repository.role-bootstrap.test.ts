import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { checkDatabaseHealth, createPrismaClient, type PrismaClient } from "@mplus/database";
import { normalizeCharacterSearchKey, normalizeName } from "@mplus/domain";
import { assertTestDatabaseAllowed, sanitizeDatabaseUrl } from "@mplus/test-utils";
import { createCharacterRepository } from "./character-repository.js";
import { ensureRealmRecord, ensureRegion } from "./realm-repository.js";

const databaseUrl = process.env.DATABASE_URL ?? "";
assertTestDatabaseAllowed(databaseUrl);

const prisma: PrismaClient = createPrismaClient(databaseUrl);
const health = await checkDatabaseHealth(prisma);
const dbAvailable = health.ok;

if (!dbAvailable) {
  console.warn(
    `Skipping applyProviderProfile role bootstrap DB tests: PostgreSQL not reachable at ${sanitizeDatabaseUrl(databaseUrl)}. ${health.error ?? ""}`,
  );
}

afterAll(async () => {
  await prisma.$disconnect();
});

describe.skipIf(!dbAvailable)("applyProviderProfile role bootstrap persistence", () => {
  const characters = createCharacterRepository(prisma);

  async function seedShell(opts: {
    classSlug?: string;
    specSlug?: string;
    specRole?: "DPS" | "TANK" | "HEALER";
    characterRole?: "DPS" | "TANK" | "HEALER" | null;
  }) {
    const suffix = randomUUID().slice(0, 8);
    const region = await ensureRegion(prisma, "EU");
    const realm = await ensureRealmRecord(prisma, region.id, "archimonde", "Archimonde");
    let classId: string | null = null;
    let activeSpecId: string | null = null;
    if (opts.classSlug) {
      const gameClass = await prisma.gameClass.upsert({
        where: { slug: opts.classSlug },
        create: { slug: opts.classSlug, name: opts.classSlug },
        update: {},
      });
      classId = gameClass.id;
      if (opts.specSlug && opts.specRole) {
        const spec = await prisma.gameSpecialization.upsert({
          where: { classId_slug: { classId: gameClass.id, slug: opts.specSlug } },
          create: {
            classId: gameClass.id,
            slug: opts.specSlug,
            name: opts.specSlug,
            role: opts.specRole,
          },
          update: { role: opts.specRole },
        });
        activeSpecId = spec.id;
      }
    }
    const displayName = `RoleBoot${suffix}`;
    const created = await prisma.character.create({
      data: {
        regionId: region.id,
        realmId: realm.id,
        normalizedName: `${normalizeName(displayName)}`,
        displayName,
        nameSearchKey: normalizeCharacterSearchKey(displayName),
        level: 90,
        blizzardCharacterId: BigInt(
          `${Date.now()}${Math.floor(Math.random() * 1_000_000)}`.slice(0, 16),
        ),
        classId,
        activeSpecId,
        role: opts.characterRole === undefined ? null : opts.characterRole,
        lastSeenAt: new Date(),
      },
    });
    return created;
  }

  function profile(
    characterId: string,
    overrides: Partial<{
      classSlug: string | null;
      specSlug: string | null;
      role: "DPS" | "TANK" | "HEALER" | null;
      displayName: string;
    }> = {},
  ) {
    return {
      id: characterId,
      region: "EU" as const,
      realmSlug: "archimonde",
      normalizedName: "roleboot",
      displayName: overrides.displayName ?? "RoleBoot",
      classSlug: overrides.classSlug === undefined ? "mage" : overrides.classSlug,
      specSlug: overrides.specSlug === undefined ? "fire" : overrides.specSlug,
      role: overrides.role === undefined ? null : overrides.role,
      level: 90,
      faction: "Horde",
      blizzardCharacterId: "424242",
      wclCanonicalId: null,
      raiderioProfileUrl: null,
      lastSeenAt: null,
      lastPublicRefreshAt: null,
    };
  }

  it("persists catalog specialization role when Blizzard omits role", async () => {
    const shell = await seedShell({});
    const updated = await characters.applyProviderProfile(shell.id, profile(shell.id));
    expect(updated.classId).toBeTruthy();
    expect(updated.activeSpecId).toBeTruthy();
    expect(updated.role).toBe("DPS");
  });

  it("persists HEALER for healer specs without provider role", async () => {
    const shell = await seedShell({});
    const updated = await characters.applyProviderProfile(
      shell.id,
      profile(shell.id, { classSlug: "paladin", specSlug: "holy", role: null }),
    );
    expect(updated.role).toBe("HEALER");
  });

  it("persists TANK for tank specs without provider role", async () => {
    const shell = await seedShell({});
    const updated = await characters.applyProviderProfile(
      shell.id,
      profile(shell.id, { classSlug: "warrior", specSlug: "protection", role: null }),
    );
    expect(updated.role).toBe("TANK");
  });

  it("persists DPS for dps specs without provider role", async () => {
    const shell = await seedShell({});
    const updated = await characters.applyProviderProfile(
      shell.id,
      profile(shell.id, { classSlug: "warlock", specSlug: "affliction", role: null }),
    );
    expect(updated.role).toBe("DPS");
  });

  it("catalog role wins when provider role conflicts with specialization", async () => {
    const shell = await seedShell({});
    const updated = await characters.applyProviderProfile(
      shell.id,
      profile(shell.id, { classSlug: "priest", specSlug: "holy", role: "DPS" }),
    );
    expect(updated.role).toBe("HEALER");
    expect(updated.activeSpecId).toBeTruthy();
    const spec = await prisma.gameSpecialization.findUniqueOrThrow({
      where: { id: updated.activeSpecId! },
    });
    expect(spec.role).toBe("HEALER");
    expect(updated.role).toBe(spec.role);
  });

  it("repairs role from existing activeSpecId when Character.role is null", async () => {
    const shell = await seedShell({
      classSlug: "monk",
      specSlug: "mistweaver",
      specRole: "HEALER",
      characterRole: null,
    });
    expect(shell.activeSpecId).toBeTruthy();
    expect(shell.role).toBeNull();

    const updated = await characters.applyProviderProfile(
      shell.id,
      profile(shell.id, {
        classSlug: "monk",
        specSlug: "mistweaver",
        role: null,
        displayName: shell.displayName,
      }),
    );
    expect(updated.activeSpecId).toBe(shell.activeSpecId);
    expect(updated.role).toBe("HEALER");
    const spec = await prisma.gameSpecialization.findUniqueOrThrow({
      where: { id: updated.activeSpecId! },
    });
    expect(updated.role).toBe(spec.role);
  });

  it("corrects GameSpecialization.role previously seeded with a wrong fallback", async () => {
    const shell = await seedShell({
      classSlug: "paladin",
      specSlug: "holy",
      // Historical bug: ensureGameSpecialization(profile.role ?? "DPS")
      specRole: "DPS",
      characterRole: null,
    });
    const updated = await characters.applyProviderProfile(
      shell.id,
      profile(shell.id, { classSlug: "paladin", specSlug: "holy", role: null }),
    );
    expect(updated.role).toBe("HEALER");
    const spec = await prisma.gameSpecialization.findUniqueOrThrow({
      where: { id: updated.activeSpecId! },
    });
    expect(spec.role).toBe("HEALER");
  });

  it("does not fabricate role or activeSpec for unknown class/spec", async () => {
    const shell = await seedShell({});
    const updated = await characters.applyProviderProfile(
      shell.id,
      profile(shell.id, {
        classSlug: "not-a-class",
        specSlug: "not-a-spec",
        role: "DPS",
      }),
    );
    // Class row may be created, but specialization/role must fail closed.
    expect(updated.activeSpecId).toBeNull();
    expect(updated.role).toBeNull();
  });
});
