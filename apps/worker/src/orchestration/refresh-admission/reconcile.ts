/**
 * Reconcile expired Redis leases against durable admission + job state.
 * Never steals a healthy owner that is still renewing.
 */

import type { Logger } from "@mplus/observability";
import { OBS_EVENTS } from "@mplus/observability";
import type { JobRepository } from "../../persistence/job-repository.js";
import type { RefreshAdmissionRepository } from "./repository.js";
import type { RefreshAdmissionGate } from "./gate.js";
import { listExpiredAdmissionOwners, type AdmissionRedis } from "./redis-ops.js";

export async function reconcileExpiredAdmissionLeases(input: {
  redis: AdmissionRedis;
  appEnv: string;
  gate: RefreshAdmissionGate;
  jobRepository: JobRepository;
  admissionRepository: RefreshAdmissionRepository;
  logger?: Logger | null;
  nowMs?: number;
  limit?: number;
}): Promise<{ examined: number; released: number; skippedHealthy: number }> {
  const expiredIds = await listExpiredAdmissionOwners({
    redis: input.redis,
    appEnv: input.appEnv,
    nowMs: input.nowMs,
    limit: input.limit,
  });

  let released = 0;
  let skippedHealthy = 0;

  for (const jobId of expiredIds) {
    const job = await input.jobRepository.findById(jobId);
    const admission = await input.admissionRepository.findByJobId(jobId);

    // Healthy ACTIVE owner without cancel — skip (heartbeat race / clock skew).
    if (
      job &&
      job.status === "ACTIVE" &&
      !job.cancelRequestedAt &&
      admission?.status === "RESERVED"
    ) {
      // Attempt renew; if renew succeeds owner is healthy.
      const renew = await input.gate.tryRenew(jobId, { windowId: admission.windowId });
      if (renew.renewed) {
        skippedHealthy += 1;
        continue;
      }
    }

    const result = await input.gate.tryRelease(jobId, {
      windowId: admission?.windowId,
      status: "EXPIRED",
    });
    if (result.released || result.reason === "RELEASED") {
      released += 1;
      input.logger?.info(
        {
          event: OBS_EVENTS.refreshLeaseExpired,
          jobId,
          releasedPoints: result.releasedPoints,
        },
        OBS_EVENTS.refreshLeaseExpired,
      );
    }
  }

  return { examined: expiredIds.length, released, skippedHealthy };
}
