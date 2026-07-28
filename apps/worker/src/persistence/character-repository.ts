import type { Character, CharacterRole, GameClass, GameSpecialization, Prisma, PrismaClient } from "@mplus/database";
import { normalizeName, normalizeRealmSlug, normalizeRegion } from "@mplus/domain";
import type { CanonicalCharacter, CharacterIdentityInput, CharacterSnapshotDTO, RegionCode } from "@mplus/contracts";
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

const CLASS_ICON_BASE = "https://wow.zamimg.com/images/wow/icons/large";

const CLASS_ICON_BY_SLUG: Record<string, string> = {
  warrior: `${CLASS_ICON_BASE}/classicon_warrior.jpg`,
  paladin: `${CLASS_ICON_BASE}/classicon_paladin.jpg`,
  hunter: `${CLASS_ICON_BASE}/classicon_hunter.jpg`,
  rogue: `${CLASS_ICON_BASE}/classicon_rogue.jpg`,
  priest: `${CLASS_ICON_BASE}/classicon_priest.jpg`,
  "death-knight": `${CLASS_ICON_BASE}/classicon_deathknight.jpg`,
  shaman: `${CLASS_ICON_BASE}/classicon_shaman.jpg`,
  mage: `${CLASS_ICON_BASE}/classicon_mage.jpg`,
  warlock: `${CLASS_ICON_BASE}/classicon_warlock.jpg`,
  monk: `${CLASS_ICON_BASE}/classicon_monk.jpg`,
  druid: `${CLASS_ICON_BASE}/classicon_druid.jpg`,
  "demon-hunter": `${CLASS_ICON_BASE}/classicon_demonhunter.jpg`,
  evoker: `${CLASS_ICON_BASE}/classicon_evoker.jpg`,
};

function classIconUrl(classSlug: string | null | undefined): string | null {
  if (!classSlug) return null;
  return CLASS_ICON_BY_SLUG[classSlug.toLowerCase()] ?? null;
}

function readAvatarFromSnapshot(rawSummary: unknown): string | null {
  if (!rawSummary || typeof rawSummary !== "object") return null;
  const media = (rawSummary as { media?: { avatarUrl?: unknown } }).media;
  const avatar = media?.avatarUrl;
  return typeof avatar === "string" && avatar.startsWith("https://") ? avatar : null;
}

type SuggestionKey = string;

function suggestionKey(name: string, realmSlug: string, region: string): SuggestionKey {
  return `${region}:${realmSlug}:${normalizeName(name)}`;
}

function parseNameRealmQuery(query: string): { namePart: string; realmPart: string | null } {
  const trimmed = query.trim();
  const dash = trimmed.indexOf("-");
  if (dash <= 0) {
    return { namePart: trimmed, realmPart: null };
  }
  return {
    namePart: trimmed.slice(0, dash).trim(),
    realmPart: trimmed.slice(dash + 1).trim() || null,
  };
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

export interface CharacterSearchResult {
  name: string;
  realmSlug: string;
  region: RegionCode;
  classSlug: string | null;
  specSlug: string | null;
  avatarUrl: string | null;
  classIconUrl: string | null;
  source: "character" | "alias" | "participant";
}

export interface CharacterRepository {
  findByIdentity(identity: CharacterIdentityInput): Promise<Character | null>;
  findById(characterId: string): Promise<Character | null>;
  searchSuggestions(region: string, query: string, limit?: number): Promise<CharacterSearchResult[]>;
  upsertCharacter(identity: CharacterIdentityInput, patch?: UpsertCharacterPatch): Promise<Character>;
  applyProviderProfile(characterId: string, profile: CanonicalCharacter): Promise<Character>;
  recordSnapshot(
    characterId: string,
    snapshot: CharacterSnapshotDTO,
    equipment?: {
      averageItemLevel: number | null;
      equippedItemLevel: number | null;
      items?: unknown;
      keyItems?: unknown;
    },
    extras?: {
      media?: { avatarUrl: string | null; insetUrl: string | null; mainRawUrl: string | null } | null;
      talent?: {
        specializationSlug: string | null;
        loadoutCode: string | null;
        talents: unknown;
      } | null;
    },
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

    async searchSuggestions(region, query, limit = 12) {
      const code = normalizeRegion(region);
      const trimmed = query.trim();
      if (trimmed.length < 3) return [];

      const { namePart, realmPart } = parseNameRealmQuery(trimmed);
      const normalizedNameQuery = normalizeName(namePart);
      const realmQuery = realmPart ? normalizeRealmSlug(realmPart) : null;

      const regionRow = await prisma.region.findUnique({ where: { code } });
      if (!regionRow) return [];

      const results = new Map<SuggestionKey, CharacterSearchResult>();

      const addResult = (entry: CharacterSearchResult): void => {
        const key = suggestionKey(entry.name, entry.realmSlug, entry.region);
        if (!results.has(key)) {
          results.set(key, entry);
        }
      };

      const characters = await prisma.character.findMany({
        where: {
          regionId: regionRow.id,
          AND: [
            {
              OR: [
                { normalizedName: { contains: normalizedNameQuery, mode: "insensitive" } },
                { displayName: { contains: namePart, mode: "insensitive" } },
              ],
            },
            ...(realmQuery
              ? [{ realm: { slug: { contains: realmQuery, mode: "insensitive" as const } } }]
              : []),
          ],
        },
        include: {
          realm: true,
          gameClass: true,
          activeSpec: true,
          snapshots: { orderBy: { capturedAt: "desc" }, take: 1 },
        },
        take: limit,
        orderBy: [{ lastSeenAt: "desc" }, { displayName: "asc" }],
      });

      for (const character of characters) {
        addResult({
          name: character.displayName,
          realmSlug: character.realm.slug,
          region: code as RegionCode,
          classSlug: character.gameClass?.slug ?? null,
          specSlug: character.activeSpec?.slug ?? null,
          avatarUrl: readAvatarFromSnapshot(character.snapshots[0]?.rawSummary),
          classIconUrl: classIconUrl(character.gameClass?.slug),
          source: "character",
        });
      }

      if (results.size < limit) {
        const aliases = await prisma.characterAlias.findMany({
          where: {
            regionId: regionRow.id,
            normalizedName: { contains: normalizedNameQuery, mode: "insensitive" },
            ...(realmQuery ? { realmSlug: { contains: realmQuery, mode: "insensitive" } } : {}),
            validTo: null,
          },
          include: {
            character: {
              include: {
                realm: true,
                gameClass: true,
                activeSpec: true,
                snapshots: { orderBy: { capturedAt: "desc" }, take: 1 },
              },
            },
          },
          take: limit,
        });

        for (const alias of aliases) {
          const character = alias.character;
          addResult({
            name: character.displayName,
            realmSlug: alias.realmSlug,
            region: code as RegionCode,
            classSlug: character.gameClass?.slug ?? null,
            specSlug: character.activeSpec?.slug ?? null,
            avatarUrl: readAvatarFromSnapshot(character.snapshots[0]?.rawSummary),
            classIconUrl: classIconUrl(character.gameClass?.slug),
            source: "alias",
          });
        }
      }

      if (results.size < limit) {
        const participants = await prisma.runParticipant.findMany({
          where: {
            regionCode: code,
            displayName: { contains: namePart, mode: "insensitive" },
            ...(realmQuery ? { realmSlug: { contains: realmQuery, mode: "insensitive" } } : {}),
            characterId: { not: null },
          },
          include: {
            gameClass: true,
            spec: true,
            character: {
              include: {
                snapshots: { orderBy: { capturedAt: "desc" }, take: 1 },
              },
            },
          },
          take: limit,
          orderBy: { displayName: "asc" },
        });

        for (const participant of participants) {
          addResult({
            name: participant.displayName,
            realmSlug: participant.realmSlug,
            region: code as RegionCode,
            classSlug: participant.gameClass?.slug ?? null,
            specSlug: participant.spec?.slug ?? null,
            avatarUrl: participant.character
              ? readAvatarFromSnapshot(participant.character.snapshots[0]?.rawSummary)
              : null,
            classIconUrl: classIconUrl(participant.gameClass?.slug),
            source: "participant",
          });
        }
      }

      return Array.from(results.values()).slice(0, limit);
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
          if (profile.specSlug) {
            const role = profile.role ?? "DPS";
            const spec = await ensureGameSpecialization(tx, gameClass.id, profile.specSlug, role);
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
            ...(profile.level != null ? { level: profile.level } : {}),
            ...(profile.faction ? { faction: profile.faction } : {}),
            ...(profile.blizzardCharacterId ? { blizzardCharacterId: BigInt(profile.blizzardCharacterId) } : {}),
            lastSeenAt: new Date(),
          },
        });
      });
    },

    async recordSnapshot(characterId, snapshot, equipment, extras) {
      await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const created = await tx.characterSnapshot.create({
          data: {
            characterId,
            capturedAt: new Date(snapshot.capturedAt),
            itemLevelEquipped: snapshot.itemLevelEquipped,
            role: snapshot.role,
            mythicRating: snapshot.mythicRating,
            rawSummary: {
              ...(extras?.media
                ? {
                    media: {
                      avatarUrl: extras.media.avatarUrl,
                      insetUrl: extras.media.insetUrl,
                      mainRawUrl: extras.media.mainRawUrl,
                    },
                  }
                : {}),
            },
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
              keyItems: (equipment.keyItems ?? []) as object,
            },
          });
        }
        if (extras?.talent) {
          let specializationId: string | null = null;
          if (extras.talent.specializationSlug) {
            // Link when we already know the character's class/spec; otherwise store code-only.
            const character = await tx.character.findUnique({ where: { id: characterId } });
            if (character?.classId && character.role) {
              const existing = await tx.gameSpecialization.findFirst({
                where: {
                  classId: character.classId,
                  slug: extras.talent.specializationSlug,
                },
              });
              specializationId = existing?.id ?? null;
            }
          }
          await tx.talentSnapshot.create({
            data: {
              characterSnapshotId: created.id,
              specializationId,
              loadoutCode: extras.talent.loadoutCode,
              talents: (extras.talent.talents ?? {}) as object,
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
