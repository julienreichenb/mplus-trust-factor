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
  /** Index rows written or refreshed (minimal upsert). */
  minimallyUpserted: number;
  /** Successfully detail-enriched rows. */
  enriched: number;
  enrichmentFailures: number;
  activeCatalogCount: number;
  /** @deprecated Prefer `minimallyUpserted` — kept for script compatibility. */
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
  /** Bounded concurrency for optional detail enrichment (default 4). */
  detailConcurrency?: number;
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

async function mapPool<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  const limit = Math.max(1, concurrency);
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      await worker(items[index]!);
    }
  });
  await Promise.all(runners);
}

/**
 * Synchronize the retail realm catalog for one or more regions from Blizzard Game Data.
 *
 * Index-first: every realm index entry is upserted immediately (slug/name/id).
 * Detail enrichment (`getRealm`) is optional, best-effort, and bounded-concurrency.
 * A failed detail request never removes or blocks the minimal catalog row.
 * Idempotent; does not hard-delete omitted realms (last-known-good).
 *
 * Normal bootstrap requires only the index request per region.
 */
export async function syncRealmCatalog(
  deps: SyncRealmCatalogDeps,
  job: Partial<SyncRealmCatalogJob> = {},
): Promise<RealmSyncResult[]> {
  const regions = (job.regions?.length ? job.regions : RETAIL_REGION_CODES).map((r) =>
    normalizeRegion(r),
  ) as RegionCode[];
  const forceDetails = job.forceDetails === true;
  const detailConcurrency = deps.detailConcurrency ?? 4;
  const syncedAt = deps.now?.() ?? new Date();
  const results: RealmSyncResult[] = [];

  for (const region of regions) {
    const result: RealmSyncResult = {
      region,
      indexed: 0,
      minimallyUpserted: 0,
      enriched: 0,
      enrichmentFailures: 0,
      activeCatalogCount: 0,
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

      // Phase 1 — persist every index entry (exhaustive catalog).
      for (const entry of index.data) {
        try {
          await deps.realms.upsertCatalogIndexEntry({
            regionCode: region,
            blizzardRealmId: entry.blizzardRealmId,
            slug: entry.slug,
            name: entry.name || entry.slug,
            syncedAt,
          });
          result.minimallyUpserted += 1;
          result.upserted += 1;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          result.errors.push(`${entry.slug}: index upsert failed: ${message}`);
          deps.logger.warn({ err: error, region, slug: entry.slug }, "realm index upsert failed");
        }
      }

      await deps.realms.markMissingInactive(
        region,
        index.data.map((e) => e.slug),
        syncedAt,
      );

      // Phase 2 — optional best-effort detail enrichment (maintenance / forceDetails).
      if (forceDetails && index.data.length > 0) {
        await mapPool(index.data, detailConcurrency, async (entry) => {
          try {
            const detail = await deps.blizzard.getRealm(
              entry.slug,
              buildCtx(region, forceDetails, job.correlationId),
            );
            result.detailsFetched += 1;
            await deps.realms.upsertCatalogEntry(
              catalogInputFromBlizzardRealm(detail.data, syncedAt),
            );
            result.enriched += 1;
          } catch (error) {
            result.enrichmentFailures += 1;
            const message = error instanceof Error ? error.message : String(error);
            result.errors.push(`${entry.slug}: ${message}`);
            deps.logger.warn(
              { err: error, region, slug: entry.slug },
              "realm detail enrichment failed — minimal catalog row retained",
            );
          }
        });
      } else {
        result.skippedDetails = index.data.length;
      }

      result.activeCatalogCount = await deps.realms.countActiveByRegion(region);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      result.errors.push(message);
      deps.logger.error({ err: error, region }, "realm index sync failed");
      try {
        result.activeCatalogCount = await deps.realms.countActiveByRegion(region);
      } catch {
        /* ignore secondary failure */
      }
    }
    results.push(result);
    deps.logger.info(
      {
        region: result.region,
        indexed: result.indexed,
        minimallyUpserted: result.minimallyUpserted,
        enriched: result.enriched,
        enrichmentFailures: result.enrichmentFailures,
        activeCatalogCount: result.activeCatalogCount,
        skippedDetails: result.skippedDetails,
        errorCount: result.errors.length,
      },
      "realm catalog region sync finished",
    );
  }

  return results;
}
