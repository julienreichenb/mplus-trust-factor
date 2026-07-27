import type { Realm, Region } from "@mplus/database";
import type { PrismaClient } from "@mplus/database";
import { normalizeRealmSlug, normalizeRegion } from "@mplus/domain";
import type { PrismaClientOrTx } from "./shared.js";

/** Default host mapping used only when a region has to be auto-created from fixture data. */
const REGION_DEFAULTS: Record<string, { apiHost: string; localeDefault: string }> = {
  EU: { apiHost: "https://eu.api.blizzard.com", localeDefault: "en_GB" },
  US: { apiHost: "https://us.api.blizzard.com", localeDefault: "en_US" },
  KR: { apiHost: "https://kr.api.blizzard.com", localeDefault: "ko_KR" },
  TW: { apiHost: "https://tw.api.blizzard.com", localeDefault: "zh_TW" },
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

  return client.realm.create({
    data: { regionId, slug, name: realmName ?? slug },
  });
}

export interface RealmSearchResult {
  id: string;
  regionCode: string;
  slug: string;
  name: string;
}

export interface RealmRepository {
  search(region: string, query: string): Promise<RealmSearchResult[]>;
  ensureRealm(regionCode: string, realmSlug: string, realmName?: string): Promise<Realm>;
}

export function createRealmRepository(prisma: PrismaClient): RealmRepository {
  return {
    async search(region, query) {
      const code = normalizeRegion(region);
      const realms = await prisma.realm.findMany({
        where: {
          region: { code },
          OR: [
            { slug: { contains: normalizeRealmSlug(query) } },
            { name: { contains: query, mode: "insensitive" } },
          ],
        },
        include: { region: true },
        take: 20,
        orderBy: { name: "asc" },
      });
      return realms.map((realm) => ({
        id: realm.id,
        regionCode: realm.region.code,
        slug: realm.slug,
        name: realm.name,
      }));
    },
    async ensureRealm(regionCode, realmSlug, realmName) {
      const region = await ensureRegion(prisma, regionCode);
      return ensureRealmRecord(prisma, region.id, realmSlug, realmName);
    },
  };
}
