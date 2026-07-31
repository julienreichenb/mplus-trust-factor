/**
 * Durable RefreshAdmission audit helpers (Postgres).
 * Foundation may record shadow predictions; Redis remains live authority later.
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

export interface RefreshAdmissionRepository {
  upsertShadowPrediction(input: UpsertShadowAdmissionInput): Promise<{ id: string; status: RefreshAdmissionStatus }>;
  markReleased(jobId: string, metadata?: Record<string, unknown>): Promise<void>;
  findByJobId(jobId: string): Promise<{
    id: string;
    jobId: string;
    status: RefreshAdmissionStatus;
    estimatedWclPoints: number;
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

    async markReleased(jobId, metadata) {
      const existing = await prisma.refreshAdmission.findUnique({ where: { jobId } });
      if (!existing) return;
      const nextMeta = {
        ...(typeof existing.metadata === "object" && existing.metadata !== null
          ? (existing.metadata as Record<string, unknown>)
          : {}),
        ...metadata,
        releasedAt: new Date().toISOString(),
      } as Prisma.InputJsonValue;
      await prisma.refreshAdmission.update({
        where: { jobId },
        data: {
          status: "RELEASED",
          settledAt: new Date(),
          metadata: nextMeta,
        },
      });
    },

    async findByJobId(jobId) {
      return prisma.refreshAdmission.findUnique({
        where: { jobId },
        select: {
          id: true,
          jobId: true,
          status: true,
          estimatedWclPoints: true,
          metadata: true,
        },
      });
    },
  };
}
