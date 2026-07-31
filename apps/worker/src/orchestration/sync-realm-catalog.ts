import { randomUUID } from "node:crypto";
import type {
  BlizzardProvider,
  ProviderFetchContext,
  RegionCode,
  SyncRealmCatalogJob,
} from "@mplus/contracts";
import {
  classifyRealmCatalogEntry,
  classifyRealmIndexEntry,
  normalizeRegion,
  type RealmCatalogRejectionReason,
} from "@mplus/domain";
import type { Logger } from "@mplus/observability";
import {
  catalogInputFromBlizzardRealm,
  type RealmRepository,
} from "../persistence/realm-repository.js";

export const RETAIL_REGION_CODES: RegionCode[] = ["EU", "US", "KR", "TW"];

/** Guard: never deactivate a whole region on an empty/partial index response. */
export const MIN_PLAUSIBLE_REALM_INDEX_COUNT = 5;

export interface RealmSyncResult {
  region: RegionCode;
  indexEntries: number;
  rejectedAtIndex: number;
  detailCandidates: number;
  detailsFetched: number;
  eligible: number;
  rejectedTournament: number;
  rejectedInternal: number;
  detailFailures: number;
  retainedLastKnownGood: number;
  newlyDeactivated: number;
  activeCatalogCount: number;
  /** @deprecated Prefer `eligible` — kept for script compatibility. */
  upserted: number;
  minimallyUpserted: number;
  enriched: number;
  enrichmentFailures: number;
  skippedDetails: number;
  errors: string[];
  rejectedSamples: string[];
}

export interface SyncRealmCatalogDeps {
  blizzard: BlizzardProvider;
  realms: RealmRepository;
  logger: Logger;
  now?: () => Date;
  /** Bounded concurrency for detail fetches (default 4). */
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

function bumpRejection(
  result: RealmSyncResult,
  reason: RealmCatalogRejectionReason,
  sampleName: string,
): void {
  if (reason === "TOURNAMENT") result.rejectedTournament += 1;
  else if (reason.startsWith("INTERNAL_")) result.rejectedInternal += 1;
  if (result.rejectedSamples.length < 8) {
    result.rejectedSamples.push(`${sampleName} (${reason})`);
  }
}

/**
 * Synchronize the retail realm catalog for one or more regions from Blizzard Game Data.
 *
 * Index discovers candidates; only detail-validated eligible realms become active/public.
 * Technical/tournament realms are stored inactive. Transient detail failures retain
 * last-known-good validated rows and never activate new unvalidated rows.
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
      indexEntries: 0,
      rejectedAtIndex: 0,
      detailCandidates: 0,
      detailsFetched: 0,
      eligible: 0,
      rejectedTournament: 0,
      rejectedInternal: 0,
      detailFailures: 0,
      retainedLastKnownGood: 0,
      newlyDeactivated: 0,
      activeCatalogCount: 0,
      upserted: 0,
      minimallyUpserted: 0,
      enriched: 0,
      enrichmentFailures: 0,
      skippedDetails: 0,
      errors: [],
      rejectedSamples: [],
    };

    try {
      const index = await deps.blizzard.getRealmIndex(
        buildCtx(region, forceDetails, job.correlationId),
      );
      result.indexEntries = index.data.length;

      if (index.data.length < MIN_PLAUSIBLE_REALM_INDEX_COUNT) {
        result.errors.push(
          `index too small (${index.data.length}); retaining last-known-good catalog`,
        );
        deps.logger.error(
          { region, indexed: index.data.length },
          "realm index response not plausible — skipping visibility changes",
        );
        result.activeCatalogCount = await deps.realms.countActiveByRegion(region);
        results.push(result);
        continue;
      }

      const earlyRejected: typeof index.data = [];
      const candidates: typeof index.data = [];
      for (const entry of index.data) {
        const early = classifyRealmIndexEntry({ name: entry.name, slug: entry.slug });
        if (!early.eligible) {
          earlyRejected.push(entry);
          result.rejectedAtIndex += 1;
          bumpRejection(result, early.reason, entry.name);
        } else {
          candidates.push(entry);
        }
      }
      result.detailCandidates = candidates.length;

      // Persist early-rejected technical rows as inactive (cleans polluted DB rows).
      for (const entry of earlyRejected) {
        const existing = await deps.realms.findCatalogBySlug(region, entry.slug);
        const wasActive = existing?.isActive === true;
        await deps.realms.upsertCatalogEntry({
          regionCode: region,
          blizzardRealmId: entry.blizzardRealmId,
          slug: entry.slug,
          name: entry.name || entry.slug,
          connectedRealmId:
            existing?.connectedRealmId == null ? null : Number(existing.connectedRealmId),
          locale: existing?.locale ?? null,
          timezone: existing?.timezone ?? null,
          category: existing?.category ?? null,
          isTournament: existing?.isTournament === true,
          isActive: false,
          syncedAt,
        });
        result.minimallyUpserted += 1;
        if (wasActive) result.newlyDeactivated += 1;
      }

      // Detail-fetch remaining candidates (always required for public activation).
      await mapPool(candidates, detailConcurrency, async (entry) => {
        const existing = await deps.realms.findCatalogBySlug(region, entry.slug);
        const previouslyValidated =
          existing?.isActive === true &&
          existing.blizzardRealmId != null &&
          existing.connectedRealmId != null &&
          existing.isTournament !== true;

        try {
          const detail = await deps.blizzard.getRealm(
            entry.slug,
            buildCtx(region, forceDetails, job.correlationId),
          );
          result.detailsFetched += 1;
          result.enriched += 1;

          const dto = detail.data;
          const eligibility = classifyRealmCatalogEntry({
            name: dto.name,
            slug: dto.slug,
            blizzardRealmId: dto.blizzardRealmId,
            region: dto.region,
            isTournament: dto.isTournament,
            connectedRealmId: dto.connectedRealmId,
            requireConnectedRealm: true,
          });

          if (eligibility.eligible) {
            await deps.realms.upsertCatalogEntry({
              ...catalogInputFromBlizzardRealm(dto, syncedAt),
              isActive: true,
            });
            result.eligible += 1;
            result.upserted += 1;
            return;
          }

          bumpRejection(result, eligibility.reason, dto.name);
          const wasActive = existing?.isActive === true;
          await deps.realms.upsertCatalogEntry({
            ...catalogInputFromBlizzardRealm(dto, syncedAt),
            isActive: false,
            isTournament: dto.isTournament === true || eligibility.reason === "TOURNAMENT",
          });
          if (wasActive) result.newlyDeactivated += 1;
        } catch (error) {
          result.detailFailures += 1;
          result.enrichmentFailures += 1;
          const message = error instanceof Error ? error.message : String(error);
          result.errors.push(`${entry.slug}: ${message}`);
          deps.logger.warn(
            { err: error, region, slug: entry.slug },
            "realm detail fetch failed",
          );

          if (previouslyValidated) {
            // Retain last-known-good public row; refresh sync stamp only via inactive-safe path.
            result.retainedLastKnownGood += 1;
            return;
          }

          // New / never-validated: stage inactive index row — never activate.
          await deps.realms.upsertCatalogIndexEntry({
            regionCode: region,
            blizzardRealmId: entry.blizzardRealmId,
            slug: entry.slug,
            name: entry.name || entry.slug,
            syncedAt,
          });
          result.minimallyUpserted += 1;
        }
      });

      result.activeCatalogCount = await deps.realms.countActiveByRegion(region);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      result.errors.push(message);
      deps.logger.error({ err: error, region }, "realm index sync failed");
      try {
        result.activeCatalogCount = await deps.realms.countActiveByRegion(region);
      } catch {
        /* ignore */
      }
    }

    results.push(result);
    deps.logger.info(
      {
        region: result.region,
        indexEntries: result.indexEntries,
        rejectedAtIndex: result.rejectedAtIndex,
        detailCandidates: result.detailCandidates,
        detailsFetched: result.detailsFetched,
        eligible: result.eligible,
        rejectedTournament: result.rejectedTournament,
        rejectedInternal: result.rejectedInternal,
        detailFailures: result.detailFailures,
        retainedLastKnownGood: result.retainedLastKnownGood,
        newlyDeactivated: result.newlyDeactivated,
        activeCatalogCount: result.activeCatalogCount,
        rejectedSamples: result.rejectedSamples,
      },
      "realm catalog region sync finished",
    );
  }

  return results;
}
