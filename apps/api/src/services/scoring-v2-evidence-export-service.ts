/**
 * Admin Scoring V2 evidence export API service.
 * Provider-free. Never accepts DATABASE_URL. Never enqueues refresh.
 */
import type {
  CreateEvidenceExportBody,
  ScoringV2EvidenceExportDTO,
  ScoringV2EvidenceExportListDTO,
  ScoringV2EvidenceExportProgressDTO,
  ScoringV2FrozenBundleDTO,
  ScoringV2HistoryItemDTO,
  ScoringV2HistoryListDTO,
  ScoringV2IssueDTO,
} from "@mplus/contracts";
import {
  CALIBRATION_INPUT_BUNDLE_V2_SCHEMA_VERSION,
  createEvidenceExportBodySchema as bodySchema,
  freezeEvidenceBundleBodySchema,
} from "@mplus/contracts";
import type { Prisma } from "@mplus/database";
import { OBS_EVENTS, emitScoringV2Event } from "@mplus/observability";
import { formatArtifactByteDigest } from "@mplus/scoring";
import type { ApiContainer } from "../container.js";
import { HttpError } from "../errors.js";
import { writeAuditEvent } from "../iam/audit.js";
import {
  assembleCalibrationInputBundleV2,
  toIssueDto,
} from "./scoring-v2-bundle-freeze.js";

type AuditCtx = {
  userId?: string | null;
  actorType: "user" | "admin_key" | "system" | "anonymous";
  ip?: string | null;
  userAgent?: string | null;
};

/** Row shape used to project unified history items (M1). */
export type HistoryExportRow = {
  id: string;
  cohortId: string;
  cohortRevision: number;
  status: ScoringV2HistoryItemDTO["status"];
  requestedByUserId: string;
  createdAt: Date;
  completedAt: Date | null;
  frozenAt: Date | null;
  blockerCount: number;
  warningCount: number;
  archiveContentHash: string | null;
  frozenBundleContentHash: string | null;
  cohort: { name: string };
};

/**
 * Build unified history projection: one evidence_export row + optional frozen_bundle.
 * Stable order: export createdAt desc, id desc; freeze follows its export.
 */
export function buildUnifiedHistoryItems(rows: HistoryExportRow[]): ScoringV2HistoryItemDTO[] {
  const items: ScoringV2HistoryItemDTO[] = [];
  for (const row of rows) {
    const base = {
      id: row.id,
      exportId: row.id,
      cohortId: row.cohortId,
      cohortName: row.cohort.name,
      cohortRevision: row.cohortRevision,
      status: row.status,
      initiatorUserId: row.requestedByUserId,
      createdAt: row.createdAt.toISOString(),
      completedAt: row.completedAt?.toISOString() ?? null,
      blockerCount: row.blockerCount,
      warningCount: row.warningCount,
      linkedCalibrationRunId: null as string | null,
    };
    items.push({
      ...base,
      kind: "evidence_export",
      rootHash: row.archiveContentHash,
      downloadAvailable: Boolean(row.archiveContentHash),
    });
    if (row.frozenBundleContentHash) {
      items.push({
        ...base,
        id: `${row.id}:bundle`,
        kind: "frozen_bundle",
        rootHash: row.frozenBundleContentHash,
        downloadAvailable: Boolean(row.archiveContentHash),
        createdAt: row.frozenAt?.toISOString() ?? row.createdAt.toISOString(),
      });
    }
  }
  return items;
}

/**
 * Paginate unified history items. `total` is the unified item count.
 * Page items are always ≤ pageSize.
 */
export function paginateUnifiedHistory(
  items: ScoringV2HistoryItemDTO[],
  page: number,
  pageSize: number,
  total: number,
): ScoringV2HistoryListDTO {
  const take = Math.min(Math.max(pageSize, 1), 50);
  const pageNum = Math.max(page, 1);
  const skip = (pageNum - 1) * take;
  return {
    items: items.slice(skip, skip + take),
    total,
    page: pageNum,
    pageSize: take,
  };
}

const EMPTY_PROGRESS: ScoringV2EvidenceExportProgressDTO = {
  membersTotal: 0,
  membersScanned: 0,
  identitiesFound: 0,
  identitiesMissing: 0,
  bootstrapComplete: 0,
  bootstrapIncomplete: 0,
  manifestsPresent: 0,
  fourDimensionComplete: 0,
  compatibleSnapshots: 0,
  incompatibleSnapshots: 0,
};

function asProgress(value: unknown): ScoringV2EvidenceExportProgressDTO {
  if (!value || typeof value !== "object") return EMPTY_PROGRESS;
  return { ...EMPTY_PROGRESS, ...(value as Partial<ScoringV2EvidenceExportProgressDTO>) };
}

function asIssues(summary: unknown): ScoringV2IssueDTO[] {
  if (!summary || typeof summary !== "object") return [];
  const issues = (summary as { issues?: unknown }).issues;
  return Array.isArray(issues) ? (issues as ScoringV2IssueDTO[]) : [];
}

function mapExport(
  row: {
    id: string;
    cohortId: string;
    cohortRevision: number;
    seasonId: string | null;
    scoreModelId: string | null;
    status: ScoringV2EvidenceExportDTO["status"];
    progress: unknown;
    summary: unknown;
    blockerCount: number;
    warningCount: number;
    archiveContentHash: string | null;
    archiveByteLength: number | null;
    summaryContentHash: string | null;
    preflightContentHash: string | null;
    markdownContentHash: string | null;
    frozenBundleContentHash: string | null;
    frozenBundleByteDigest: string | null;
    frozenBundleByteLength: number | null;
    frozenAt: Date | null;
    errorCode: string | null;
    errorMessage: string | null;
    requestedByUserId: string;
    createdAt: Date;
    startedAt: Date | null;
    completedAt: Date | null;
    cohort?: { name: string } | null;
  },
  freezeExtras?: { freezeEligible?: boolean; freezeBlockers?: ScoringV2IssueDTO[] },
): ScoringV2EvidenceExportDTO {
  const issues = asIssues(row.summary);
  const summaryFreezeBlockers = Array.isArray(
    (row.summary as { freezeBlockers?: unknown } | null)?.freezeBlockers,
  )
    ? ((row.summary as { freezeBlockers: ScoringV2IssueDTO[] }).freezeBlockers)
    : [];
  const freezeBlockers =
    freezeExtras?.freezeBlockers ??
    (row.frozenBundleContentHash
      ? []
      : summaryFreezeBlockers.length > 0
        ? summaryFreezeBlockers
        : issues.filter((i) => i.severity === "blocker"));
  const freezeEligible =
    freezeExtras?.freezeEligible ??
    (Boolean(row.frozenBundleContentHash) ||
      (row.status === "COMPLETED" &&
        row.blockerCount === 0 &&
        freezeBlockers.length === 0 &&
        Boolean((row.summary as { freezeEligible?: boolean } | null)?.freezeEligible)));
  return {
    id: row.id,
    cohortId: row.cohortId,
    cohortName: row.cohort?.name ?? null,
    cohortRevision: row.cohortRevision,
    seasonId: row.seasonId,
    scoreModelId: row.scoreModelId,
    status: row.status,
    progress: asProgress(row.progress),
    summary: (row.summary as Record<string, unknown>) ?? {},
    issues,
    blockerCount: row.blockerCount,
    warningCount: row.warningCount,
    archiveContentHash: row.archiveContentHash,
    archiveByteLength: row.archiveByteLength,
    summaryContentHash: row.summaryContentHash,
    preflightContentHash: row.preflightContentHash,
    markdownContentHash: row.markdownContentHash,
    frozenBundleContentHash: row.frozenBundleContentHash,
    frozenBundleByteDigest: row.frozenBundleByteDigest,
    frozenBundleByteLength: row.frozenBundleByteLength,
    frozenAt: row.frozenAt?.toISOString() ?? null,
    freezeEligible,
    freezeBlockers,
    errorCode: row.errorCode,
    errorMessage: row.errorMessage,
    requestedByUserId: row.requestedByUserId,
    createdAt: row.createdAt.toISOString(),
    startedAt: row.startedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
  };
}

export class ScoringV2EvidenceExportService {
  constructor(private readonly container: ApiContainer) {}

  async createExport(
    body: unknown,
    requestedByUserId: string,
    ctx: AuditCtx,
  ): Promise<ScoringV2EvidenceExportDTO> {
    const parsed = bodySchema.parse(body) as CreateEvidenceExportBody;
    const cohort = await this.container.worker.prisma.calibrationCohort.findUnique({
      where: { id: parsed.cohortId },
      select: { id: true, name: true, revision: true, seasonId: true, status: true },
    });
    if (!cohort) throw HttpError.notFound("COHORT_NOT_FOUND", "Calibration cohort not found");

    const cohortRevision = parsed.cohortRevision ?? cohort.revision;
    if (parsed.cohortRevision != null && parsed.cohortRevision !== cohort.revision) {
      throw HttpError.conflict(
        "COHORT_REVISION_MISMATCH",
        `Requested revision ${parsed.cohortRevision} does not match current immutable revision ${cohort.revision}`,
      );
    }

    const seasonId = parsed.seasonId ?? cohort.seasonId;
    // Pin identity clocks before enqueue so worker retries stay byte-identical (B3).
    const pinnedAt = new Date();
    const row = await this.container.worker.prisma.scoringV2EvidenceExport.create({
      data: {
        cohortId: cohort.id,
        cohortRevision,
        seasonId,
        status: "QUEUED",
        requestedByUserId,
        progress: EMPTY_PROGRESS as unknown as Prisma.InputJsonValue,
        summary: {},
        generatedAt: pinnedAt,
        evidenceCutoffAt: pinnedAt,
        freezeSnapshot: {},
      },
      include: { cohort: { select: { name: true } } },
    });

    const enqueue = await this.container.producers.enqueueScoringV2EvidenceExport({
      exportId: row.id,
      correlationId: null,
    });

    await this.container.worker.prisma.scoringV2EvidenceExport.update({
      where: { id: row.id },
      data: { bullmqJobId: enqueue.jobId },
    });

    emitScoringV2Event(this.container.logger, OBS_EVENTS.scoringV2AdminEvidenceExportRequested, {
      exportId: row.id,
      cohortId: cohort.id,
      cohortRevision,
    });

    await writeAuditEvent(this.container.worker.prisma, {
      userId: ctx.userId ?? requestedByUserId,
      actorType: ctx.actorType,
      action: "admin.scoring_v2.evidence_export.create",
      resourceType: "ScoringV2EvidenceExport",
      resourceId: row.id,
      outcome: "SUCCESS",
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      sessionSecret: this.container.env.SESSION_SECRET,
      metadata: { cohortId: cohort.id, cohortRevision },
    });

    return mapExport(row);
  }

  async listExports(page = 1, pageSize = 20): Promise<ScoringV2EvidenceExportListDTO> {
    const take = Math.min(Math.max(pageSize, 1), 50);
    const skip = (Math.max(page, 1) - 1) * take;
    const [total, rows] = await Promise.all([
      this.container.worker.prisma.scoringV2EvidenceExport.count(),
      this.container.worker.prisma.scoringV2EvidenceExport.findMany({
        orderBy: { createdAt: "desc" },
        skip,
        take,
        include: { cohort: { select: { name: true } } },
      }),
    ]);
    return {
      total,
      page: Math.max(page, 1),
      pageSize: take,
      items: rows.map((row) => ({
        id: row.id,
        cohortId: row.cohortId,
        cohortName: row.cohort.name,
        cohortRevision: row.cohortRevision,
        seasonId: row.seasonId,
        status: row.status,
        blockerCount: row.blockerCount,
        warningCount: row.warningCount,
        archiveContentHash: row.archiveContentHash,
        frozenBundleContentHash: row.frozenBundleContentHash,
        frozenAt: row.frozenAt?.toISOString() ?? null,
        requestedByUserId: row.requestedByUserId,
        createdAt: row.createdAt.toISOString(),
        startedAt: row.startedAt?.toISOString() ?? null,
        completedAt: row.completedAt?.toISOString() ?? null,
      })),
    };
  }

  async getExport(exportId: string): Promise<ScoringV2EvidenceExportDTO> {
    const row = await this.container.worker.prisma.scoringV2EvidenceExport.findUnique({
      where: { id: exportId },
      include: { cohort: { select: { name: true } } },
    });
    if (!row) throw HttpError.notFound("EXPORT_NOT_FOUND", "Evidence export not found");

    if (row.status === "COMPLETED" && !row.frozenBundleContentHash) {
      const assembled = await assembleCalibrationInputBundleV2({
        prisma: this.container.worker.prisma,
        artifacts: this.container.worker.repositories.artifacts,
        exportId: row.id,
        dryRun: true,
      });
      const freezeBlockers = toIssueDto([
        ...assembled.blockers.filter((b) => b.severity === "blocker"),
      ]);
      return mapExport(row, {
        freezeEligible: assembled.ok && freezeBlockers.length === 0,
        freezeBlockers,
      });
    }

    return mapExport(row);
  }

  async downloadArchive(exportId: string): Promise<{ bytes: Buffer; contentHash: string; filename: string }> {
    const row = await this.container.worker.prisma.scoringV2EvidenceExport.findUnique({
      where: { id: exportId },
    });
    if (!row?.archiveContentHash || !row.archiveStorageUri) {
      throw HttpError.notFound("ARCHIVE_NOT_READY", "Export archive is not available");
    }
    const artifact = await this.container.worker.prisma.rawArtifact.findUnique({
      where: { contentHash: row.archiveContentHash },
    });
    if (!artifact) throw HttpError.notFound("ARCHIVE_MISSING", "Archive artifact missing");
    const bytes = await this.container.worker.repositories.artifacts.readVerified(artifact.id);
    return {
      bytes,
      contentHash: row.archiveContentHash,
      filename: `evidence-export-${exportId}.zip`,
    };
  }

  async freezeBundle(
    exportId: string,
    body: unknown,
    ctx: AuditCtx,
  ): Promise<{ export: ScoringV2EvidenceExportDTO; bundle: ScoringV2FrozenBundleDTO }> {
    const parsed = freezeEvidenceBundleBodySchema.parse(body);
    const row = await this.container.worker.prisma.scoringV2EvidenceExport.findUnique({
      where: { id: exportId },
      include: {
        cohort: { include: { members: true, season: true } },
      },
    });
    if (!row) throw HttpError.notFound("EXPORT_NOT_FOUND", "Evidence export not found");
    if (row.status !== "COMPLETED") {
      throw HttpError.conflict("EXPORT_NOT_COMPLETED", "Export must complete before freeze");
    }
    if (row.frozenBundleContentHash && row.frozenBundleStorageUri) {
      return {
        export: mapExport(row, { freezeEligible: true, freezeBlockers: [] }),
        bundle: {
          exportId: row.id,
          schemaVersion: CALIBRATION_INPUT_BUNDLE_V2_SCHEMA_VERSION,
          rootHash: row.frozenBundleContentHash,
          frozenBundleContentHash: row.frozenBundleContentHash,
          frozenBundleByteDigest: row.frozenBundleByteDigest ?? "",
          memberCount: row.cohort.members.length,
          excludedCount: row.cohort.members.filter((m) => !m.included || m.exclusionCode).length,
          byteLength: row.frozenBundleByteLength ?? 0,
          createdAt:
            row.frozenAt?.toISOString() ??
            row.completedAt?.toISOString() ??
            row.createdAt.toISOString(),
          deduplicated: true,
        },
      };
    }

    const assembled = await assembleCalibrationInputBundleV2({
      prisma: this.container.worker.prisma,
      artifacts: this.container.worker.repositories.artifacts,
      exportId: row.id,
      evaluationModelId: parsed.evaluationModelId ?? null,
      dryRun: false,
    });
    if (!assembled.ok || !assembled.bundle) {
      throw HttpError.conflict(
        "FREEZE_BLOCKED",
        "Export is not eligible for Calibration Input Bundle V2 freeze",
        {
          blockers: toIssueDto(assembled.blockers),
          warnings: toIssueDto(assembled.warnings),
        },
      );
    }

    const rootHash = assembled.bundle.bundleHash;
    const existingByHash = await this.container.worker.prisma.scoringV2EvidenceExport.findFirst({
      where: {
        frozenBundleContentHash: rootHash,
        id: { not: row.id },
      },
      select: {
        frozenBundleStorageUri: true,
        frozenBundleByteLength: true,
        frozenBundleByteDigest: true,
      },
    });

    const bytes = Buffer.from(JSON.stringify(assembled.bundle), "utf8");
    const persisted = await this.container.worker.repositories.artifacts.persist({
      provider: "INTERNAL",
      bytes,
      compression: "NONE",
      artifactClass: "calibration_frozen_export",
      owner: { ownerType: "CalibrationFrozenExport", ownerId: row.id },
    });

    const byteDigest =
      existingByHash?.frozenBundleByteDigest ??
      formatArtifactByteDigest(persisted.write.contentHash);

    const updated = await this.container.worker.prisma.scoringV2EvidenceExport.update({
      where: { id: row.id },
      data: {
        frozenBundleContentHash: rootHash,
        frozenBundleByteDigest: byteDigest,
        frozenBundleByteLength:
          existingByHash?.frozenBundleByteLength ?? persisted.write.uncompressedSizeBytes,
        frozenBundleStorageUri:
          existingByHash?.frozenBundleStorageUri ?? persisted.write.storageUri,
        frozenAt: new Date(),
        summary: {
          ...((row.summary as Record<string, unknown>) ?? {}),
          freezeEligible: true,
          freezeBlockers: [],
          freeze: {
            schemaVersion: assembled.bundle.schemaVersion,
            bundleHash: rootHash,
            byteDigest,
            memberCount: assembled.bundle.members.length,
            includedCount: assembled.bundle.members.filter((m) => m.included).length,
            excludedCount: assembled.bundle.members.filter((m) => !m.included).length,
            warnings: toIssueDto(assembled.warnings),
          },
        },
      },
      include: { cohort: { select: { name: true } } },
    });

    emitScoringV2Event(this.container.logger, OBS_EVENTS.scoringV2AdminBundleFrozen, {
      exportId: row.id,
      contentHash: rootHash,
      byteLength: persisted.write.uncompressedSizeBytes,
    });

    await writeAuditEvent(this.container.worker.prisma, {
      userId: ctx.userId ?? null,
      actorType: ctx.actorType,
      action: "admin.scoring_v2.bundle.freeze",
      resourceType: "ScoringV2EvidenceExport",
      resourceId: row.id,
      outcome: "SUCCESS",
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      sessionSecret: this.container.env.SESSION_SECRET,
      metadata: {
        contentHash: rootHash,
        byteDigest,
        schemaVersion: assembled.bundle.schemaVersion,
        deduplicated: persisted.write.deduplicated || Boolean(existingByHash),
      },
    });

    return {
      export: mapExport(updated, { freezeEligible: true, freezeBlockers: [] }),
      bundle: {
        exportId: row.id,
        schemaVersion: CALIBRATION_INPUT_BUNDLE_V2_SCHEMA_VERSION,
        rootHash,
        frozenBundleContentHash: rootHash,
        frozenBundleByteDigest: byteDigest,
        memberCount: assembled.bundle.members.length,
        excludedCount: assembled.bundle.members.filter((m) => !m.included).length,
        byteLength: persisted.write.uncompressedSizeBytes,
        createdAt: updated.frozenAt?.toISOString() ?? new Date().toISOString(),
        deduplicated: persisted.write.deduplicated || Boolean(existingByHash),
      },
    };
  }

  async listHistory(page = 1, pageSize = 20): Promise<ScoringV2HistoryListDTO> {
    const take = Math.min(Math.max(pageSize, 1), 50);
    const pageNum = Math.max(page, 1);
    const skip = (pageNum - 1) * take;

    // Unified total = exports + frozen bundles (each freeze adds one history item).
    const [exportTotal, frozenTotal] = await Promise.all([
      this.container.worker.prisma.scoringV2EvidenceExport.count(),
      this.container.worker.prisma.scoringV2EvidenceExport.count({
        where: { frozenBundleContentHash: { not: null } },
      }),
    ]);
    const total = exportTotal + frozenTotal;

    // Fetch enough export rows to cover the unified page (1–2 items per export).
    const rows = await this.container.worker.prisma.scoringV2EvidenceExport.findMany({
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: skip + take,
      include: { cohort: { select: { name: true } } },
    });

    const unified = buildUnifiedHistoryItems(rows);
    return paginateUnifiedHistory(unified, pageNum, take, total);
  }
}
