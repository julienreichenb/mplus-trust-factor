import { Prisma, type IngestionJob, type JobStatus, type PrismaClient } from "@mplus/database";
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

export interface ListRefreshJobsFilter {
  status?: JobStatus | "delayed" | null;
  region?: string | null;
  characterName?: string | null;
  realmSlug?: string | null;
  characterId?: string | null;
  triggerSource?: string | null;
  /** true = bulk only, false = direct only, null = all */
  fromBulk?: boolean | null;
  /**
   * When false (default), only the latest FAILED job per character is returned among failures.
   * When true, all historical FAILED rows are included.
   */
  showHistoricalFailures?: boolean;
  page?: number;
  pageSize?: number;
}

export interface JobRepository {
  /**
   * Resolve the ingestion row for enqueue without moving terminal jobs to QUEUED.
   * Stale QUEUED (no startedAt) is failed first so a new execution can proceed.
   */
  resolveForEnqueue(input: CreateOrGetJobInput): Promise<ResolveForEnqueueResult>;
  /**
   * Claim the IngestionJob row to QUEUED before BullMQ publish.
   * `wonClaim` is false when a concurrent producer already owns an in-flight execution.
   * Callers must not publish a BullMQ message when wonClaim is false.
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
  /** Terminalize as CANCELLED (never FAILED). Idempotent for already-CANCELLED rows. */
  markCancelled(
    id: string,
    input?: { reason?: string | null; error?: unknown },
  ): Promise<IngestionJob>;
  /**
   * CAS: QUEUED → CANCELLED only. Returns null if status raced away (e.g. ACTIVE).
   * Used after BullMQ remove confirmation.
   */
  markCancelledIfQueued(
    id: string,
    input?: { reason?: string | null; error?: unknown },
  ): Promise<IngestionJob | null>;
  /** Cooperative cancel request for QUEUED/ACTIVE jobs. Idempotent. */
  requestCancel(id: string, reason?: string | null): Promise<IngestionJob>;
  setQueueJobId(id: string, queueJobId: string): Promise<IngestionJob>;
  updatePriority(id: string, priority: number): Promise<IngestionJob>;
  findById(id: string): Promise<IngestionJob | null>;
  findByDedupeKey(dedupeKey: string): Promise<IngestionJob | null>;
  findActiveForCharacter(characterId: string): Promise<IngestionJob | null>;
  /** Most recent job for a character regardless of status — used to report last-known outcome. */
  findLatestForCharacter(characterId: string): Promise<IngestionJob | null>;
  attachCharacter(id: string, characterId: string): Promise<IngestionJob>;
  /** Count non-terminal refresh-character jobs (QUEUED + ACTIVE). */
  countInFlightRefreshJobs(): Promise<number>;
  listInFlightRefreshJobs(): Promise<IngestionJob[]>;
  listRefreshJobs(
    filter: ListRefreshJobsFilter,
  ): Promise<{ jobs: IngestionJob[]; total: number; page: number; pageSize: number }>;
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
    queueJobId: null,
    cancelRequestedAt: null,
    cancelledAt: null,
    cancelReason: null,
  };
}

function payloadRecord(payload: unknown): Record<string, unknown> {
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    return payload as Record<string, unknown>;
  }
  return {};
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
      const current = await prisma.ingestionJob.findUnique({ where: { id } });
      if (current?.status === "CANCELLED") {
        return current;
      }
      if (current?.cancelRequestedAt && (current.status === "ACTIVE" || current.status === "QUEUED")) {
        return prisma.ingestionJob.update({
          where: { id },
          data: {
            status: "CANCELLED",
            completedAt: new Date(),
            cancelledAt: new Date(),
            cancelReason: current.cancelReason ?? "cancellation_requested",
            error: {
              code: "CANCELLED",
              message: "Job cancelled before failure terminalization",
              retryable: false,
              providerFailure: false,
            },
          },
        });
      }
      return prisma.ingestionJob.update({
        where: { id },
        data: {
          status: "FAILED",
          completedAt: new Date(),
          error: errorPayload(error),
        },
      });
    },

    async markCancelled(id, input = {}) {
      const current = await prisma.ingestionJob.findUnique({ where: { id } });
      if (!current) {
        throw new Error(`IngestionJob ${id} not found`);
      }
      if (current.status === "CANCELLED") {
        return current;
      }
      if (current.status === "COMPLETED" || current.status === "FAILED") {
        return current;
      }
      const reason = input.reason ?? current.cancelReason ?? "admin_cancel";
      return prisma.ingestionJob.update({
        where: { id },
        data: {
          status: "CANCELLED",
          completedAt: new Date(),
          cancelledAt: new Date(),
          cancelReason: reason,
          cancelRequestedAt: current.cancelRequestedAt ?? new Date(),
          error: input.error
            ? errorPayload(input.error)
            : {
                code: "CANCELLED",
                message: reason,
                retryable: false,
                providerFailure: false,
              },
        },
      });
    },

    async markCancelledIfQueued(id, input = {}) {
      const current = await prisma.ingestionJob.findUnique({ where: { id } });
      if (!current) {
        throw new Error(`IngestionJob ${id} not found`);
      }
      if (current.status === "CANCELLED") {
        return current;
      }
      if (current.status !== "QUEUED") {
        return null;
      }
      const reason = input.reason ?? current.cancelReason ?? "admin_cancel";
      const updated = await prisma.ingestionJob.updateMany({
        where: { id, status: "QUEUED" },
        data: {
          status: "CANCELLED",
          completedAt: new Date(),
          cancelledAt: new Date(),
          cancelReason: reason,
          cancelRequestedAt: current.cancelRequestedAt ?? new Date(),
          error: input.error
            ? errorPayload(input.error)
            : {
                code: "CANCELLED",
                message: reason,
                retryable: false,
                providerFailure: false,
              },
        },
      });
      if (updated.count === 0) {
        return null;
      }
      return prisma.ingestionJob.findUniqueOrThrow({ where: { id } });
    },

    async requestCancel(id, reason = null) {
      const current = await prisma.ingestionJob.findUnique({ where: { id } });
      if (!current) {
        throw new Error(`IngestionJob ${id} not found`);
      }
      if (current.status === "CANCELLED") {
        return current;
      }
      if (current.status === "COMPLETED" || current.status === "FAILED") {
        return current;
      }
      if (current.cancelRequestedAt) {
        return current;
      }
      // CAS: only set cancelRequestedAt while still QUEUED or ACTIVE.
      const updated = await prisma.ingestionJob.updateMany({
        where: {
          id,
          status: { in: ["QUEUED", "ACTIVE"] },
          cancelRequestedAt: null,
        },
        data: {
          cancelRequestedAt: new Date(),
          cancelReason: reason ?? "admin_cancel",
        },
      });
      if (updated.count === 0) {
        return prisma.ingestionJob.findUniqueOrThrow({ where: { id } });
      }
      return prisma.ingestionJob.findUniqueOrThrow({ where: { id } });
    },

    async setQueueJobId(id, queueJobId) {
      return prisma.ingestionJob.update({
        where: { id },
        data: { queueJobId },
      });
    },

    async updatePriority(id, priority) {
      return prisma.ingestionJob.update({
        where: { id },
        data: { priority },
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

    async countInFlightRefreshJobs() {
      return prisma.ingestionJob.count({
        where: {
          jobType: "refresh-character",
          status: { in: ["QUEUED", "ACTIVE"] },
        },
      });
    },

    async listInFlightRefreshJobs() {
      return prisma.ingestionJob.findMany({
        where: {
          jobType: "refresh-character",
          status: { in: ["QUEUED", "ACTIVE"] },
        },
        orderBy: { scheduledAt: "asc" },
      });
    },

    async listRefreshJobs(filter) {
      const page = Math.max(1, filter.page ?? 1);
      const pageSize = Math.min(100, Math.max(1, filter.pageSize ?? 25));
      const showHistoricalFailures = Boolean(filter.showHistoricalFailures);

      const jobs = await prisma.ingestionJob.findMany({
        where: { jobType: "refresh-character" },
        orderBy: { scheduledAt: "desc" },
        take: 5_000,
      });

      const latestFailedByCharacter = new Map<string, string>();
      for (const job of jobs) {
        if (job.status !== "FAILED") continue;
        const key = job.characterId ?? `anon:${job.id}`;
        if (!latestFailedByCharacter.has(key)) {
          latestFailedByCharacter.set(key, job.id);
        }
      }

      const filtered = jobs.filter((job) => {
        if (filter.status && filter.status !== "delayed") {
          if (job.status !== filter.status) return false;
        }
        if (filter.characterId && job.characterId !== filter.characterId) return false;

        const payload = payloadRecord(job.payload);
        if (filter.region) {
          const region = typeof payload.region === "string" ? payload.region : null;
          if (!region || region.toUpperCase() !== filter.region.toUpperCase()) return false;
        }
        if (filter.characterName) {
          const name = typeof payload.name === "string" ? payload.name : "";
          if (!name.toLowerCase().includes(filter.characterName.toLowerCase())) return false;
        }
        if (filter.realmSlug) {
          const realm = typeof payload.realmSlug === "string" ? payload.realmSlug : "";
          if (!realm.toLowerCase().includes(filter.realmSlug.toLowerCase())) return false;
        }
        if (filter.triggerSource) {
          const source = typeof payload.triggerSource === "string" ? payload.triggerSource : "UNKNOWN";
          if (source !== filter.triggerSource) return false;
        }
        if (filter.fromBulk != null) {
          const source = typeof payload.triggerSource === "string" ? payload.triggerSource : null;
          const isBulk = source === "BULK_REFRESH";
          if (filter.fromBulk !== isBulk) return false;
        }
        if (!showHistoricalFailures && job.status === "FAILED") {
          const key = job.characterId ?? `anon:${job.id}`;
          if (latestFailedByCharacter.get(key) !== job.id) return false;
        }
        return true;
      });

      const total = filtered.length;
      const start = (page - 1) * pageSize;
      return {
        jobs: filtered.slice(start, start + pageSize),
        total,
        page,
        pageSize,
      };
    },
  };
}
