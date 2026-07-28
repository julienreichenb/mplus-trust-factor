import type { Realm, Region, PrismaClient } from "@mplus/database";
import type { BlizzardRealmDTO, RegionCode, RealmCatalogOption } from "@mplus/contracts";
import {
  foldDiacritics,
  normalizeRealmSearchKey,
  normalizeRealmSlug,
  normalizeRegion,
} from "@mplus/domain";
import type { PrismaClientOrTx } from "./shared.js";

/** Default host mapping used only when a region has to be auto-created from fixture data. */
const REGION_DEFAULTS: Record<string, { apiHost: string; localeDefault: string }> = {
  EU: { apiHost: "https://eu.api.blizzard.com", localeDefault: "en_GB" },
  US: { apiHost: "https://us.api.blizzard.com", localeDefault: "en_US" },
  KR: { apiHost: "https://kr.api.blizzard.com", localeDefault: "ko_KR" },
  TW: { apiHost: "https://tw.api.blizzard.com", localeDefault: "zh_TW" },
};

const REGION_LABEL: Record<string, string> = {
  EU: "Europe",
  US: "Americas",
  KR: "Korea",
  TW: "Taiwan",
};

const LOCALE_LABEL: Record<string, string> = {
  en_GB: "English",
  en_US: "English",
  fr_FR: "Français",
  de_DE: "Deutsch",
  es_ES: "Español",
  es_MX: "Español",
  it_IT: "Italiano",
  pt_BR: "Português",
  pt_PT: "Português",
  ru_RU: "Русский",
  ko_KR: "한국어",
  zh_TW: "繁體中文",
  zh_CN: "简体中文",
};

export async function ensureRegion(client: PrismaClientOrTx, regionCode: string): Promise<Region> {
  const code = normalizeRegion(regionCode);
  const existing = await client.region.findUnique({ where: { code } });
  if (existing) return existing;

  const defaults = REGION_DEFAULTS[code] ?? {
    apiHost: `https://${code.toLowerCase()}.api.blizzard.com`,
    localeDefault: "en_GB",
  };
  return client.region.create({
    data: { code, apiHost: defaults.apiHost, localeDefault: defaults.localeDefault, enabled: true },
  });
}

export async function ensureRealmRecord(
  client: PrismaClientOrTx,
  regionId: string,
  realmSlug: string,
  realmName?: string,
): Promise<Realm> {
  const slug = normalizeRealmSlug(realmSlug);
  const existing = await client.realm.findUnique({ where: { regionId_slug: { regionId, slug } } });
  if (existing) return existing;

  const name = realmName ?? slug;
  return client.realm.create({
    data: {
      regionId,
      slug,
      name,
      nameNormalized: normalizeRealmSearchKey(name),
      isActive: true,
      isTournament: false,
    },
  });
}

export function buildRealmDisplayLabel(input: {
  name: string;
  region: string;
}): string {
  return `${input.name} — ${normalizeRegion(input.region)}`;
}

export function buildRealmOptionSecondary(input: {
  region: string;
  locale: string | null;
  category: string | null;
}): string {
  const regionLabel = REGION_LABEL[normalizeRegion(input.region)] ?? normalizeRegion(input.region);
  const localeLabel =
    (input.locale ? LOCALE_LABEL[input.locale] : null) ??
    input.category ??
    input.locale ??
    null;
  return localeLabel ? `${regionLabel} · ${localeLabel}` : regionLabel;
}

export interface RealmSearchResult {
  id: string;
  regionCode: string;
  slug: string;
  name: string;
  locale: string | null;
  connectedRealmId: number | null;
  displayLabel: string;
  timezone: string | null;
  category: string | null;
}

export interface RealmCatalogUpsertInput {
  regionCode: RegionCode;
  blizzardRealmId: number;
  slug: string;
  name: string;
  connectedRealmId: number | null;
  locale: string | null;
  timezone: string | null;
  category: string | null;
  isTournament: boolean;
  syncedAt: Date;
}

export interface RealmRepository {
  search(options: {
    query?: string;
    region?: string | null;
    limit?: number;
    includeInactive?: boolean;
    includeTournament?: boolean;
  }): Promise<RealmSearchResult[]>;
  ensureRealm(regionCode: string, realmSlug: string, realmName?: string): Promise<Realm>;
  findBySlug(regionCode: string, realmSlug: string): Promise<(Realm & { region: Region }) | null>;
  /** Catalog lookup including inactive/tournament rows (used by sync). */
  findCatalogBySlug(regionCode: string, realmSlug: string): Promise<(Realm & { region: Region }) | null>;
  upsertCatalogEntry(input: RealmCatalogUpsertInput): Promise<Realm>;
  markMissingInactive(regionCode: string, presentSlugs: string[], syncedAt: Date): Promise<number>;
  toCatalogOption(row: RealmSearchResult): RealmCatalogOption;
}

function rankRealmMatch(
  row: { name: string; slug: string; regionCode: string; nameNormalized: string | null },
  query: string,
): number {
  if (!query) return 100;
  const q = foldDiacritics(query);
  const qSlug = normalizeRealmSlug(query);
  const nameFolded = row.nameNormalized ?? foldDiacritics(row.name);
  const slug = row.slug;
  const region = row.regionCode.toLowerCase();

  if (slug === qSlug || nameFolded === q) return 0;
  if (slug.startsWith(qSlug) || nameFolded.startsWith(q)) return 1;
  if (region === q || region.startsWith(q)) return 2;
  if (slug.includes(qSlug) || nameFolded.includes(q)) return 3;
  return 10;
}

export function createRealmRepository(prisma: PrismaClient): RealmRepository {
  return {
    async search({
      query = "",
      region = null,
      limit = 25,
      includeInactive = false,
      includeTournament = false,
    }) {
      const take = Math.min(Math.max(limit, 1), 100);
      const code = region ? normalizeRegion(region) : null;
      const q = query.trim();
      const folded = q ? foldDiacritics(q) : "";
      const slugQ = q ? normalizeRealmSlug(q) : "";

      const realms = await prisma.realm.findMany({
        where: {
          ...(code ? { region: { code } } : { region: { enabled: true } }),
          ...(includeInactive ? {} : { isActive: true }),
          ...(includeTournament ? {} : { isTournament: false }),
          ...(q
            ? {
                OR: [
                  { slug: { contains: slugQ } },
                  { name: { contains: q, mode: "insensitive" } },
                  { nameNormalized: { contains: folded } },
                  { locale: { contains: q, mode: "insensitive" } },
                  { region: { code: { contains: q.toUpperCase(), mode: "insensitive" } } },
                ],
              }
            : {}),
        },
        include: { region: true },
        take: Math.min(take * 4, 200),
        orderBy: { name: "asc" },
      });

      const ranked = realms
        .map((realm) => ({
          realm,
          rank: rankRealmMatch(
            {
              name: realm.name,
              slug: realm.slug,
              regionCode: realm.region.code,
              nameNormalized: realm.nameNormalized,
            },
            q,
          ),
        }))
        .sort((a, b) => a.rank - b.rank || a.realm.name.localeCompare(b.realm.name))
        .slice(0, take);

      return ranked.map(({ realm }) => ({
        id: realm.id,
        regionCode: realm.region.code,
        slug: realm.slug,
        name: realm.name,
        locale: realm.locale,
        connectedRealmId: realm.connectedRealmId == null ? null : Number(realm.connectedRealmId),
        displayLabel: buildRealmDisplayLabel({ name: realm.name, region: realm.region.code }),
        timezone: realm.timezone,
        category: realm.category,
      }));
    },

    async ensureRealm(regionCode, realmSlug, realmName) {
      const region = await ensureRegion(prisma, regionCode);
      return ensureRealmRecord(prisma, region.id, realmSlug, realmName);
    },

    async findBySlug(regionCode, realmSlug) {
      const code = normalizeRegion(regionCode);
      const slug = normalizeRealmSlug(realmSlug);
      return prisma.realm.findFirst({
        where: { slug, region: { code }, isActive: true, isTournament: false },
        include: { region: true },
      });
    },

    async findCatalogBySlug(regionCode, realmSlug) {
      const code = normalizeRegion(regionCode);
      const slug = normalizeRealmSlug(realmSlug);
      return prisma.realm.findFirst({
        where: { slug, region: { code } },
        include: { region: true },
      });
    },

    async upsertCatalogEntry(input) {
      const region = await ensureRegion(prisma, input.regionCode);
      const slug = normalizeRealmSlug(input.slug);
      const nameNormalized = normalizeRealmSearchKey(input.name);
      return prisma.realm.upsert({
        where: { regionId_slug: { regionId: region.id, slug } },
        create: {
          regionId: region.id,
          blizzardRealmId: BigInt(input.blizzardRealmId),
          slug,
          name: input.name,
          nameNormalized,
          connectedRealmId: input.connectedRealmId == null ? null : BigInt(input.connectedRealmId),
          locale: input.locale,
          timezone: input.timezone,
          category: input.category,
          isTournament: input.isTournament,
          isActive: true,
          lastSyncedAt: input.syncedAt,
        },
        update: {
          blizzardRealmId: BigInt(input.blizzardRealmId),
          name: input.name,
          nameNormalized,
          connectedRealmId: input.connectedRealmId == null ? null : BigInt(input.connectedRealmId),
          locale: input.locale,
          timezone: input.timezone,
          category: input.category,
          isTournament: input.isTournament,
          isActive: true,
          lastSyncedAt: input.syncedAt,
        },
      });
    },

    async markMissingInactive(_regionCode, _presentSlugs, _syncedAt) {
      // Soft-omit policy: never delete and never deactivate on a single provider omission.
      // Absent realms keep their lastSyncedAt; a later scheduled refresh may add multi-miss logic.
      return 0;
    },

    toCatalogOption(row) {
      return {
        name: row.name,
        slug: row.slug,
        region: normalizeRegion(row.regionCode),
        locale: row.locale,
        connectedRealmId: row.connectedRealmId,
        displayLabel: row.displayLabel,
        timezone: row.timezone,
        category: row.category,
      };
    },
  };
}

/** Map a Blizzard realm DTO into a catalog upsert payload. */
export function catalogInputFromBlizzardRealm(
  dto: BlizzardRealmDTO,
  syncedAt: Date,
): RealmCatalogUpsertInput {
  return {
    regionCode: normalizeRegion(dto.region),
    blizzardRealmId: dto.blizzardRealmId,
    slug: dto.slug,
    name: dto.name,
    connectedRealmId: dto.connectedRealmId,
    locale: dto.locale,
    timezone: dto.timezone,
    category: dto.category,
    isTournament: dto.isTournament,
    syncedAt,
  };
}
