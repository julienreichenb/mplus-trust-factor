/**
 * Durable RefreshAdmission audit helpers (Postgres).
 * Redis remains live authority when enforce is on; Postgres is recovery evidence.
 */

import type { PrismaClient, RefreshAdmissionStatus, Prisma } from "@mplus/database";

export interface UpsertShadowAdmissionInput {
  jobId: string;
  characterId?: string | null;
  estimatedWclPoints: number;
  emergencyOverride: boolean;
  windowId: string;
  leaseExpiresAt: Date;
  reservedAt?: Date;
  prediction: Record<string, unknown>;
}

export interface UpsertReservedAdmissionInput {
  jobId: string;
  characterId?: string | null;
  estimatedWclPoints: number;
  emergencyOverride: boolean;
  windowId: string;
  leaseExpiresAt: Date;
  reservedAt?: Date;
  metadata?: Record<string, unknown>;
}

export interface SettleAdmissionInput {
  jobId: string;
  measuredWclPoints?: number | null;
  status: Extract<RefreshAdmissionStatus, "SETTLED" | "RELEASED" | "CANCELLED" | "EXPIRED">;
  metadata?: Record<string, unknown>;
}

export interface RefreshAdmissionRepository {
  upsertShadowPrediction(input: UpsertShadowAdmissionInput): Promise<{ id: string; status: RefreshAdmissionStatus }>;
  upsertReserved(input: UpsertReservedAdmissionInput): Promise<{ id: string; status: RefreshAdmissionStatus }>;
  settle(input: SettleAdmissionInput): Promise<void>;
  markReleased(jobId: string, metadata?: Record<string, unknown>): Promise<void>;
  findByJobId(jobId: string): Promise<{
    id: string;
    jobId: string;
    status: RefreshAdmissionStatus;
    estimatedWclPoints: number;
    measuredWclPoints: number | null;
    windowId: string;
    metadata: unknown;
  } | null>;
}

/**
 * Shadow rows use RELEASED immediately with metadata.shadow=true so they never
 * look like live RESERVED holds that a sweeper must reconcile from Redis.
 */
export function createRefreshAdmissionRepository(prisma: PrismaClient): RefreshAdmissionRepository {
  return {
    async upsertShadowPrediction(input) {
      const reservedAt = input.reservedAt ?? new Date();
      const metadata = {
        shadow: true,
        foundation: true,
        ...input.prediction,
      } as Prisma.InputJsonValue;

      const row = await prisma.refreshAdmission.upsert({
        where: { jobId: input.jobId },
        create: {
          jobId: input.jobId,
          characterId: input.characterId ?? null,
          status: "RELEASED",
          estimatedWclPoints: Math.max(0, Math.floor(input.estimatedWclPoints)),
          emergencyOverride: input.emergencyOverride,
          windowId: input.windowId || "shadow:none",
          reservedAt,
          leaseExpiresAt: input.leaseExpiresAt,
          settledAt: reservedAt,
          metadata,
        },
        update: {
          characterId: input.characterId ?? null,
          status: "RELEASED",
          estimatedWclPoints: Math.max(0, Math.floor(input.estimatedWclPoints)),
          emergencyOverride: input.emergencyOverride,
          windowId: input.windowId || "shadow:none",
          leaseExpiresAt: input.leaseExpiresAt,
          settledAt: reservedAt,
          metadata,
        },
        select: { id: true, status: true },
      });
      return row;
    },

    async upsertReserved(input) {
      const reservedAt = input.reservedAt ?? new Date();
      const metadata = {
        enforce: true,
        ...(input.metadata ?? {}),
      } as Prisma.InputJsonValue;

      // Idempotent: if already RESERVED for this job, refresh lease only (no duplicate debit evidence).
      const existing = await prisma.refreshAdmission.findUnique({ where: { jobId: input.jobId } });
      if (existing?.status === "RESERVED") {
        const row = await prisma.refreshAdmission.update({
          where: { jobId: input.jobId },
          data: {
            leaseExpiresAt: input.leaseExpiresAt,
            characterId: input.characterId ?? existing.characterId,
            metadata: {
              ...(typeof existing.metadata === "object" && existing.metadata !== null
                ? (existing.metadata as Record<string, unknown>)
                : {}),
              ...(input.metadata ?? {}),
              idempotentReAdmit: true,
            } as Prisma.InputJsonValue,
          },
          select: { id: true, status: true },
        });
        return row;
      }

      const row = await prisma.refreshAdmission.upsert({
        where: { jobId: input.jobId },
        create: {
          jobId: input.jobId,
          characterId: input.characterId ?? null,
          status: "RESERVED",
          estimatedWclPoints: Math.max(0, Math.floor(input.estimatedWclPoints)),
          emergencyOverride: input.emergencyOverride,
          windowId: input.windowId || "none",
          reservedAt,
          leaseExpiresAt: input.leaseExpiresAt,
          settledAt: null,
          metadata,
        },
        update: {
          characterId: input.characterId ?? null,
          status: "RESERVED",
          estimatedWclPoints: Math.max(0, Math.floor(input.estimatedWclPoints)),
          emergencyOverride: input.emergencyOverride,
          windowId: input.windowId || "none",
          reservedAt,
          leaseExpiresAt: input.leaseExpiresAt,
          settledAt: null,
          measuredWclPoints: null,
          metadata,
        },
        select: { id: true, status: true },
      });
      return row;
    },

    async settle(input) {
      const existing = await prisma.refreshAdmission.findUnique({ where: { jobId: input.jobId } });
      if (!existing) return;
      // Idempotent terminal settle — do not rewrite already-settled measured cost.
      if (
        existing.status === "SETTLED" ||
        existing.status === "RELEASED" ||
        existing.status === "CANCELLED" ||
        existing.status === "EXPIRED"
      ) {
        if (input.measuredWclPoints != null && existing.measuredWclPoints == null) {
          await prisma.refreshAdmission.update({
            where: { jobId: input.jobId },
            data: { measuredWclPoints: Math.max(0, Math.floor(input.measuredWclPoints)) },
          });
        }
        return;
      }
      const nextMeta = {
        ...(typeof existing.metadata === "object" && existing.metadata !== null
          ? (existing.metadata as Record<string, unknown>)
          : {}),
        ...(input.metadata ?? {}),
        settledAt: new Date().toISOString(),
      } as Prisma.InputJsonValue;
      await prisma.refreshAdmission.update({
        where: { jobId: input.jobId },
        data: {
          status: input.status,
          measuredWclPoints:
            input.measuredWclPoints != null
              ? Math.max(0, Math.floor(input.measuredWclPoints))
              : existing.measuredWclPoints,
          settledAt: new Date(),
          metadata: nextMeta,
        },
      });
    },

    async markReleased(jobId, metadata) {
      await this.settle({ jobId, status: "RELEASED", metadata });
    },

    async findByJobId(jobId) {
      return prisma.refreshAdmission.findUnique({
        where: { jobId },
        select: {
          id: true,
          jobId: true,
          status: true,
          estimatedWclPoints: true,
          measuredWclPoints: true,
          windowId: true,
          metadata: true,
        },
      });
    },
  };
}
