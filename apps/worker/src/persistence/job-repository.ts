import { Prisma, type IngestionJob, type PrismaClient } from "@mplus/database";
import { DEFAULT_STALE_QUEUED_MS, isStaleQueued } from "./job-staleness.js";

export interface CreateOrGetJobInput {
  jobType: string;
  dedupeKey: string;
  characterId?: string | null;
  runId?: string | null;
  payload: unknown;
  priority?: number;
  staleQueuedMs?: number;
}

const TERMINAL_STATUSES = new Set(["COMPLETED", "FAILED", "CANCELLED"]);

export interface ResolveForEnqueueResult {
  job: IngestionJob;
  reused: boolean;
  /** When true, an in-flight job already exists — do not publish a new BullMQ message. */
  skipEnqueue: boolean;
}

export interface PromoteToQueuedInput {
  jobId: string;
  dedupeKey: string;
  jobType: string;
  characterId?: string | null;
  runId?: string | null;
  payload: unknown;
  priority?: number;
}

export interface JobRepository {
  /**
   * Resolve the ingestion row for enqueue without moving terminal jobs to QUEUED.
   * Stale QUEUED (no startedAt) is failed first so a new execution can proceed.
   */
  resolveForEnqueue(input: CreateOrGetJobInput): Promise<ResolveForEnqueueResult>;
  /**
   * After BullMQ add succeeds: create or CAS-promote the row to QUEUED.
   * `wonClaim` is false when a concurrent producer already owns an in-flight execution.
   */
  promoteToQueuedAfterEnqueue(
    input: PromoteToQueuedInput,
  ): Promise<{ job: IngestionJob; wonClaim: boolean }>;
  /** Mark enqueue failure — never leave a non-runnable QUEUED row behind. */
  markEnqueueFailed(id: string, error: unknown): Promise<IngestionJob>;
  /**
   * Used by inline/direct pipeline execution: reuse in-flight work, or prepare a terminal/
   * missing row for immediate execution (equivalent to a successful enqueue).
   */
  createOrGetByDedupe(input: CreateOrGetJobInput): Promise<{ job: IngestionJob; reused: boolean }>;
  markActive(id: string): Promise<IngestionJob>;
  markCompleted(id: string): Promise<IngestionJob>;
  markFailed(id: string, error: unknown): Promise<IngestionJob>;
  findById(id: string): Promise<IngestionJob | null>;
  findByDedupeKey(dedupeKey: string): Promise<IngestionJob | null>;
  findActiveForCharacter(characterId: string): Promise<IngestionJob | null>;
  /** Most recent job for a character regardless of status — used to report last-known outcome. */
  findLatestForCharacter(characterId: string): Promise<IngestionJob | null>;
  attachCharacter(id: string, characterId: string): Promise<IngestionJob>;
}

function errorPayload(error: unknown): object {
  return (error instanceof Error ? { message: error.message, name: error.name } : error) as object;
}

function queuedResetData(input: {
  jobType: string;
  characterId?: string | null;
  runId?: string | null;
  payload: unknown;
  priority?: number;
}) {
  return {
    jobType: input.jobType,
    characterId: input.characterId ?? null,
    runId: input.runId ?? null,
    status: "QUEUED" as const,
    priority: input.priority ?? 0,
    payload: input.payload as object,
    scheduledAt: new Date(),
    startedAt: null,
    completedAt: null,
    error: Prisma.DbNull,
  };
}

export function createJobRepository(prisma: PrismaClient): JobRepository {
  return {
    async findByDedupeKey(dedupeKey) {
      return prisma.ingestionJob.findUnique({ where: { dedupeKey } });
    },

    async resolveForEnqueue(input) {
      const staleMs = input.staleQueuedMs ?? DEFAULT_STALE_QUEUED_MS;
      let existing = await prisma.ingestionJob.findUnique({ where: { dedupeKey: input.dedupeKey } });

      if (existing && isStaleQueued(existing, Date.now(), staleMs)) {
        existing = await prisma.ingestionJob.update({
          where: { id: existing.id },
          data: {
            status: "FAILED",
            completedAt: new Date(),
            error: {
              message: "Stale QUEUED job with no startedAt — abandoned before worker pickup",
              code: "STALE_QUEUED",
            },
          },
        });
      }

      if (existing && !TERMINAL_STATUSES.has(existing.status)) {
        return { job: existing, reused: true, skipEnqueue: true };
      }

      if (existing) {
        // Keep terminal status until BullMQ add succeeds.
        return { job: existing, reused: true, skipEnqueue: false };
      }

      // Placeholder row in FAILED so we never expose QUEUED before enqueue succeeds.
      const created = await prisma.ingestionJob.create({
        data: {
          jobType: input.jobType,
          characterId: input.characterId ?? null,
          runId: input.runId ?? null,
          dedupeKey: input.dedupeKey,
          status: "FAILED",
          priority: input.priority ?? 0,
          payload: input.payload as object,
          completedAt: new Date(),
          error: {
            message: "Awaiting queue enqueue",
            code: "PENDING_ENQUEUE",
          },
        },
      });
      return { job: created, reused: false, skipEnqueue: false };
    },

    async promoteToQueuedAfterEnqueue(input) {
      const existing = await prisma.ingestionJob.findUnique({ where: { id: input.jobId } });
      if (!existing) {
        const created = await prisma.ingestionJob.create({
          data: {
            ...queuedResetData(input),
            dedupeKey: input.dedupeKey,
          },
        });
        return { job: created, wonClaim: true };
      }

      if (!TERMINAL_STATUSES.has(existing.status)) {
        // Concurrent winner already in-flight.
        return { job: existing, wonClaim: false };
      }

      const claimed = await prisma.ingestionJob.updateMany({
        where: { id: existing.id, status: { in: ["COMPLETED", "FAILED", "CANCELLED"] } },
        data: queuedResetData(input),
      });

      const job = await prisma.ingestionJob.findUniqueOrThrow({ where: { id: existing.id } });
      return { job, wonClaim: claimed.count === 1 };
    },

    async markEnqueueFailed(id, error) {
      const current = await prisma.ingestionJob.findUnique({ where: { id } });
      if (!current) {
        throw new Error(`IngestionJob ${id} not found`);
      }
      // Leave true terminal outcomes (COMPLETED) intact when a later requeue's add fails.
      if (current.status === "COMPLETED" || current.status === "CANCELLED") {
        return current;
      }
      return prisma.ingestionJob.update({
        where: { id },
        data: {
          status: "FAILED",
          completedAt: new Date(),
          startedAt: null,
          error: {
            ...errorPayload(error),
            code: "ENQUEUE_FAILED",
          },
        },
      });
    },

    async createOrGetByDedupe(input) {
      const staleMs = input.staleQueuedMs ?? DEFAULT_STALE_QUEUED_MS;
      let existing = await prisma.ingestionJob.findUnique({ where: { dedupeKey: input.dedupeKey } });

      if (existing && isStaleQueued(existing, Date.now(), staleMs)) {
        existing = await prisma.ingestionJob.update({
          where: { id: existing.id },
          data: {
            status: "FAILED",
            completedAt: new Date(),
            error: {
              message: "Stale QUEUED job with no startedAt — abandoned before worker pickup",
              code: "STALE_QUEUED",
            },
          },
        });
      }

      if (existing && !TERMINAL_STATUSES.has(existing.status)) {
        return { job: existing, reused: true };
      }

      if (existing) {
        // Direct/inline execution path: promoting is allowed because work starts immediately.
        const reset = await prisma.ingestionJob.update({
          where: { id: existing.id },
          data: queuedResetData(input),
        });
        return { job: reset, reused: true };
      }

      const created = await prisma.ingestionJob.create({
        data: {
          ...queuedResetData(input),
          dedupeKey: input.dedupeKey,
        },
      });
      return { job: created, reused: false };
    },

    async markActive(id) {
      return prisma.ingestionJob.update({
        where: { id },
        data: { status: "ACTIVE", startedAt: new Date(), attempts: { increment: 1 } },
      });
    },

    async markCompleted(id) {
      return prisma.ingestionJob.update({
        where: { id },
        data: { status: "COMPLETED", completedAt: new Date(), error: Prisma.DbNull },
      });
    },

    async markFailed(id, error) {
      return prisma.ingestionJob.update({
        where: { id },
        data: {
          status: "FAILED",
          completedAt: new Date(),
          error: errorPayload(error),
        },
      });
    },

    async findById(id) {
      return prisma.ingestionJob.findUnique({ where: { id } });
    },

    async findActiveForCharacter(characterId) {
      const job = await prisma.ingestionJob.findFirst({
        where: { characterId, status: { in: ["QUEUED", "ACTIVE"] } },
        orderBy: { scheduledAt: "desc" },
      });
      if (!job) return null;
      if (isStaleQueued(job)) {
        await prisma.ingestionJob.update({
          where: { id: job.id },
          data: {
            status: "FAILED",
            completedAt: new Date(),
            error: {
              message: "Stale QUEUED job with no startedAt — abandoned before worker pickup",
              code: "STALE_QUEUED",
            },
          },
        });
        return null;
      }
      return job;
    },

    async findLatestForCharacter(characterId) {
      return prisma.ingestionJob.findFirst({
        where: { characterId },
        orderBy: { scheduledAt: "desc" },
      });
    },

    async attachCharacter(id, characterId) {
      return prisma.ingestionJob.update({ where: { id }, data: { characterId } });
    },
  };
}
