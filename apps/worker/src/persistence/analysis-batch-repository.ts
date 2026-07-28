import type {
  AnalysisRunJobStatus,
  Prisma,
  PrismaClient,
  ScoreAnalysisBatch,
  ScoreAnalysisBatchRun,
  ScoreFinalizationStatus,
} from "@mplus/database";

const TERMINAL: AnalysisRunJobStatus[] = ["SUCCEEDED", "UNAVAILABLE", "FAILED"];

export interface CreateAnalysisBatchInput {
  characterId: string;
  seasonId: string;
  refreshId: string;
  scoreModelId: string;
  runIds: string[];
  deadlineAt?: Date | null;
  metadata?: Record<string, unknown>;
}

export interface AnalysisBatchRepository {
  createBatch(input: CreateAnalysisBatchInput): Promise<ScoreAnalysisBatch>;
  getById(id: string): Promise<(ScoreAnalysisBatch & { runs: ScoreAnalysisBatchRun[] }) | null>;
  markRunStatus(input: {
    batchId: string;
    runId: string;
    status: AnalysisRunJobStatus;
    terminalReason?: string | null;
    metadata?: Record<string, unknown>;
  }): Promise<{ batch: ScoreAnalysisBatch; run: ScoreAnalysisBatchRun; becameTerminal: boolean }>;
  /** Idempotent claim: PENDING/READY → FINALIZING. Returns null if already claimed/finalized. */
  claimFinalization(batchId: string, options?: { forceDeadline?: boolean }): Promise<ScoreAnalysisBatch | null>;
  markFinalized(batchId: string): Promise<ScoreAnalysisBatch>;
  markFailed(batchId: string, reason: string): Promise<ScoreAnalysisBatch>;
  recoverStaleRunning(olderThan: Date): Promise<number>;
}

function recount(runs: Array<{ status: AnalysisRunJobStatus }>): {
  terminalRunCount: number;
  successfulRunCount: number;
  unavailableRunCount: number;
  failedRunCount: number;
  finalizationStatus: ScoreFinalizationStatus;
} {
  const successfulRunCount = runs.filter((r) => r.status === "SUCCEEDED").length;
  const unavailableRunCount = runs.filter((r) => r.status === "UNAVAILABLE").length;
  const failedRunCount = runs.filter((r) => r.status === "FAILED").length;
  const terminalRunCount = successfulRunCount + unavailableRunCount + failedRunCount;
  const allTerminal = runs.length === 0 || terminalRunCount >= runs.length;
  return {
    terminalRunCount,
    successfulRunCount,
    unavailableRunCount,
    failedRunCount,
    finalizationStatus: allTerminal ? "READY_TO_FINALIZE" : "PENDING",
  };
}

export function createAnalysisBatchRepository(prisma: PrismaClient): AnalysisBatchRepository {
  return {
    async createBatch(input) {
      return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const existing = await tx.scoreAnalysisBatch.findUnique({
          where: {
            characterId_seasonId_refreshId_scoreModelId: {
              characterId: input.characterId,
              seasonId: input.seasonId,
              refreshId: input.refreshId,
              scoreModelId: input.scoreModelId,
            },
          },
        });
        if (existing) return existing;

        const batch = await tx.scoreAnalysisBatch.create({
          data: {
            characterId: input.characterId,
            seasonId: input.seasonId,
            refreshId: input.refreshId,
            scoreModelId: input.scoreModelId,
            expectedRunCount: input.runIds.length,
            deadlineAt: input.deadlineAt ?? null,
            metadata: (input.metadata ?? {}) as object,
            runs: {
              create: input.runIds.map((runId) => ({ runId, status: "PENDING" as const })),
            },
          },
        });

        // Zero children → immediately ready to finalize.
        if (input.runIds.length === 0) {
          return tx.scoreAnalysisBatch.update({
            where: { id: batch.id },
            data: { finalizationStatus: "READY_TO_FINALIZE", terminalRunCount: 0 },
          });
        }
        return batch;
      });
    },

    async getById(id) {
      return prisma.scoreAnalysisBatch.findUnique({
        where: { id },
        include: { runs: true },
      });
    },

    async markRunStatus(input) {
      return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const run = await tx.scoreAnalysisBatchRun.findUnique({
          where: { batchId_runId: { batchId: input.batchId, runId: input.runId } },
        });
        if (!run) {
          throw new Error(`Batch run ${input.batchId}/${input.runId} not found`);
        }

        const wasTerminal = TERMINAL.includes(run.status);
        const willBeTerminal = TERMINAL.includes(input.status);

        // Duplicate terminal completion is a no-op (idempotent).
        if (wasTerminal && willBeTerminal && run.status === input.status) {
          const batch = await tx.scoreAnalysisBatch.findUniqueOrThrow({ where: { id: input.batchId } });
          return { batch, run, becameTerminal: false };
        }
        if (wasTerminal && willBeTerminal) {
          const batch = await tx.scoreAnalysisBatch.findUniqueOrThrow({ where: { id: input.batchId } });
          return { batch, run, becameTerminal: false };
        }

        const updatedRun = await tx.scoreAnalysisBatchRun.update({
          where: { id: run.id },
          data: {
            status: input.status,
            terminalReason: input.terminalReason ?? run.terminalReason,
            startedAt:
              input.status === "RUNNING" ? (run.startedAt ?? new Date()) : run.startedAt,
            finishedAt: willBeTerminal ? new Date() : null,
            attempts: input.status === "RUNNING" ? run.attempts + 1 : run.attempts,
            metadata: input.metadata
              ? ({ ...(run.metadata as object), ...input.metadata } as object)
              : undefined,
          },
        });

        const allRuns = await tx.scoreAnalysisBatchRun.findMany({ where: { batchId: input.batchId } });
        const counts = recount(allRuns);
        const batch = await tx.scoreAnalysisBatch.findUniqueOrThrow({ where: { id: input.batchId } });

        // Never reset FINALIZED / FINALIZING / FAILED via child updates.
        if (
          batch.finalizationStatus === "FINALIZED" ||
          batch.finalizationStatus === "FINALIZING" ||
          batch.finalizationStatus === "FAILED"
        ) {
          return { batch, run: updatedRun, becameTerminal: !wasTerminal && willBeTerminal };
        }

        const updatedBatch = await tx.scoreAnalysisBatch.update({
          where: { id: input.batchId },
          data: {
            terminalRunCount: counts.terminalRunCount,
            successfulRunCount: counts.successfulRunCount,
            unavailableRunCount: counts.unavailableRunCount,
            failedRunCount: counts.failedRunCount,
            finalizationStatus: counts.finalizationStatus,
          },
        });

        return {
          batch: updatedBatch,
          run: updatedRun,
          becameTerminal: !wasTerminal && willBeTerminal,
        };
      });
    },

    async claimFinalization(batchId, options = {}) {
      return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const batch = await tx.scoreAnalysisBatch.findUnique({ where: { id: batchId } });
        if (!batch) return null;
        if (batch.finalizationStatus === "FINALIZED") return null;
        if (batch.finalizationStatus === "FINALIZING") return null;

        const deadlineReached =
          options.forceDeadline === true ||
          (batch.deadlineAt != null && batch.deadlineAt.getTime() <= Date.now());

        const ready =
          batch.finalizationStatus === "READY_TO_FINALIZE" ||
          (deadlineReached && batch.finalizationStatus === "PENDING");

        if (!ready) return null;

        return tx.scoreAnalysisBatch.update({
          where: { id: batchId },
          data: { finalizationStatus: "FINALIZING" },
        });
      });
    },

    async markFinalized(batchId) {
      return prisma.scoreAnalysisBatch.update({
        where: { id: batchId },
        data: { finalizationStatus: "FINALIZED", finalizedAt: new Date() },
      });
    },

    async markFailed(batchId, reason) {
      return prisma.scoreAnalysisBatch.update({
        where: { id: batchId },
        data: {
          finalizationStatus: "FAILED",
          metadata: { failureReason: reason },
        },
      });
    },

    async recoverStaleRunning(olderThan) {
      const stale = await prisma.scoreAnalysisBatchRun.findMany({
        where: { status: "RUNNING", startedAt: { lt: olderThan } },
      });
      for (const run of stale) {
        await this.markRunStatus({
          batchId: run.batchId,
          runId: run.runId,
          status: "FAILED",
          terminalReason: "STALE_RUNNING_RECOVERED",
        });
      }
      return stale.length;
    },
  };
}
