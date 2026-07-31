import { createLogger } from "@mplus/observability";
import {
  RETAIL_REGION_CODES,
  clearSeasonAuthorityCacheForTests,
  listPersistedRegionsForAuthority,
  repairSeasonAuthority,
  syncRealmCatalog,
  type RealmSyncResult,
} from "@mplus/worker";
import type { RegionCode } from "@mplus/contracts";
import type { ApiContainer } from "../container.js";
import { HttpError } from "../errors.js";

const REGION_SET = new Set<string>(RETAIL_REGION_CODES);

export interface SeasonAuthoritySyncReport {
  region: string;
  previous: { blizzardSeasonId: number | null; slug: string | null };
  current: {
    blizzardSeasonId: number;
    slug: string;
    authoritySource: string;
    authorityVerifiedAt: string;
  };
  changed: boolean;
}

export class AdminMiscService {
  constructor(private readonly container: ApiContainer) {}

  async syncRealmCatalog(input: {
    regions?: string[] | null;
    forceDetails?: boolean;
  }): Promise<{ ok: true; results: RealmSyncResult[] }> {
    const regions = this.normalizeRegions(input.regions);
    const logger = createLogger({
      level: this.container.env.LOG_LEVEL,
      name: "admin-misc.realms-sync",
    });

    const results = await syncRealmCatalog(
      {
        blizzard: this.container.worker.providers.blizzard,
        realms: this.container.worker.repositories.realm,
        logger,
      },
      {
        regions,
        forceDetails: input.forceDetails === true,
        requestedAt: new Date().toISOString(),
      },
    );

    return { ok: true, results };
  }

  async syncSeasonAuthority(input: {
    regions?: string[] | null;
  }): Promise<{ ok: true; results: SeasonAuthoritySyncReport[] }> {
    const requested = this.normalizeRegions(input.regions);
    clearSeasonAuthorityCacheForTests();

    const deps = {
      prisma: this.container.worker.prisma,
      blizzard: this.container.worker.providers.blizzard,
      logger: createLogger({
        level: this.container.env.LOG_LEVEL,
        name: "admin-misc.season-sync",
      }),
    };

    let regionCodes: string[];
    if (requested?.length) {
      regionCodes = requested;
    } else {
      const persisted = await listPersistedRegionsForAuthority(deps.prisma);
      regionCodes = persisted.map((r) => r.code.toUpperCase());
    }

    if (regionCodes.length === 0) {
      throw HttpError.badRequest(
        "NO_REGIONS",
        "No regions found in database. Seed regions first.",
      );
    }

    const results: SeasonAuthoritySyncReport[] = [];
    for (const code of regionCodes) {
      const repaired = await repairSeasonAuthority(deps, code);
      results.push({
        region: repaired.region,
        previous: repaired.previous,
        current: {
          blizzardSeasonId: repaired.current.blizzardSeasonId,
          slug: repaired.current.slug,
          authoritySource: repaired.current.authoritySource,
          authorityVerifiedAt: repaired.current.authorityVerifiedAt.toISOString(),
        },
        changed: repaired.changed,
      });
    }

    return { ok: true, results };
  }

  private normalizeRegions(raw: string[] | null | undefined): RegionCode[] | undefined {
    if (!raw?.length) return undefined;
    const regions = [
      ...new Set(
        raw
          .map((r) => r.trim().toUpperCase())
          .filter((r) => REGION_SET.has(r)),
      ),
    ] as RegionCode[];
    return regions.length ? regions : undefined;
  }
}
