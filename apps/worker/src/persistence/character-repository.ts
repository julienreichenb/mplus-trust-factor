import type { Character, CharacterRole, GameClass, GameSpecialization, Prisma, PrismaClient } from "@mplus/database";
import { normalizeName, normalizeRealmSlug, normalizeRegion } from "@mplus/domain";
import type { CanonicalCharacter, CharacterIdentityInput, CharacterSnapshotDTO } from "@mplus/contracts";
import { ensureRealmRecord, ensureRegion } from "./realm-repository.js";
import type { PrismaClientOrTx } from "./shared.js";

export async function ensureGameClass(client: PrismaClientOrTx, slug: string): Promise<GameClass> {
  const existing = await client.gameClass.findUnique({ where: { slug } });
  if (existing) return existing;
  return client.gameClass.create({ data: { slug, name: capitalize(slug) } });
}

export async function ensureGameSpecialization(
  client: PrismaClientOrTx,
  classId: string,
  slug: string,
  role: CharacterRole,
): Promise<GameSpecialization> {
  const existing = await client.gameSpecialization.findUnique({
    where: { classId_slug: { classId, slug } },
  });
  if (existing) return existing;
  return client.gameSpecialization.create({
    data: { classId, slug, name: capitalize(slug), role },
  });
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export interface UpsertCharacterPatch {
  displayName?: string;
  classSlug?: string | null;
  specSlug?: string | null;
  role?: CharacterRole | null;
  blizzardCharacterId?: string | null;
  wclCanonicalId?: string | null;
  raiderioProfileUrl?: string | null;
  lastSeenAt?: Date;
}

export interface CharacterRepository {
  findByIdentity(identity: CharacterIdentityInput): Promise<Character | null>;
  findById(characterId: string): Promise<Character | null>;
  upsertCharacter(identity: CharacterIdentityInput, patch?: UpsertCharacterPatch): Promise<Character>;
  applyProviderProfile(characterId: string, profile: CanonicalCharacter): Promise<Character>;
  recordSnapshot(
    characterId: string,
    snapshot: CharacterSnapshotDTO,
    equipment?: { averageItemLevel: number | null; equippedItemLevel: number | null; items?: unknown },
  ): Promise<void>;
  updateRefreshTimestamps(
    characterId: string,
    patch: { lastSeenAt?: Date; lastPublicRefreshAt?: Date },
  ): Promise<Character>;
  updateRaiderioProfile(characterId: string, raiderioProfileUrl: string): Promise<Character>;
}

export function createCharacterRepository(prisma: PrismaClient): CharacterRepository {
  return {
    async findByIdentity(identity) {
      const region = await prisma.region.findUnique({ where: { code: normalizeRegion(identity.region) } });
      if (!region) return null;
      const realm = await prisma.realm.findUnique({
        where: { regionId_slug: { regionId: region.id, slug: normalizeRealmSlug(identity.realmSlug) } },
      });
      if (!realm) return null;
      return prisma.character.findUnique({
        where: {
          regionId_realmId_normalizedName: {
            regionId: region.id,
            realmId: realm.id,
            normalizedName: normalizeName(identity.name),
          },
        },
      });
    },

    async findById(characterId) {
      return prisma.character.findUnique({ where: { id: characterId } });
    },

    async upsertCharacter(identity, patch) {
      return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const region = await ensureRegion(tx, identity.region);
        const realm = await ensureRealmRecord(tx, region.id, identity.realmSlug);
        const normalizedName = normalizeName(identity.name);

        let classId: string | null = null;
        let activeSpecId: string | null = null;
        if (patch?.classSlug) {
          const gameClass = await ensureGameClass(tx, patch.classSlug);
          classId = gameClass.id;
          if (patch.specSlug && patch.role) {
            const spec = await ensureGameSpecialization(tx, gameClass.id, patch.specSlug, patch.role);
            activeSpecId = spec.id;
          }
        }

        return tx.character.upsert({
          where: {
            regionId_realmId_normalizedName: { regionId: region.id, realmId: realm.id, normalizedName },
          },
          update: {
            displayName: patch?.displayName ?? identity.name,
            ...(classId ? { classId } : {}),
            ...(activeSpecId ? { activeSpecId } : {}),
            ...(patch?.role ? { role: patch.role } : {}),
            ...(patch?.blizzardCharacterId ? { blizzardCharacterId: BigInt(patch.blizzardCharacterId) } : {}),
            ...(patch?.raiderioProfileUrl ? { raiderioProfileUrl: patch.raiderioProfileUrl } : {}),
            lastSeenAt: patch?.lastSeenAt ?? new Date(),
          },
          create: {
            regionId: region.id,
            realmId: realm.id,
            normalizedName,
            displayName: patch?.displayName ?? identity.name,
            classId,
            activeSpecId,
            role: patch?.role ?? null,
            blizzardCharacterId: patch?.blizzardCharacterId ? BigInt(patch.blizzardCharacterId) : null,
            raiderioProfileUrl: patch?.raiderioProfileUrl ?? null,
            lastSeenAt: patch?.lastSeenAt ?? new Date(),
          },
        });
      });
    },

    async applyProviderProfile(characterId, profile) {
      return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        let classId: string | undefined;
        let activeSpecId: string | undefined;
        if (profile.classSlug) {
          const gameClass = await ensureGameClass(tx, profile.classSlug);
          classId = gameClass.id;
          if (profile.specSlug && profile.role) {
            const spec = await ensureGameSpecialization(tx, gameClass.id, profile.specSlug, profile.role);
            activeSpecId = spec.id;
          }
        }
        return tx.character.update({
          where: { id: characterId },
          data: {
            displayName: profile.displayName,
            ...(classId ? { classId } : {}),
            ...(activeSpecId ? { activeSpecId } : {}),
            ...(profile.role ? { role: profile.role } : {}),
            ...(profile.blizzardCharacterId ? { blizzardCharacterId: BigInt(profile.blizzardCharacterId) } : {}),
            lastSeenAt: new Date(),
          },
        });
      });
    },

    async recordSnapshot(characterId, snapshot, equipment) {
      await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const created = await tx.characterSnapshot.create({
          data: {
            characterId,
            capturedAt: new Date(snapshot.capturedAt),
            itemLevelEquipped: snapshot.itemLevelEquipped,
            role: snapshot.role,
            mythicRating: snapshot.mythicRating,
            rawSummary: {},
          },
        });
        if (equipment) {
          await tx.equipmentSnapshot.create({
            data: {
              characterSnapshotId: created.id,
              capturedAt: new Date(snapshot.capturedAt),
              averageItemLevel: equipment.averageItemLevel,
              equippedItemLevel: equipment.equippedItemLevel,
              items: (equipment.items ?? []) as object,
            },
          });
        }
      });
    },

    async updateRefreshTimestamps(characterId, patch) {
      return prisma.character.update({
        where: { id: characterId },
        data: {
          ...(patch.lastSeenAt ? { lastSeenAt: patch.lastSeenAt } : {}),
          ...(patch.lastPublicRefreshAt ? { lastPublicRefreshAt: patch.lastPublicRefreshAt } : {}),
        },
      });
    },

    async updateRaiderioProfile(characterId, raiderioProfileUrl) {
      return prisma.character.update({ where: { id: characterId }, data: { raiderioProfileUrl } });
    },
  };
}
