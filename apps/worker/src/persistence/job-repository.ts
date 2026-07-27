import type { IngestionJob, PrismaClient } from "@mplus/database";

export interface CreateOrGetJobInput {
  jobType: string;
  dedupeKey: string;
  characterId?: string | null;
  runId?: string | null;
  payload: unknown;
  priority?: number;
}

const TERMINAL_STATUSES = new Set(["COMPLETED", "FAILED", "CANCELLED"]);

export interface JobRepository {
  createOrGetByDedupe(input: CreateOrGetJobInput): Promise<{ job: IngestionJob; reused: boolean }>;
  markActive(id: string): Promise<IngestionJob>;
  markCompleted(id: string): Promise<IngestionJob>;
  markFailed(id: string, error: unknown): Promise<IngestionJob>;
  findById(id: string): Promise<IngestionJob | null>;
  findActiveForCharacter(characterId: string): Promise<IngestionJob | null>;
  /** Most recent job for a character regardless of status — used to report last-known outcome. */
  findLatestForCharacter(characterId: string): Promise<IngestionJob | null>;
  attachCharacter(id: string, characterId: string): Promise<IngestionJob>;
}

export function createJobRepository(prisma: PrismaClient): JobRepository {
  return {
    async createOrGetByDedupe(input) {
      const existing = await prisma.ingestionJob.findUnique({ where: { dedupeKey: input.dedupeKey } });

      if (existing && !TERMINAL_STATUSES.has(existing.status)) {
        return { job: existing, reused: true };
      }

      if (existing) {
        // Dedupe key is unique at the DB level, so a re-refresh past cooldown reuses the same row.
        const reset = await prisma.ingestionJob.update({
          where: { id: existing.id },
          data: {
            jobType: input.jobType,
            characterId: input.characterId ?? null,
            runId: input.runId ?? null,
            status: "QUEUED",
            priority: input.priority ?? 0,
            payload: input.payload as object,
            scheduledAt: new Date(),
            startedAt: null,
            completedAt: null,
            error: undefined,
          },
        });
        return { job: reset, reused: true };
      }

      const created = await prisma.ingestionJob.create({
        data: {
          jobType: input.jobType,
          characterId: input.characterId ?? null,
          runId: input.runId ?? null,
          dedupeKey: input.dedupeKey,
          status: "QUEUED",
          priority: input.priority ?? 0,
          payload: input.payload as object,
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
        data: { status: "COMPLETED", completedAt: new Date() },
      });
    },

    async markFailed(id, error) {
      return prisma.ingestionJob.update({
        where: { id },
        data: {
          status: "FAILED",
          completedAt: new Date(),
          error: (error instanceof Error ? { message: error.message, name: error.name } : error) as object,
        },
      });
    },

    async findById(id) {
      return prisma.ingestionJob.findUnique({ where: { id } });
    },

    async findActiveForCharacter(characterId) {
      return prisma.ingestionJob.findFirst({
        where: { characterId, status: { in: ["QUEUED", "ACTIVE"] } },
        orderBy: { scheduledAt: "desc" },
      });
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
