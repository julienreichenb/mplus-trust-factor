/**
 * DB/config-only Scoring V2 control-center overview. No providers, no enqueue.
 */
import { getScoringV2FlagSummary, type AppEnv } from "@mplus/config";
import type {
  ScoringV2FlagOverviewDTO,
  ScoringV2ModeLabel,
  ScoringV2OverviewDTO,
  ScoringV2IssueDTO,
} from "@mplus/contracts";
import type { PrismaClient } from "@mplus/database";
import {
  getConcurrencySettings,
  type GetConcurrencySettingsOptions,
} from "./scoring-v2-runtime-settings.js";

function deriveModeLabel(flags: ReturnType<typeof getScoringV2FlagSummary>): ScoringV2ModeLabel {
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

function toFlagOverview(env: AppEnv): ScoringV2FlagOverviewDTO {
  const flags = getScoringV2FlagSummary(env);
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

export async function buildScoringV2Overview(
  prisma: PrismaClient,
  env: AppEnv,
  concurrencyOptions: Pick<
    GetConcurrencySettingsOptions,
    "redis" | "appEnv" | "nowMs"
  > = {},
): Promise<ScoringV2OverviewDTO> {
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
        },
      }),
      prisma.calibrationCohort.groupBy({
        by: ["status"],
        _count: { _all: true },
      }),
      prisma.scoringV2EvidenceExport.findFirst({
        orderBy: { createdAt: "desc" },
        include: { cohort: { select: { name: true } } },
      }),
      prisma.scoringV2EvidenceExport.findFirst({
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

  const blockers: ScoringV2IssueDTO[] = [];
  const warnings: ScoringV2IssueDTO[] = [];
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
      code: "SCORING_V2_DISABLED",
      severity: "info",
      message: "Scoring V2 master flag is disabled — control center is observational only",
    });
  }

  const readyCohorts = cohortGroups.find((g) => g.status === "READY")?._count._all ?? 0;
  const draftCohorts = cohortGroups.find((g) => g.status === "DRAFT")?._count._all ?? 0;
  const archivedCohorts = cohortGroups.find((g) => g.status === "ARCHIVED")?._count._all ?? 0;

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
    currentSeason: currentSeason
      ? {
          id: currentSeason.id,
          slug: currentSeason.slug,
          name: currentSeason.name,
          isCurrent: currentSeason.isCurrent,
          blizzardSeasonId: currentSeason.blizzardSeasonId,
        }
      : null,
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
