/**
 * Provider-free Scoring V2 evidence export worker job.
 * Writes only the export row + content-addressed artifacts. Never enqueues refresh.
 */
import {
  scoringV2EvidenceExportJobSchema,
  type ScoringV2EvidenceExportJob,
} from "@mplus/contracts";
import { OBS_EVENTS, emitScoringV2Event, type Logger } from "@mplus/observability";
import type { PrismaClient, Prisma } from "@mplus/database";
import type { ArtifactRepository } from "@mplus/database";
import {
  buildEvidenceJoinMarkdown,
  runEvidenceJoin,
} from "./scoring-v2/evidence-join.js";
import { buildStoreZip } from "./scoring-v2/zip-store.js";

export interface ScoringV2EvidenceExportProcessorDeps {
  prisma: PrismaClient;
  logger: Logger;
  artifacts: ArtifactRepository;
  scoreTtlSeconds?: number;
}

export async function runScoringV2EvidenceExportJob(
  deps: ScoringV2EvidenceExportProcessorDeps,
  rawPayload: ScoringV2EvidenceExportJob,
): Promise<{ exportId: string; status: string }> {
  const payload = scoringV2EvidenceExportJobSchema.parse(rawPayload);
  const { prisma, logger, artifacts } = deps;
  const scoreTtlSeconds = deps.scoreTtlSeconds ?? 604800;

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

  emitScoringV2Event(logger, OBS_EVENTS.scoringV2AdminEvidenceExportStarted, {
    exportId: exportRow.id,
    cohortId: exportRow.cohortId,
    cohortRevision: exportRow.cohortRevision,
  });

  await prisma.scoringV2EvidenceExport.update({
    where: { id: exportRow.id },
    data: { status: "RUNNING", startedAt: new Date(), errorCode: null, errorMessage: null },
  });

  try {
    if (exportRow.cohort.revision !== exportRow.cohortRevision) {
      // Still allow join against the frozen revision snapshot of members as persisted now;
      // revision mismatch is reported as a blocker by comparing requested vs current.
    }

    const join = await runEvidenceJoin(prisma, {
      cohortId: exportRow.cohortId,
      cohortRevision: exportRow.cohortRevision,
      cohortName: exportRow.cohort.name,
      seasonId: exportRow.seasonId ?? exportRow.cohort.seasonId,
      scoreTtlSeconds,
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

    const summaryJson = JSON.stringify(
      {
        schemaVersion: join.schemaVersion,
        generatedAt: join.generatedAt,
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

    await prisma.scoringV2EvidenceExport.update({
      where: { id: exportRow.id },
      data: {
        status: "COMPLETED",
        completedAt: new Date(),
        progress: join.progress as unknown as Prisma.InputJsonValue,
        summary: {
          schemaVersion: join.schemaVersion,
          generatedAt: join.generatedAt,
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
        archiveContentHash: archiveWrite.write.contentHash,
        archiveByteLength: archiveWrite.write.uncompressedSizeBytes,
        archiveStorageUri: archiveWrite.write.storageUri,
        scoreModelId: join.seasonBinding.activeModel?.id ?? exportRow.scoreModelId,
        seasonId: join.seasonBinding.season?.id ?? exportRow.seasonId,
      },
    });

    emitScoringV2Event(logger, OBS_EVENTS.scoringV2AdminEvidenceExportCompleted, {
      exportId: exportRow.id,
      cohortId: exportRow.cohortId,
      blockerCount: join.blockerCount,
      warningCount: join.warningCount,
      archiveContentHash: archiveWrite.write.contentHash,
    });

    return { exportId: exportRow.id, status: "COMPLETED" };
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : "Evidence export failed";
    await prisma.scoringV2EvidenceExport.update({
      where: { id: exportRow.id },
      data: {
        status: "FAILED",
        completedAt: new Date(),
        errorCode: "EVIDENCE_EXPORT_FAILED",
        errorMessage: message,
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
