import { randomUUID } from "node:crypto";
import type {
  BlizzardProvider,
  ProviderFetchContext,
  RegionCode,
  SyncRealmCatalogJob,
} from "@mplus/contracts";
import { normalizeRegion } from "@mplus/domain";
import type { Logger } from "@mplus/observability";
import {
  catalogInputFromBlizzardRealm,
  type RealmRepository,
} from "../persistence/realm-repository.js";

export const RETAIL_REGION_CODES: RegionCode[] = ["EU", "US", "KR", "TW"];

export interface RealmSyncResult {
  region: RegionCode;
  indexed: number;
  upserted: number;
  detailsFetched: number;
  skippedDetails: number;
  errors: string[];
}

export interface SyncRealmCatalogDeps {
  blizzard: BlizzardProvider;
  realms: RealmRepository;
  logger: Logger;
  now?: () => Date;
}

function buildCtx(region: RegionCode, forceRefresh: boolean, correlationId?: string | null): ProviderFetchContext {
  const now = new Date().toISOString();
  const requestId = correlationId ?? randomUUID();
  return {
    region,
    requestId,
    correlationId: correlationId ?? null,
    forceRefresh,
    now,
  };
}

/**
 * Synchronize the retail realm catalog for one or more regions from Blizzard Game Data.
 * Idempotent upsert by (region, slug). Does not hard-delete omitted realms.
 */
export async function syncRealmCatalog(
  deps: SyncRealmCatalogDeps,
  job: Partial<SyncRealmCatalogJob> = {},
): Promise<RealmSyncResult[]> {
  const regions = (job.regions?.length ? job.regions : RETAIL_REGION_CODES).map((r) =>
    normalizeRegion(r),
  ) as RegionCode[];
  const forceDetails = job.forceDetails === true;
  const syncedAt = deps.now?.() ?? new Date();
  const results: RealmSyncResult[] = [];

  for (const region of regions) {
    const result: RealmSyncResult = {
      region,
      indexed: 0,
      upserted: 0,
      detailsFetched: 0,
      skippedDetails: 0,
      errors: [],
    };
    try {
      const index = await deps.blizzard.getRealmIndex(
        buildCtx(region, forceDetails, job.correlationId),
      );
      result.indexed = index.data.length;

      for (const entry of index.data) {
        try {
          const existing = await deps.realms.findCatalogBySlug(region, entry.slug);
          const needsDetails =
            forceDetails ||
            !existing ||
            existing.blizzardRealmId == null ||
            existing.connectedRealmId == null ||
            existing.locale == null;

          if (needsDetails) {
            const detail = await deps.blizzard.getRealm(
              entry.slug,
              buildCtx(region, forceDetails, job.correlationId),
            );
            result.detailsFetched += 1;
            await deps.realms.upsertCatalogEntry(
              catalogInputFromBlizzardRealm(detail.data, syncedAt),
            );
          } else {
            result.skippedDetails += 1;
            await deps.realms.upsertCatalogEntry({
              regionCode: region,
              blizzardRealmId: Number(existing.blizzardRealmId),
              slug: entry.slug,
              name: entry.name || existing.name,
              connectedRealmId:
                existing.connectedRealmId == null ? null : Number(existing.connectedRealmId),
              locale: existing.locale,
              timezone: existing.timezone,
              category: existing.category,
              isTournament: existing.isTournament,
              syncedAt,
            });
          }
          result.upserted += 1;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          result.errors.push(`${entry.slug}: ${message}`);
          deps.logger.warn({ err: error, region, slug: entry.slug }, "realm detail sync failed");
        }
      }

      await deps.realms.markMissingInactive(
        region,
        index.data.map((e) => e.slug),
        syncedAt,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      result.errors.push(message);
      deps.logger.error({ err: error, region }, "realm index sync failed");
    }
    results.push(result);
    deps.logger.info({ ...result }, "realm catalog region sync finished");
  }

  return results;
}
