import type { BlizzardProvider, RegionCode } from "@mplus/contracts";
import type { Logger } from "@mplus/observability";
import type { RealmRepository } from "../persistence/realm-repository.js";
import { RETAIL_REGION_CODES, syncRealmCatalog } from "./sync-realm-catalog.js";

export type RealmCatalogRegionReadiness = "fresh" | "stale" | "empty";

export interface RealmCatalogRegionStatus {
  region: RegionCode;
  readiness: RealmCatalogRegionReadiness;
  activeCount: number;
  lastSyncedAt: Date | null;
}

export interface RealmCatalogBootstrapResult {
  /** True when every retail region has a usable (non-empty) catalog. */
  ready: boolean;
  /** True when at least one region had to be synchronized during this bootstrap. */
  synced: boolean;
  /** Empty catalog + failed/incomplete sync — fail closed for live readiness. */
  failClosed: boolean;
  regions: RealmCatalogRegionStatus[];
  errors: string[];
}

export interface EnsureRealmCatalogReadyDeps {
  blizzard: BlizzardProvider;
  realms: RealmRepository;
  logger: Logger;
  staleAfterSeconds: number;
  now?: () => Date;
  /** When false, skip provider sync (tests). Default true. */
  allowSync?: boolean;
}

function classifyRegion(
  activeCount: number,
  lastSyncedAt: Date | null,
  now: Date,
  staleAfterSeconds: number,
): RealmCatalogRegionReadiness {
  if (activeCount <= 0) return "empty";
  if (!lastSyncedAt) return "stale";
  const ageMs = now.getTime() - lastSyncedAt.getTime();
  if (ageMs > staleAfterSeconds * 1000) return "stale";
  return "fresh";
}

/**
 * Ensure EU/US/KR/TW realm catalogs are present for public search.
 *
 * Live policy:
 * - Empty or stale regions trigger index-first synchronization (no detail burst).
 * - Empty + sync failure → failClosed (worker must not report ready).
 * - Non-empty last-known-good + sync failure → ready with warning.
 *
 * Not coupled to score-model seeding. Fixture providers stay deterministic.
 */
export async function ensureRealmCatalogReady(
  deps: EnsureRealmCatalogReadyDeps,
): Promise<RealmCatalogBootstrapResult> {
  const now = deps.now?.() ?? new Date();
  const allowSync = deps.allowSync !== false;
  const errors: string[] = [];
  const regions: RealmCatalogRegionStatus[] = [];

  for (const region of RETAIL_REGION_CODES) {
    const stats = await deps.realms.getRegionCatalogStats(region);
    regions.push({
      region,
      readiness: classifyRegion(
        stats.activeCount,
        stats.lastSyncedAt,
        now,
        deps.staleAfterSeconds,
      ),
      activeCount: stats.activeCount,
      lastSyncedAt: stats.lastSyncedAt,
    });
  }

  const needsSync = regions.filter((r) => r.readiness !== "fresh");
  let synced = false;

  if (needsSync.length > 0 && allowSync) {
    synced = true;
    const syncRegions = needsSync.map((r) => r.region);
    deps.logger.info(
      {
        event: "realm_catalog_bootstrap",
        regions: syncRegions,
        reasons: Object.fromEntries(needsSync.map((r) => [r.region, r.readiness])),
      },
      "realm catalog bootstrap sync starting (index-first)",
    );

    try {
      const results = await syncRealmCatalog(
        {
          blizzard: deps.blizzard,
          realms: deps.realms,
          logger: deps.logger,
          now: () => now,
        },
        {
          regions: syncRegions,
          forceDetails: false,
          requestedAt: now.toISOString(),
        },
      );
      for (const result of results) {
        if (result.errors.length > 0 && result.minimallyUpserted === 0) {
          errors.push(`${result.region}: ${result.errors.join("; ")}`);
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(message);
      deps.logger.warn({ err: error, event: "realm_catalog_bootstrap" }, "realm catalog bootstrap sync failed");
    }

    // Re-read after sync.
    for (let i = 0; i < regions.length; i += 1) {
      const region = regions[i]!.region;
      const stats = await deps.realms.getRegionCatalogStats(region);
      regions[i] = {
        region,
        readiness: classifyRegion(
          stats.activeCount,
          stats.lastSyncedAt,
          now,
          deps.staleAfterSeconds,
        ),
        activeCount: stats.activeCount,
        lastSyncedAt: stats.lastSyncedAt,
      };
    }
  }

  const emptyRegions = regions.filter((r) => r.activeCount <= 0);
  const failClosed = emptyRegions.length > 0;
  const ready = !failClosed;

  if (failClosed) {
    deps.logger.error(
      {
        event: "realm_catalog_ready",
        readiness: "unavailable",
        emptyRegions: emptyRegions.map((r) => r.region),
        errors,
      },
      "realm catalog empty after bootstrap — fail closed",
    );
  } else if (errors.length > 0) {
    deps.logger.warn(
      {
        event: "realm_catalog_ready",
        readiness: "degraded",
        errors,
        regions: regions.map((r) => ({
          region: r.region,
          activeCount: r.activeCount,
          readiness: r.readiness,
        })),
      },
      "realm catalog refresh failed — using last-known-good",
    );
  } else {
    deps.logger.info(
      {
        event: "realm_catalog_ready",
        readiness: "ok",
        synced,
        regions: regions.map((r) => ({
          region: r.region,
          activeCount: r.activeCount,
          readiness: r.readiness,
          lastSyncedAt: r.lastSyncedAt?.toISOString() ?? null,
        })),
      },
      "realm catalog readiness ok",
    );
  }

  return { ready, synced, failClosed, regions, errors };
}
