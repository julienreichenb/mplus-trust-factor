import { createHash } from "node:crypto";
import type { PrismaClient } from "@mplus/database";
import type { CalibrationRunJob } from "@mplus/contracts";
import {
  runCalibrationHarnessFromBundle,
  buildCalibrationDigestV1,
  CALIBRATION_REPORT_SCHEMA_VERSION,
  type CalibrationBacktestMode,
  type CalibrationReport,
} from "@mplus/scoring";
import type { Logger } from "@mplus/observability";

export interface CalibrationRunProcessorDeps {
  prisma: PrismaClient;
  logger: Logger;
  /** Defense in depth — the queue producer already gates enqueue on this flag. */
  calibrationEnabled: boolean;
}

export interface CalibrationRunProcessorResult {
  status:
    | "SUCCEEDED"
    | "FAILED"
    | "CANCELLED"
    | "SKIPPED_DISABLED"
    | "NOT_FOUND"
    | "NOOP_TERMINAL";
}

const MODE_MAP: Record<string, CalibrationBacktestMode> = {
  PERSISTED_SNAPSHOT_ONLY: "persisted-snapshot-only",
  DRAFT_MODEL_EVALUATE: "draft-model-evaluate",
  ACTIVE_VERSUS_DRAFT: "active-versus-draft",
};

function meanOf(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * Dedicated `calibration-run` queue processor. Never touches Blizzard/WCL/RaiderIO
 * producers or refresh admission/ETA. Redelivery of a terminal run is a no-op.
 */
export async function runCalibrationRunJob(
  deps: CalibrationRunProcessorDeps,
  job: CalibrationRunJob,
): Promise<CalibrationRunProcessorResult> {
  const { prisma, logger } = deps;

  if (!deps.calibrationEnabled) {
    logger.warn(
      { calibrationRunId: job.calibrationRunId },
      "calibration-run job received while ADMIN_CALIBRATION_ENABLED=false — ignoring",
    );
    return { status: "SKIPPED_DISABLED" };
  }

  const run = await prisma.calibrationRun.findUnique({ where: { id: job.calibrationRunId } });
  if (!run) {
    logger.warn({ calibrationRunId: job.calibrationRunId }, "calibration run not found — dropping job");
    return { status: "NOT_FOUND" };
  }

  if (run.status === "SUCCEEDED" || run.status === "CANCELLED" || run.status === "FAILED") {
    return { status: "NOOP_TERMINAL" };
  }

  if (run.cancelRequestedAt) {
    await prisma.calibrationRun.update({
      where: { id: run.id },
      data: {
        status: "CANCELLED",
        completedAt: new Date(),
        errorCode: "CANCELLED",
        errorMessage: "Cancelled before execution started",
      },
    });
    return { status: "CANCELLED" };
  }

  const claimed = await prisma.calibrationRun.updateMany({
    where: { id: run.id, status: "QUEUED" },
    data: { status: "RUNNING", startedAt: new Date() },
  });
  if (claimed.count === 0) {
    // Concurrent redelivery raced us; only proceed if another worker left it RUNNING.
    const current = await prisma.calibrationRun.findUnique({ where: { id: run.id } });
    if (!current || current.status !== "RUNNING") {
      return { status: "NOOP_TERMINAL" };
    }
  }

  try {
    const mode = MODE_MAP[run.mode] ?? "persisted-snapshot-only";
    // Replay clock is frozen to bundle.generatedAt so redelivery is byte-identical.
    const bundle = run.inputBundle as { generatedAt?: string };
    const { report } = runCalibrationHarnessFromBundle(run.inputBundle, {
      mode,
      calculatedAt: bundle.generatedAt ?? run.createdAt.toISOString(),
    });

    const fresh = await prisma.calibrationRun.findUnique({ where: { id: run.id } });
    if (fresh?.cancelRequestedAt) {
      await prisma.calibrationRun.update({
        where: { id: run.id },
        data: {
          status: "CANCELLED",
          completedAt: new Date(),
          errorCode: "CANCELLED",
          errorMessage: "Cancelled during execution",
        },
      });
      return { status: "CANCELLED" };
    }

    const digest = buildCalibrationDigestV1(report);
    const reportJson = JSON.stringify(report);
    const contentHash = createHash("sha256").update(reportJson).digest("hex");
    const now = new Date();

    const scored: CalibrationReport["characters"] = report.characters.filter(
      (c) => c.overallScore != null && !c.error && !c.validationFailure,
    );
    const meanScore = meanOf(scored.map((c) => c.overallScore!));
    const confidences = scored
      .map((c) => c.confidence)
      .filter((c): c is number => typeof c === "number");
    const meanConfidence = meanOf(confidences);

    await prisma.$transaction(async (tx) => {
      await tx.calibrationReport.upsert({
        where: { runId: run.id },
        create: {
          runId: run.id,
          schemaVersion: CALIBRATION_REPORT_SCHEMA_VERSION,
          digestAlgorithmVersion: digest.algorithmVersion,
          recommendationAlgorithmVersion: null,
          summaryJson: {
            cohortId: report.cohortId,
            mode: report.mode,
            cohortSize: report.cohortSize,
            evaluatedCount: report.evaluatedCount,
            errorCount: report.errorCount,
            validationFailureCount: report.validationFailureCount,
            gradeDistribution: report.statistics.gradeDistribution,
          } as object,
          reportJson: report as unknown as object,
          digestJson: digest as unknown as object,
          limitationsJson: digest.limitations as unknown as object,
          cohortSize: report.cohortSize,
          evaluatedCount: report.evaluatedCount,
          failedOrExcludedCount: report.errorCount + report.validationFailureCount,
          spearman: report.statistics.monotonicOrdering.labelScoreSpearman,
          pairwiseConcordance: report.statistics.monotonicOrdering.pairwiseConcordance,
          meanScore,
          meanConfidence,
          outlierCount: report.statistics.outliers.length,
          contentHash,
          generatedAt: now,
        },
        update: {},
      });
      await tx.calibrationRun.update({
        where: { id: run.id },
        data: { status: "SUCCEEDED", completedAt: now },
      });
    });

    return { status: "SUCCEEDED" };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await prisma.calibrationRun.update({
      where: { id: run.id },
      data: {
        status: "FAILED",
        completedAt: new Date(),
        errorCode: "CALIBRATION_HARNESS_ERROR",
        errorMessage: message.slice(0, 2000),
      },
    });
    logger.error({ err: error, calibrationRunId: run.id }, "calibration run failed");
    return { status: "FAILED" };
  }
}
