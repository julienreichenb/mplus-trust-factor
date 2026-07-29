/**
 * Thin persistence helpers for refresh schedule checkpoints.
 * Callers remain responsible for dry-run / scheduler enabled gates.
 */

import type { PrismaClient } from "@mplus/database";
import type { SchedulerCheckpoint, SchedulerPlanResult } from "../orchestration/refresh-scheduler.js";

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
      configSnapshot: {
        estimatedCompletionHours: plan.estimatedCompletionHours,
        cadenceRecommendation: plan.cadenceRecommendation,
        notes: plan.notes,
      },
      checkpoint: plan.checkpoint,
      denominatorKey: plan.denominator?.key ?? null,
      denominatorCount: plan.denominator?.count ?? null,
      plannedJobCount: plan.items.filter((i) => i.status === "PLANNED").length,
      selectedCount: plan.items.filter((i) => i.status === "PLANNED").length,
      skippedCount: plan.items.filter((i) => i.status.startsWith("SKIPPED_")).length,
      deferredCount: plan.items.filter((i) => i.status === "DEFERRED_RATE_LIMIT").length,
      estimatedWclPoints: plan.estimatedWclPoints,
      regionDistribution: plan.regionDistribution,
      specDistribution: plan.specDistribution,
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
      checkpoint,
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
  if (!run?.checkpoint || typeof run.checkpoint !== "object") return null;
  return run.checkpoint as SchedulerCheckpoint;
}
