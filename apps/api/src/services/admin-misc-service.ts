import { createLogger } from "@mplus/observability";
import {
  RETAIL_REGION_CODES,
  clearSeasonAuthorityCacheForTests,
  listPersistedRegionsForAuthority,
  repairSeasonAuthority,
  syncRealmCatalog,
  getScoringSeasonSelection,
  updateScoringSeasonSelection,
  evaluateSeasonCatalogReadiness,
  ScoringSeasonSelectionConflictError,
  ScoringSeasonNotPinnableError,
  isNonProductSeasonSlug,
  ensureSeasonDataReady,
  requestKeyDistributionRefreshJob,
  readActiveMplusCatalogMetadata,
  resolveScoringCatalogDiscoverer,
} from "@mplus/worker";
import type {
  AdminRealmSyncResponse,
  RegionCode,
  ScoringSeasonOptionDTO,
  ScoringSeasonSelectionStatusDTO,
  UpdateScoringSeasonSelectionBody,
} from "@mplus/contracts";
import type { ApiContainer } from "../container.js";
import { HttpError } from "../errors.js";
import { toAdminRealmSyncResponse } from "./admin-realm-sync-response.js";
import { writeAuditEvent } from "../iam/audit.js";

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
  }): Promise<AdminRealmSyncResponse> {
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

    return toAdminRealmSyncResponse(results);
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

  /**
   * Platform scoring season selection status for Admin Misc.
   * Does not call Blizzard/WCL — uses persisted Season rows + RuntimeSetting.
   */
  async getScoringSeasonSelectionStatus(input: {
    regionCode?: string | null;
  } = {}): Promise<ScoringSeasonSelectionStatusDTO> {
    const prisma = this.container.worker.prisma;
    const regionCode = (input.regionCode ?? "EU").trim().toUpperCase();
    const region = await prisma.region.findFirst({
      where: { code: { equals: regionCode, mode: "insensitive" } },
    });
    if (!region) {
      throw HttpError.badRequest("REGION_NOT_FOUND", `Region ${regionCode} not found`);
    }

    const selectionRow = await getScoringSeasonSelection(prisma);
    const seasons = await prisma.season.findMany({
      where: { regionId: region.id },
      orderBy: [{ isCurrent: "desc" }, { blizzardSeasonId: "desc" }, { updatedAt: "desc" }],
    });

    const options: ScoringSeasonOptionDTO[] = [];
    for (const season of seasons) {
      if (isNonProductSeasonSlug(season.slug)) {
        continue;
      }
      const readiness = await evaluateSeasonCatalogReadiness(prisma, season);
      options.push({
        id: season.id,
        slug: season.slug,
        name: season.name,
        blizzardSeasonId: season.blizzardSeasonId,
        regionCode: region.code.toUpperCase(),
        isBlizzardCurrent: season.isCurrent,
        catalogReady: readiness.ready,
        wclZoneId: readiness.wclZoneId,
        startsAt: season.startsAt?.toISOString() ?? null,
        endsAt: season.endsAt?.toISOString() ?? null,
        pinnable: season.blizzardSeasonId != null,
      });
    }

    const detected = options.find((s) => s.isBlizzardCurrent) ?? null;
    let effectiveBlizzardId: number | null = null;
    if (selectionRow.selection.mode === "PINNED") {
      effectiveBlizzardId = selectionRow.selection.blizzardSeasonId;
    } else {
      effectiveBlizzardId = detected?.blizzardSeasonId ?? null;
    }
    const effective =
      effectiveBlizzardId != null
        ? (options.find((s) => s.blizzardSeasonId === effectiveBlizzardId) ?? null)
        : null;

    return {
      selection: selectionRow.selection,
      version: selectionRow.version === 0 ? 1 : selectionRow.version,
      updatedAt: selectionRow.updatedAt?.toISOString() ?? null,
      updatedByUserId: selectionRow.updatedByUserId,
      regionCode: region.code.toUpperCase(),
      detectedCurrentSeason: detected
        ? {
            id: detected.id,
            slug: detected.slug,
            name: detected.name,
            blizzardSeasonId: detected.blizzardSeasonId,
          }
        : null,
      effectiveScoringSeason: effective
        ? {
            id: effective.id,
            slug: effective.slug,
            name: effective.name,
            blizzardSeasonId: effective.blizzardSeasonId,
            wclZoneId: effective.wclZoneId,
            catalogReady: effective.catalogReady,
          }
        : null,
      pinnedDiffersFromDetected:
        selectionRow.selection.mode === "PINNED" &&
        detected?.blizzardSeasonId != null &&
        selectionRow.selection.blizzardSeasonId !== detected.blizzardSeasonId,
      seasonData: await this.buildSeasonDataStatus({
        prisma,
        regionId: region.id,
        regionCode: region.code.toUpperCase(),
        selectionMode: selectionRow.selection.mode,
        effectiveSeasonId: effective?.id ?? null,
        blizzardSeasonId: effectiveBlizzardId,
      }),
      seasons: options,
    };
  }

  async setScoringSeasonSelection(input: {
    body: UpdateScoringSeasonSelectionBody;
    actor: {
      userId: string | null;
      actorType: string;
      ip?: string | null;
      userAgent?: string | null;
    };
    regionCode?: string | null;
  }): Promise<ScoringSeasonSelectionStatusDTO> {
    const prisma = this.container.worker.prisma;
    const regionCode = (input.regionCode ?? "EU").trim().toUpperCase();

    if (input.body.mode === "PINNED") {
      const region = await prisma.region.findFirst({
        where: { code: { equals: regionCode, mode: "insensitive" } },
      });
      if (!region) {
        throw HttpError.badRequest("REGION_NOT_FOUND", `Region ${regionCode} not found`);
      }
      const season = await prisma.season.findFirst({
        where: { regionId: region.id, blizzardSeasonId: input.body.blizzardSeasonId },
      });
      if (!season) {
        throw HttpError.badRequest(
          "SCORING_SEASON_NOT_FOUND",
          `No Season row for Blizzard season ${input.body.blizzardSeasonId} in ${regionCode}`,
        );
      }
      await this.runSeasonDataSync({
        regionId: region.id,
        regionCode,
        blizzardSeasonId: input.body.blizzardSeasonId,
        selectionMode: "PINNED",
      });
      const readiness = await evaluateSeasonCatalogReadiness(prisma, await prisma.season.findUniqueOrThrow({ where: { id: season.id } }));
      if (!readiness.ready) {
        throw HttpError.badRequest(
          "SCORING_SEASON_NOT_PINNABLE",
          `Season ${input.body.blizzardSeasonId} is not pinnable: ${readiness.reasons.join(",")}`,
        );
      }
    }

    try {
      await updateScoringSeasonSelection(prisma, input.body, input.actor.userId);
    } catch (error) {
      if (error instanceof ScoringSeasonSelectionConflictError) {
        throw HttpError.conflict("SCORING_SEASON_SELECTION_VERSION_CONFLICT", error.message);
      }
      if (error instanceof ScoringSeasonNotPinnableError) {
        throw HttpError.badRequest("SCORING_SEASON_NOT_PINNABLE", error.message);
      }
      throw error;
    }

    await writeAuditEvent(prisma, {
      userId: input.actor.userId ?? undefined,
      actorType: input.actor.actorType as "user" | "admin_key" | "system" | "anonymous",
      action: "admin.misc.scoring_season_selection.update",
      resourceType: "runtime_setting",
      resourceId: "scoring_season_selection",
      ip: input.actor.ip,
      userAgent: input.actor.userAgent,
      sessionSecret: this.container.env.SESSION_SECRET,
      metadata: {
        mode: input.body.mode,
        blizzardSeasonId: input.body.mode === "PINNED" ? input.body.blizzardSeasonId : null,
        expectedVersion: input.body.expectedVersion,
        regionCode,
      },
    });

    if (input.body.mode === "AUTO") {
      const region = await prisma.region.findFirst({
        where: { code: { equals: regionCode, mode: "insensitive" } },
      });
      const current = region
        ? await prisma.season.findFirst({
            where: { regionId: region.id, isCurrent: true },
            orderBy: { updatedAt: "desc" },
          })
        : null;
      if (region && current?.blizzardSeasonId != null) {
        await this.runSeasonDataSync({
          regionId: region.id,
          regionCode,
          blizzardSeasonId: current.blizzardSeasonId,
          selectionMode: "AUTO",
        });
      }
    }

    return this.getScoringSeasonSelectionStatus({ regionCode });
  }

  async synchronizeSeasonData(input: { regionCode?: string | null }): Promise<{
    ok: true;
    sync: Awaited<ReturnType<typeof ensureSeasonDataReady>>;
    status: ScoringSeasonSelectionStatusDTO;
  }> {
    const prisma = this.container.worker.prisma;
    const regionCode = (input.regionCode ?? "EU").trim().toUpperCase();
    const region = await prisma.region.findFirst({
      where: { code: { equals: regionCode, mode: "insensitive" } },
    });
    if (!region) {
      throw HttpError.badRequest("REGION_NOT_FOUND", `Region ${regionCode} not found`);
    }
    const status = await this.getScoringSeasonSelectionStatus({ regionCode });
    const blizzardSeasonId = status.effectiveScoringSeason?.blizzardSeasonId;
    if (blizzardSeasonId == null) {
      throw HttpError.conflict(
        "EFFECTIVE_SCORING_SEASON_MISSING",
        "No effective scoring season is resolved to synchronize",
      );
    }
    const sync = await this.runSeasonDataSync({
      regionId: region.id,
      regionCode,
      blizzardSeasonId,
      selectionMode: status.selection.mode,
    });
    return {
      ok: true,
      sync,
      status: await this.getScoringSeasonSelectionStatus({ regionCode }),
    };
  }

  private async runSeasonDataSync(input: {
    regionId: string;
    regionCode: string;
    blizzardSeasonId: number;
    selectionMode: "AUTO" | "PINNED";
  }) {
    const logger = createLogger({
      level: this.container.env.LOG_LEVEL,
      name: "admin-misc.season-data-sync",
    });
    const discoverer =
      input.selectionMode === "AUTO"
        ? resolveScoringCatalogDiscoverer({
            warcraftlogs: this.container.worker.providers.warcraftlogs,
            providerMode: this.container.env.PROVIDER_MODE,
          })
        : undefined;
    return ensureSeasonDataReady({
      prisma: this.container.worker.prisma,
      logger,
      regionId: input.regionId,
      regionCode: input.regionCode,
      blizzardSeasonId: input.blizzardSeasonId,
      selectionMode: input.selectionMode,
      discoverActiveMplusCatalog: discoverer,
      requestDistributionRefresh: async ({ seasonId, regionCode }) => {
        await requestKeyDistributionRefreshJob({
          prisma: this.container.worker.prisma,
          seasonId,
          regionCode,
          enqueue: (job) => this.container.producers.enqueueKeyDistributionRefresh(job),
        });
      },
    });
  }

  private async buildSeasonDataStatus(input: {
    prisma: ApiContainer["worker"]["prisma"];
    regionId: string;
    regionCode: string;
    selectionMode: "AUTO" | "PINNED";
    effectiveSeasonId: string | null;
    blizzardSeasonId: number | null;
  }): Promise<ScoringSeasonSelectionStatusDTO["seasonData"]> {
    if (!input.effectiveSeasonId || input.blizzardSeasonId == null) {
      return {
        blizzardSeasonId: input.blizzardSeasonId,
        selectionMode: input.selectionMode,
        identityReady: false,
        catalogReady: false,
        dungeonCount: 0,
        expectedDungeonCount: null,
        wclZoneId: null,
        reasons: ["effective_season_missing"],
        lastCatalogSynchronizedAt: null,
        medianKeyDistribution: null,
      };
    }
    const season = await input.prisma.season.findUnique({ where: { id: input.effectiveSeasonId } });
    if (!season) {
      return {
        blizzardSeasonId: input.blizzardSeasonId,
        selectionMode: input.selectionMode,
        identityReady: false,
        catalogReady: false,
        dungeonCount: 0,
        expectedDungeonCount: null,
        wclZoneId: null,
        reasons: ["season_row_missing"],
        lastCatalogSynchronizedAt: null,
        medianKeyDistribution: null,
      };
    }
    const readiness = await evaluateSeasonCatalogReadiness(input.prisma, season);
    const meta = readActiveMplusCatalogMetadata(season.metadata);
    const snapshot = await input.prisma.seasonMedianKeyDistributionSnapshot.findFirst({
      where: { seasonId: season.id },
      orderBy: { collectedAt: "desc" },
    });
    const refresh = await input.prisma.scoreContextKeyDistributionRefresh.findFirst({
      where: { seasonId: season.id },
      orderBy: { createdAt: "desc" },
    });
    const distStatus = snapshot
      ? refresh?.status === "FAILED"
        ? "Failed"
        : refresh?.status === "RUNNING" || refresh?.status === "QUEUED"
          ? refresh.status === "QUEUED"
            ? "Queued"
            : "Refreshing"
          : "Ready"
      : refresh?.status === "FAILED"
        ? "Failed"
        : "Missing";
    return {
      blizzardSeasonId: season.blizzardSeasonId,
      selectionMode: input.selectionMode,
      identityReady: season.blizzardSeasonId != null,
      catalogReady: readiness.ready,
      dungeonCount: readiness.dungeonCount,
      expectedDungeonCount: readiness.expectedDungeonCount,
      wclZoneId: readiness.wclZoneId,
      reasons: readiness.reasons,
      lastCatalogSynchronizedAt: meta?.synchronizedAt ?? null,
      medianKeyDistribution: {
        status: distStatus,
        snapshotId: snapshot?.id ?? null,
        source: snapshot?.source ?? null,
        sourceVersion: snapshot?.sourceVersion ?? null,
        collectedAt: snapshot?.collectedAt.toISOString() ?? null,
      },
    };
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
