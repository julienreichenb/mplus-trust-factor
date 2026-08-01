/**
 * API helper: enrich JobStatusDTO with Stage 4 ETA fields when enabled.
 * Never mutates queues or triggers providers.
 */

import type { IngestionJob } from "@mplus/database";
import type { JobStatusDTO, RefreshEtaFields } from "@mplus/contracts";
import { gatherRefreshEtaContext, gatherRefreshEtaFields } from "@mplus/worker";
import type { ApiContainer } from "../container.js";
import { mapJobStatus } from "../lib/mappers.js";

export async function mapJobStatusWithEta(
  container: ApiContainer,
  job: IngestionJob | null,
): Promise<JobStatusDTO | null> {
  if (!job) return null;
  const base = mapJobStatus(job);
  if (!container.env.REFRESH_ETA_ENABLED) {
    return base;
  }

  const eta = await gatherRefreshEtaFields(
    {
      env: container.env,
      prisma: container.worker.prisma,
      redis: container.getAdmissionRedis(),
    },
    job,
  );
  if (!eta) return base;
  return { ...base, ...eta };
}

export async function createAdminEtaApplier(
  container: ApiContainer,
): Promise<((job: IngestionJob) => RefreshEtaFields | null) | null> {
  if (!container.env.REFRESH_ETA_ENABLED) {
    return null;
  }

  const ctx = await gatherRefreshEtaContext({
    env: container.env,
    prisma: container.worker.prisma,
    redis: container.getAdmissionRedis(),
  });
  if (!ctx) return null;
  return (job: IngestionJob) => ctx.apply(job);
}
