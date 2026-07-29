/**
 * Thin persistence helpers for refresh schedule checkpoints.
 * Callers remain responsible for dry-run / scheduler enabled gates.
 */

import type { Prisma, PrismaClient } from "@mplus/database";
import type { SchedulerCheckpoint, SchedulerPlanResult } from "../orchestration/refresh-scheduler.js";
import { toInputJsonValue } from "./prisma-json.js";

function schedulerCheckpointToJson(checkpoint: SchedulerCheckpoint): Prisma.InputJsonValue {
  // Field-by-field copy keeps the payload InputJsonValue-compatible without casts.
  return {
    cursor: checkpoint.cursor,
    processedCount: checkpoint.processedCount,
    enqueuedCount: checkpoint.enqueuedCount,
    deferredCount: checkpoint.deferredCount,
    skippedCount: checkpoint.skippedCount,
    plannedWclPoints: checkpoint.plannedWclPoints,
    consumedWclPoints: checkpoint.consumedWclPoints,
    lastCharacterId: checkpoint.lastCharacterId,
  };
}

function readFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Validate and reconstruct SchedulerCheckpoint from a Prisma JSON column.
 * Returns null when the stored shape is incomplete or invalid.
 */
export function parseSchedulerCheckpoint(value: unknown): SchedulerCheckpoint | null {
  if (value === null || value === undefined || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const row = value as Record<string, unknown>;
  const cursor = readFiniteNumber(row.cursor);
  const processedCount = readFiniteNumber(row.processedCount);
  const enqueuedCount = readFiniteNumber(row.enqueuedCount);
  const deferredCount = readFiniteNumber(row.deferredCount);
  const skippedCount = readFiniteNumber(row.skippedCount);
  const plannedWclPoints = readFiniteNumber(row.plannedWclPoints);
  const consumedWclPoints = readFiniteNumber(row.consumedWclPoints);
  if (
    cursor === null ||
    processedCount === null ||
    enqueuedCount === null ||
    deferredCount === null ||
    skippedCount === null ||
    plannedWclPoints === null ||
    consumedWclPoints === null
  ) {
    return null;
  }
  const lastCharacterId = row.lastCharacterId;
  if (lastCharacterId !== null && typeof lastCharacterId !== "string") {
    return null;
  }
  return {
    cursor,
    processedCount,
    enqueuedCount,
    deferredCount,
    skippedCount,
    plannedWclPoints,
    consumedWclPoints,
    lastCharacterId,
  };
}

export async function createScheduleRunFromPlan(
  prisma: PrismaClient,
  plan: SchedulerPlanResult,
): Promise<{ id: string }> {
  const run = await prisma.refreshScheduleRun.create({
    data: {
      mode: plan.mode,
      status: plan.dryRun ? "COMPLETED" : "PLANNING",
      strategy: plan.strategy,
      dryRun: plan.dryRun,
      configSnapshot: toInputJsonValue({
        estimatedCompletionHours: plan.estimatedCompletionHours,
        cadenceRecommendation: plan.cadenceRecommendation,
        notes: plan.notes,
      }),
      checkpoint: schedulerCheckpointToJson(plan.checkpoint),
      denominatorKey: plan.denominator?.key ?? null,
      denominatorCount: plan.denominator?.count ?? null,
      plannedJobCount: plan.items.filter((i) => i.status === "PLANNED").length,
      selectedCount: plan.items.filter((i) => i.status === "PLANNED").length,
      skippedCount: plan.items.filter((i) => i.status.startsWith("SKIPPED_")).length,
      deferredCount: plan.items.filter((i) => i.status === "DEFERRED_RATE_LIMIT").length,
      estimatedWclPoints: plan.estimatedWclPoints,
      regionDistribution: toInputJsonValue(plan.regionDistribution),
      specDistribution: toInputJsonValue(plan.specDistribution),
      notes: plan.notes,
      completedAt: plan.dryRun ? new Date() : null,
      items: {
        create: plan.items.map((item) => ({
          characterId: item.characterId,
          cadenceTier: item.cadenceTier,
          region: item.region,
          specRole: item.specRole,
          plannedDatasets: item.plannedDatasets,
          estimatedWclPoints: item.estimatedWclPoints,
          status: item.status,
          deterministicJobKey: item.deterministicJobKey,
          skipReason: item.skipReason ?? null,
          deferredUntil: item.deferredUntil ? new Date(item.deferredUntil) : null,
        })),
      },
    },
    select: { id: true },
  });
  return run;
}

export async function saveScheduleCheckpoint(
  prisma: PrismaClient,
  scheduleRunId: string,
  checkpoint: SchedulerCheckpoint,
  status?: "RUNNING" | "PAUSED_BUDGET" | "COMPLETED",
): Promise<void> {
  await prisma.refreshScheduleRun.update({
    where: { id: scheduleRunId },
    data: {
      checkpoint: schedulerCheckpointToJson(checkpoint),
      ...(status ? { status } : {}),
      deferredCount: checkpoint.deferredCount,
      selectedCount: checkpoint.enqueuedCount,
      skippedCount: checkpoint.skippedCount,
      estimatedWclPoints: checkpoint.plannedWclPoints,
      consumedWclPoints: checkpoint.consumedWclPoints,
      completedAt: status === "COMPLETED" ? new Date() : undefined,
    },
  });
}

export async function loadScheduleCheckpoint(
  prisma: PrismaClient,
  scheduleRunId: string,
): Promise<SchedulerCheckpoint | null> {
  const run = await prisma.refreshScheduleRun.findUnique({
    where: { id: scheduleRunId },
    select: { checkpoint: true },
  });
  if (run?.checkpoint == null) return null;
  return parseSchedulerCheckpoint(run.checkpoint);
}
