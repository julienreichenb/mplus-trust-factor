/**
 * Provider-free Scoring V2 evidence export worker job.
 * Writes only the export row + content-addressed artifacts. Never enqueues refresh.
 *
 * B3: idempotent COMPLETED short-circuit; pinned generatedAt/evidenceCutoffAt;
 * atomic lease claim; optimistic terminal finalize; archive bounds (M4 lite).
 * H3: persist immutable freezeSnapshot at COMPLETED (export-time model/members/policies).
 */
import { randomUUID } from "node:crypto";
import { CURRENT_CATALOG_VERSION_ID } from "@mplus/abilities";
import {
  scoringV2EvidenceExportJobSchema,
  type ScoringV2EvidenceExportJob,
} from "@mplus/contracts";
import { OBS_EVENTS, emitScoringV2Event, type Logger } from "@mplus/observability";
import type { PrismaClient, Prisma } from "@mplus/database";
import type { ArtifactRepository } from "@mplus/database";
import { MINIMAL_SEED_CATALOG } from "@mplus/mechanics";
import {
  buildDefaultFreezePolicies,
  buildFreezeSnapshot,
  createDefaultModelV6,
  resolveFrozenDimensionConfigsForModel,
  type FreezeSnapshotMemberV1,
  type FreezeSnapshotModelV1,
  type ScoreModelConfigV1,
} from "@mplus/scoring";
import {
  buildEvidenceJoinMarkdown,
  runEvidenceJoin,
} from "./scoring-v2/evidence-join.js";
import { buildStoreZip } from "./scoring-v2/zip-store.js";

/** M4 lite: hard caps before buffering unbounded archives. */
export const EVIDENCE_EXPORT_MAX_MEMBERS = 500;
export const EVIDENCE_EXPORT_MAX_ARCHIVE_BYTES = 50 * 1024 * 1024;
/** M3: lease TTL for RUNNING claim (sweeper / reclaim uses expiry). */
export const EVIDENCE_EXPORT_LEASE_TTL_MS = 5 * 60 * 1000;
/** Error code written when a stale RUNNING lease is reclaimed. */
export const EVIDENCE_EXPORT_STALE_LEASE_CODE = "STALE_LEASE";

export interface ScoringV2EvidenceExportProcessorDeps {
  prisma: PrismaClient;
  logger: Logger;
  artifacts: ArtifactRepository;
  scoreTtlSeconds?: number;
  /** Injectable clock for tests. */
  now?: () => Date;
  /** Injectable lease owner id for tests. */
  leaseOwnerFactory?: () => string;
}

function clearLeaseFields() {
  return {
    leaseOwner: null,
    leaseExpiresAt: null,
    heartbeatAt: null,
  };
}

/**
 * M3 — Mark abandoned RUNNING exports with expired (or missing) leases as RETRYABLE.
 * Idempotent: only touches RUNNING rows whose lease has elapsed.
 * Called at the start of each export job so a crashed worker does not leave stuck rows.
 */
export async function reclaimStaleEvidenceExports(
  prisma: Pick<PrismaClient, "scoringV2EvidenceExport">,
  now: Date = new Date(),
): Promise<{ reclaimed: number }> {
  const result = await prisma.scoringV2EvidenceExport.updateMany({
    where: {
      status: "RUNNING",
      OR: [{ leaseExpiresAt: { lt: now } }, { leaseExpiresAt: null }],
    },
    data: {
      status: "RETRYABLE",
      errorCode: EVIDENCE_EXPORT_STALE_LEASE_CODE,
      errorMessage: "Evidence export lease expired; marked retryable for reclaim",
      ...clearLeaseFields(),
    },
  });
  return { reclaimed: result.count };
}

export async function runScoringV2EvidenceExportJob(
  deps: ScoringV2EvidenceExportProcessorDeps,
  rawPayload: ScoringV2EvidenceExportJob,
): Promise<{ exportId: string; status: string }> {
  const payload = scoringV2EvidenceExportJobSchema.parse(rawPayload);
  const { prisma, logger, artifacts } = deps;
  const scoreTtlSeconds = deps.scoreTtlSeconds ?? 604800;
  const nowFn = deps.now ?? (() => new Date());
  const leaseOwnerFactory = deps.leaseOwnerFactory ?? (() => randomUUID());

  const exportRow = await prisma.scoringV2EvidenceExport.findUnique({
    where: { id: payload.exportId },
    include: {
      cohort: {
        include: {
          members: true,
        },
      },
    },
  });
  if (!exportRow) {
    throw new Error(`Evidence export not found: ${payload.exportId}`);
  }

  // Idempotent short-circuit: duplicate delivery after success must not rejoin.
  if (exportRow.status === "COMPLETED" && exportRow.archiveContentHash) {
    emitScoringV2Event(logger, OBS_EVENTS.scoringV2AdminEvidenceExportCompleted, {
      exportId: exportRow.id,
      cohortId: exportRow.cohortId,
      blockerCount: exportRow.blockerCount,
      warningCount: exportRow.warningCount,
      archiveContentHash: exportRow.archiveContentHash,
      deduplicated: true,
    });
    return { exportId: exportRow.id, status: "COMPLETED" };
  }

  const claimNow = nowFn();
  // M3: reclaim abandoned RUNNING leases before claiming this job.
  await reclaimStaleEvidenceExports(prisma, claimNow);

  emitScoringV2Event(logger, OBS_EVENTS.scoringV2AdminEvidenceExportStarted, {
    exportId: exportRow.id,
    cohortId: exportRow.cohortId,
    cohortRevision: exportRow.cohortRevision,
  });

  const leaseOwner = leaseOwnerFactory();
  const leaseExpiresAt = new Date(claimNow.getTime() + EVIDENCE_EXPORT_LEASE_TTL_MS);

  const claimData: Prisma.ScoringV2EvidenceExportUpdateManyMutationInput = {
    status: "RUNNING",
    attempt: { increment: 1 },
    leaseOwner,
    leaseExpiresAt,
    heartbeatAt: claimNow,
    startedAt: exportRow.startedAt ?? claimNow,
    errorCode: null,
    errorMessage: null,
    // Pin identity timestamps on first claim when API create did not set them.
    generatedAt: exportRow.generatedAt ?? claimNow,
    evidenceCutoffAt: exportRow.evidenceCutoffAt ?? exportRow.generatedAt ?? claimNow,
  };
  if (exportRow.freezeSnapshot == null) {
    claimData.freezeSnapshot = {};
  }

  const claimed = await prisma.scoringV2EvidenceExport.updateMany({
    where: {
      id: exportRow.id,
      OR: [
        { status: { in: ["QUEUED", "RETRYABLE"] } },
        { status: "RUNNING", leaseExpiresAt: { lt: claimNow } },
        { status: "RUNNING", leaseExpiresAt: null },
      ],
    },
    data: claimData,
  });

  if (claimed.count === 0) {
    const current = await prisma.scoringV2EvidenceExport.findUnique({
      where: { id: exportRow.id },
      select: {
        status: true,
        archiveContentHash: true,
        blockerCount: true,
        warningCount: true,
        cohortId: true,
        leaseOwner: true,
        leaseExpiresAt: true,
      },
    });
    if (current?.status === "COMPLETED" && current.archiveContentHash) {
      return { exportId: exportRow.id, status: "COMPLETED" };
    }
    if (current?.status === "FAILED" || current?.status === "CANCELLED") {
      return { exportId: exportRow.id, status: current.status };
    }
    // Another worker holds a valid lease — exit without writing divergent archives.
    return { exportId: exportRow.id, status: current?.status ?? "RUNNING" };
  }

  const claimedRow = await prisma.scoringV2EvidenceExport.findUnique({
    where: { id: exportRow.id },
    select: {
      attempt: true,
      generatedAt: true,
      evidenceCutoffAt: true,
      leaseOwner: true,
    },
  });
  if (!claimedRow || claimedRow.leaseOwner !== leaseOwner) {
    return { exportId: exportRow.id, status: "RUNNING" };
  }

  const generatedAt = claimedRow.generatedAt ?? claimNow;
  const evidenceCutoffAt = claimedRow.evidenceCutoffAt ?? generatedAt;
  const attempt = claimedRow.attempt;

  const failTerminal = async (errorCode: string, errorMessage: string) => {
    await prisma.scoringV2EvidenceExport.updateMany({
      where: {
        id: exportRow.id,
        status: "RUNNING",
        leaseOwner,
        attempt,
      },
      data: {
        status: "FAILED",
        completedAt: nowFn(),
        errorCode,
        errorMessage: errorMessage.slice(0, 500),
        ...clearLeaseFields(),
      },
    });
    emitScoringV2Event(
      logger,
      OBS_EVENTS.scoringV2AdminEvidenceExportFailed,
      { exportId: exportRow.id, reasonCode: errorCode },
      "error",
    );
  };

  try {
    const memberCount = exportRow.cohort.members.length;
    if (memberCount > EVIDENCE_EXPORT_MAX_MEMBERS) {
      await failTerminal(
        "EVIDENCE_EXPORT_MEMBER_LIMIT",
        `Cohort has ${memberCount} members; max allowed is ${EVIDENCE_EXPORT_MAX_MEMBERS}`,
      );
      return { exportId: exportRow.id, status: "FAILED" };
    }

    const join = await runEvidenceJoin(prisma, {
      cohortId: exportRow.cohortId,
      cohortRevision: exportRow.cohortRevision,
      cohortName: exportRow.cohort.name,
      seasonId: exportRow.seasonId ?? exportRow.cohort.seasonId,
      scoreTtlSeconds,
      now: generatedAt,
      members: exportRow.cohort.members.map((m) => ({
        memberId: m.id,
        region: m.region,
        realmSlug: m.realmSlug,
        characterName: m.characterName,
        expectedLabel: m.expectedLabel,
        providedRole: m.providedRole,
        classSlug: m.classSlug,
        specSlug: m.specSlug,
        characterId: m.characterId,
        included: m.included,
        exclusionCode: m.exclusionCode,
        exclusionDetail: m.exclusionDetail,
      })),
    });

    if (exportRow.cohort.revision !== exportRow.cohortRevision) {
      join.issues.unshift({
        code: "COHORT_REVISION_DRIFT",
        severity: "blocker",
        message: `Cohort revision drifted (requested ${exportRow.cohortRevision}, current ${exportRow.cohort.revision})`,
      });
      join.blockerCount = join.issues.filter((i) => i.severity === "blocker").length;
      join.freezeEligible = false;
    }

    // Ensure join identity matches the pinned export clock (defense in depth).
    join.generatedAt = generatedAt.toISOString();

    const summaryJson = JSON.stringify(
      {
        schemaVersion: join.schemaVersion,
        generatedAt: join.generatedAt,
        evidenceCutoffAt: evidenceCutoffAt.toISOString(),
        cohortId: join.cohortId,
        cohortRevision: join.cohortRevision,
        cohortName: join.cohortName,
        seasonBinding: join.seasonBinding,
        counts: join.counts,
        progress: join.progress as unknown as Prisma.InputJsonValue,
        issues: join.issues,
        blockerCount: join.blockerCount,
        warningCount: join.warningCount,
        freezeEligible: join.freezeEligible,
      },
      null,
      2,
    );
    const preflightJson = JSON.stringify(join, null, 2);
    const markdown = buildEvidenceJoinMarkdown(join);
    const archive = buildStoreZip([
      { name: "evidence-join.summary.json", content: summaryJson },
      { name: "evidence-join.preflight.json", content: preflightJson },
      { name: "evidence-join.preflight.md", content: markdown },
    ]);

    if (archive.byteLength > EVIDENCE_EXPORT_MAX_ARCHIVE_BYTES) {
      await failTerminal(
        "EVIDENCE_EXPORT_ARCHIVE_TOO_LARGE",
        `Archive is ${archive.byteLength} bytes; max allowed is ${EVIDENCE_EXPORT_MAX_ARCHIVE_BYTES}`,
      );
      return { exportId: exportRow.id, status: "FAILED" };
    }

    const summaryWrite = await artifacts.persist({
      provider: "INTERNAL",
      bytes: Buffer.from(summaryJson, "utf8"),
      compression: "NONE",
      artifactClass: "admin_diagnostics",
      owner: { ownerType: "AdminDiagnostics", ownerId: exportRow.id },
    });
    const preflightWrite = await artifacts.persist({
      provider: "INTERNAL",
      bytes: Buffer.from(preflightJson, "utf8"),
      compression: "NONE",
      artifactClass: "admin_diagnostics",
      owner: { ownerType: "AdminDiagnostics", ownerId: exportRow.id },
    });
    const markdownWrite = await artifacts.persist({
      provider: "INTERNAL",
      bytes: Buffer.from(markdown, "utf8"),
      compression: "NONE",
      artifactClass: "admin_diagnostics",
      owner: { ownerType: "AdminDiagnostics", ownerId: exportRow.id },
    });
    const archiveWrite = await artifacts.persist({
      provider: "INTERNAL",
      bytes: archive,
      compression: "NONE",
      artifactClass: "admin_diagnostics",
      owner: { ownerType: "AdminDiagnostics", ownerId: exportRow.id },
    });

    const archiveContentHash = archiveWrite.write.contentHash;

    // H3: capture immutable freeze inputs from export-time join + cohort scan.
    const activeModelId = join.seasonBinding.activeModel?.id ?? exportRow.scoreModelId;
    let freezeActiveModel: FreezeSnapshotModelV1 | null = null;
    if (activeModelId) {
      const modelRow = await prisma.scoreModel.findUnique({ where: { id: activeModelId } });
      if (modelRow) {
        const config = createDefaultModelV6({
          ...(modelRow.config as unknown as Partial<ScoreModelConfigV1>),
          key: modelRow.key,
          version: modelRow.version,
        });
        const status =
          modelRow.status === "DRAFT" ||
          modelRow.status === "ACTIVE" ||
          modelRow.status === "ARCHIVED"
            ? modelRow.status
            : "FIXTURE";
        const modelRef = {
          id: modelRow.id,
          key: modelRow.key,
          version: modelRow.version,
          status: status as FreezeSnapshotModelV1["status"],
          config,
          isActive: true,
        };
        let dimensionConfigs: FreezeSnapshotModelV1["dimensionConfigs"] = null;
        try {
          const mode =
            config && "scoringV2" in config && config.scoringV2
              ? "calibration-strict"
              : "phase1-default";
          dimensionConfigs = resolveFrozenDimensionConfigsForModel(modelRef, mode);
        } catch {
          dimensionConfigs = null;
        }
        freezeActiveModel = { ...modelRef, dimensionConfigs };
      }
    }

    const seasonIdForSnapshot =
      join.seasonBinding.season?.id ?? exportRow.seasonId ?? exportRow.cohort.seasonId;
    const seasonRow = seasonIdForSnapshot
      ? await prisma.season.findUnique({
          where: { id: seasonIdForSnapshot },
          select: {
            id: true,
            slug: true,
            region: { select: { code: true } },
          },
        })
      : null;

    const snapshotMembers: FreezeSnapshotMemberV1[] = exportRow.cohort.members.map((m) => ({
      id: m.id,
      externalMemberKey: m.externalMemberKey ?? null,
      characterId: m.characterId ?? null,
      region: m.region,
      realmSlug: m.realmSlug,
      characterName: m.characterName,
      expectedLabel: m.expectedLabel,
      rationale: m.rationale ?? "",
      included: m.included,
      exclusionCode: m.exclusionCode ?? null,
      role: m.providedRole ?? null,
      classSlug: m.classSlug ?? null,
      specSlug: m.specSlug ?? null,
      evidenceCutoffAt: m.evidenceCutoffAt?.toISOString() ?? evidenceCutoffAt.toISOString(),
      source: m.source ?? "USER_SELECTED",
    }));

    const freezeSnapshot = buildFreezeSnapshot({
      cohortId: exportRow.cohortId,
      cohortExternalKey: exportRow.cohort.externalKey ?? null,
      cohortName: exportRow.cohort.name,
      cohortDescription: exportRow.cohort.description ?? "",
      cohortCreatedAt: exportRow.cohort.createdAt.toISOString(),
      cohortRevision: exportRow.cohortRevision,
      members: snapshotMembers,
      season: {
        seasonId: seasonRow?.id ?? seasonIdForSnapshot ?? "",
        seasonSlug: seasonRow?.slug ?? join.seasonBinding.season?.slug ?? "",
        region: seasonRow?.region?.code ?? null,
      },
      activeModel: freezeActiveModel,
      evaluationModel: null,
      policies: buildDefaultFreezePolicies({
        abilityCatalogVersions: [CURRENT_CATALOG_VERSION_ID],
        mechanicCatalogVersions: [MINIMAL_SEED_CATALOG.catalogVersion],
      }),
      evidenceCutoffAt: evidenceCutoffAt.toISOString(),
      generatedAt: generatedAt.toISOString(),
    });

    const finalized = await prisma.scoringV2EvidenceExport.updateMany({
      where: {
        id: exportRow.id,
        status: "RUNNING",
        leaseOwner,
        attempt,
      },
      data: {
        status: "COMPLETED",
        completedAt: nowFn(),
        progress: join.progress as unknown as Prisma.InputJsonValue,
        summary: {
          schemaVersion: join.schemaVersion,
          generatedAt: join.generatedAt,
          evidenceCutoffAt: evidenceCutoffAt.toISOString(),
          counts: join.counts,
          issues: join.issues,
          freezeEligible: join.freezeEligible,
          seasonBinding: join.seasonBinding,
        },
        blockerCount: join.blockerCount,
        warningCount: join.warningCount,
        summaryContentHash: summaryWrite.write.contentHash,
        preflightContentHash: preflightWrite.write.contentHash,
        markdownContentHash: markdownWrite.write.contentHash,
        archiveContentHash,
        archiveByteLength: archiveWrite.write.uncompressedSizeBytes,
        archiveStorageUri: archiveWrite.write.storageUri,
        artifactSetHash: archiveContentHash,
        scoreModelId: freezeActiveModel?.id ?? exportRow.scoreModelId,
        seasonId: seasonRow?.id ?? exportRow.seasonId,
        freezeSnapshot: freezeSnapshot as unknown as Prisma.InputJsonValue,
        ...clearLeaseFields(),
      },
    });

    if (finalized.count === 0) {
      const current = await prisma.scoringV2EvidenceExport.findUnique({
        where: { id: exportRow.id },
        select: { status: true, archiveContentHash: true, artifactSetHash: true },
      });
      // Optimistic guard: a peer already completed — never overwrite a different terminal set.
      if (
        current?.status === "COMPLETED" &&
        (current.archiveContentHash === archiveContentHash ||
          current.artifactSetHash === archiveContentHash)
      ) {
        return { exportId: exportRow.id, status: "COMPLETED" };
      }
      if (current?.status === "COMPLETED") {
        logger.warn(
          {
            exportId: exportRow.id,
            existingHash: current.archiveContentHash,
            attemptedHash: archiveContentHash,
          },
          "evidence export finalize lost to divergent COMPLETED peer",
        );
        return { exportId: exportRow.id, status: "COMPLETED" };
      }
      throw new Error("EVIDENCE_EXPORT_FINALIZE_LOST_LEASE");
    }

    emitScoringV2Event(logger, OBS_EVENTS.scoringV2AdminEvidenceExportCompleted, {
      exportId: exportRow.id,
      cohortId: exportRow.cohortId,
      blockerCount: join.blockerCount,
      warningCount: join.warningCount,
      archiveContentHash,
    });

    return { exportId: exportRow.id, status: "COMPLETED" };
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : "Evidence export failed";
    await prisma.scoringV2EvidenceExport.updateMany({
      where: {
        id: exportRow.id,
        status: "RUNNING",
        leaseOwner,
        attempt,
      },
      data: {
        status: "FAILED",
        completedAt: nowFn(),
        errorCode: "EVIDENCE_EXPORT_FAILED",
        errorMessage: message,
        ...clearLeaseFields(),
      },
    });
    emitScoringV2Event(
      logger,
      OBS_EVENTS.scoringV2AdminEvidenceExportFailed,
      { exportId: exportRow.id, reasonCode: "EVIDENCE_EXPORT_FAILED" },
      "error",
    );
    throw error;
  }
}
