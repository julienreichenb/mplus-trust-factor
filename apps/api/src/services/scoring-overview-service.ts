/**
 * DB/config-only Scoring V2 control-center overview. No providers, no enqueue.
 */
import { getScoringFlagSummary, type AppEnv } from "@mplus/config";
import type {
  ScoringFlagOverviewDTO,
  ScoringModeLabel,
  ScoringOverviewDTO,
  ScoringIssueDTO,
} from "@mplus/contracts";
import type { PrismaClient } from "@mplus/database";
import {
  getConcurrencySettings,
  type GetConcurrencySettingsOptions,
} from "./scoring-runtime-settings.js";
import {
  getScoringSeasonSelection,
  evaluateSeasonCatalogReadiness,
  readActiveMplusCatalogMetadata,
} from "@mplus/worker";

function deriveModeLabel(flags: ReturnType<typeof getScoringFlagSummary>): ScoringModeLabel {
  if (!flags.enabled) return "Disabled";
  if (flags.publicationEnabled) return "Active";
  if (
    flags.relativeDamageMode === "shadow" ||
    flags.utilityOpportunityMode === "shadow" ||
    flags.referenceComparisonMode === "shadow" ||
    flags.referenceComparisonMode === "collect"
  ) {
    return "Shadow";
  }
  return "Candidate";
}

function toFlagOverview(env: AppEnv): ScoringFlagOverviewDTO {
  const flags = getScoringFlagSummary(env);
  return {
    masterEnabled: flags.enabled,
    selectionEnabled: flags.selectionEnabled,
    evidenceFetchEnabled: flags.evidenceFetchEnabled,
    dimensionsEnabled: flags.dimensionsEnabled,
    publicationEnabled: flags.publicationEnabled,
    calibrationV2Enabled: flags.calibrationV2Enabled,
    adminCalibrationEnabled: env.ADMIN_CALIBRATION_ENABLED,
    performanceEnabled: flags.performanceEnabled,
    survivalEnabled: flags.survivalEnabled,
    utilityEnabled: flags.utilityEnabled,
    experienceEnabled: flags.experienceEnabled,
    relativeDamageMode: flags.relativeDamageMode,
    utilityOpportunityMode: flags.utilityOpportunityMode,
    referenceComparisonMode: flags.referenceComparisonMode,
    modeLabel: deriveModeLabel(flags),
    incompatibleReasons: flags.incompatibleReasons,
  };
}

export async function buildScoringOverview(
  prisma: PrismaClient,
  env: AppEnv,
  concurrencyOptions: Pick<
    GetConcurrencySettingsOptions,
    "redis" | "appEnv" | "nowMs"
  > = {},
): Promise<ScoringOverviewDTO> {
  const flags = toFlagOverview(env);
  const [activeModel, currentSeason, cohortGroups, recentExport, recentFrozen, queueGroups] =
    await Promise.all([
      prisma.scoreModel.findFirst({
        where: { status: "ACTIVE" },
        select: { id: true, key: true, version: true, name: true, status: true },
      }),
      prisma.season.findFirst({
        where: { isCurrent: true },
        orderBy: { updatedAt: "desc" },
        select: {
          id: true,
          slug: true,
          name: true,
          isCurrent: true,
          blizzardSeasonId: true,
          metadata: true,
          dungeonCount: true,
          startsAt: true,
          endsAt: true,
          regionId: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      prisma.calibrationCohort.groupBy({
        by: ["status"],
        _count: { _all: true },
      }),
      prisma.scoringEvidenceExport.findFirst({
        orderBy: { createdAt: "desc" },
        include: { cohort: { select: { name: true } } },
      }),
      prisma.scoringEvidenceExport.findFirst({
        where: { frozenBundleContentHash: { not: null } },
        orderBy: { frozenAt: "desc" },
      }),
      prisma.ingestionJob.groupBy({
        by: ["workloadClass", "status"],
        where: {
          jobType: { in: ["refresh-character", "refresh-character-calibration"] },
          status: { in: ["QUEUED", "ACTIVE"] },
        },
        _count: { _all: true },
      }),
    ]);

  const queueMap = new Map<string, { queued: number; active: number }>();
  for (const row of queueGroups) {
    const key = row.workloadClass;
    const entry = queueMap.get(key) ?? { queued: 0, active: 0 };
    if (row.status === "QUEUED") entry.queued += row._count._all;
    if (row.status === "ACTIVE") entry.active += row._count._all;
    queueMap.set(key, entry);
  }

  const cal = queueMap.get("CALIBRATION") ?? { queued: 0, active: 0 };
  const op = queueMap.get("OPERATION") ?? { queued: 0, active: 0 };

  const concurrency = await getConcurrencySettings(prisma, {
    calibrationActive: cal.active,
    calibrationQueued: cal.queued,
    operationActive: op.active,
    operationQueued: op.queued,
    redis: concurrencyOptions.redis,
    appEnv: concurrencyOptions.appEnv ?? env.APP_ENV,
    nowMs: concurrencyOptions.nowMs,
  });

  const blockers: ScoringIssueDTO[] = [];
  const warnings: ScoringIssueDTO[] = [];
  for (const reason of flags.incompatibleReasons) {
    blockers.push({ code: "FLAG_INCOMPATIBLE", severity: "blocker", message: reason });
  }
  if (!activeModel) {
    warnings.push({
      code: "ACTIVE_MODEL_MISSING",
      severity: "warning",
      message: "No ACTIVE score model",
    });
  }
  if (!currentSeason) {
    warnings.push({
      code: "CURRENT_SEASON_MISSING",
      severity: "warning",
      message: "No current season",
    });
  }
  if (flags.modeLabel === "Disabled") {
    warnings.push({
      code: "scoring_DISABLED",
      severity: "info",
      message: "Scoring V2 master flag is disabled — control center is observational only",
    });
  }

  const readyCohorts = cohortGroups.find((g) => g.status === "READY")?._count._all ?? 0;
  const draftCohorts = cohortGroups.find((g) => g.status === "DRAFT")?._count._all ?? 0;
  const archivedCohorts = cohortGroups.find((g) => g.status === "ARCHIVED")?._count._all ?? 0;

  const selectionRow = await getScoringSeasonSelection(prisma);
  let effectiveSeason = currentSeason;
  if (selectionRow.selection.mode === "PINNED") {
    const pinned = await prisma.season.findFirst({
      where: { blizzardSeasonId: selectionRow.selection.blizzardSeasonId },
      orderBy: [{ isCurrent: "desc" }, { updatedAt: "desc" }],
    });
    if (pinned) effectiveSeason = pinned;
  }

  const detectedMeta = currentSeason
    ? readActiveMplusCatalogMetadata(currentSeason.metadata)
    : null;
  const effectiveMeta = effectiveSeason
    ? readActiveMplusCatalogMetadata(effectiveSeason.metadata)
    : null;
  const effectiveReady = effectiveSeason
    ? (await evaluateSeasonCatalogReadiness(prisma, effectiveSeason)).ready
    : false;

  const toSeasonSummary = (
    season: typeof currentSeason,
    meta: ReturnType<typeof readActiveMplusCatalogMetadata>,
    catalogReady?: boolean,
  ) =>
    season
      ? {
          id: season.id,
          slug: season.slug,
          name: season.name,
          isCurrent: season.isCurrent,
          blizzardSeasonId: season.blizzardSeasonId,
          wclZoneId: meta?.wclZoneId ?? null,
          catalogReady,
        }
      : null;

  return {
    flags,
    activeModel: activeModel
      ? {
          id: activeModel.id,
          key: activeModel.key,
          version: activeModel.version,
          name: activeModel.name,
          status: activeModel.status,
        }
      : null,
    currentSeason: toSeasonSummary(currentSeason, detectedMeta),
    detectedCurrentSeason: toSeasonSummary(currentSeason, detectedMeta),
    effectiveScoringSeason: toSeasonSummary(effectiveSeason, effectiveMeta, effectiveReady),
    scoringSeasonSelection: {
      mode: selectionRow.selection.mode,
      pinnedBlizzardSeasonId:
        selectionRow.selection.mode === "PINNED"
          ? selectionRow.selection.blizzardSeasonId
          : null,
    },
    queueCounts: [
      { workloadClass: "CALIBRATION", queued: cal.queued, active: cal.active },
      { workloadClass: "OPERATION", queued: op.queued, active: op.active },
    ],
    recentEvidenceExport: recentExport
      ? {
          id: recentExport.id,
          cohortId: recentExport.cohortId,
          cohortName: recentExport.cohort.name,
          cohortRevision: recentExport.cohortRevision,
          seasonId: recentExport.seasonId,
          status: recentExport.status,
          blockerCount: recentExport.blockerCount,
          warningCount: recentExport.warningCount,
          archiveContentHash: recentExport.archiveContentHash,
          frozenBundleContentHash: recentExport.frozenBundleContentHash,
          frozenAt: recentExport.frozenAt?.toISOString() ?? null,
          requestedByUserId: recentExport.requestedByUserId,
          createdAt: recentExport.createdAt.toISOString(),
          startedAt: recentExport.startedAt?.toISOString() ?? null,
          completedAt: recentExport.completedAt?.toISOString() ?? null,
        }
      : null,
    recentFrozenBundle:
      recentFrozen?.frozenBundleContentHash && recentFrozen.frozenAt
        ? {
            exportId: recentFrozen.id,
            contentHash: recentFrozen.frozenBundleContentHash,
            byteLength: recentFrozen.frozenBundleByteLength,
            frozenAt: recentFrozen.frozenAt.toISOString(),
            cohortId: recentFrozen.cohortId,
            cohortRevision: recentFrozen.cohortRevision,
          }
        : null,
    cohortReadiness: { readyCohorts, draftCohorts, archivedCohorts },
    concurrency,
    blockers,
    warnings,
    applicationRevision:
      process.env.APP_REVISION?.trim() ||
      process.env.GIT_SHA?.trim() ||
      process.env.IMAGE_REVISION?.trim() ||
      null,
    generatedAt: new Date().toISOString(),
  };
}
