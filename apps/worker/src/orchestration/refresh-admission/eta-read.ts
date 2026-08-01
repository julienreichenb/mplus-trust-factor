/**
 * Gather refresh ETA facts from Redis admission state + Postgres job rows.
 * Read-only — never reserves, releases, enqueues, or calls providers.
 */

import {
  buildRefreshAdmissionConfig,
  effectiveAdmissionGlobalConcurrency,
  isWclSnapshotFresh,
  type AppEnv,
} from "@mplus/config";
import type { IngestionJob, PrismaClient } from "@mplus/database";
import type { RefreshEtaFields } from "@mplus/contracts";
import {
  computeRefreshEta,
  REFRESH_ETA_THROUGHPUT_WINDOW_SECONDS,
  type RefreshEtaJobRef,
} from "./eta-compute.js";
import {
  readActiveGlobalSlots,
  readSchedulingState,
  readWclAdmissionSnapshot,
  type AdmissionRedis,
} from "./redis-ops.js";
import type { RefreshSchedulingState } from "./types.js";

export interface RefreshEtaGatherDeps {
  env: AppEnv;
  prisma: PrismaClient;
  redis?: AdmissionRedis | null;
  nowMs?: number;
}

function toJobRef(job: Pick<
  IngestionJob,
  "id" | "status" | "priority" | "scheduledAt" | "cancelRequestedAt"
>): RefreshEtaJobRef {
  return {
    id: job.id,
    status: job.status,
    priority: job.priority,
    scheduledAt: job.scheduledAt,
    cancelRequestedAt: job.cancelRequestedAt,
  };
}

function isEligibleInFlight(
  job: Pick<IngestionJob, "status" | "cancelRequestedAt" | "jobType">,
): boolean {
  if (job.jobType !== "refresh-character") return false;
  if (job.status !== "QUEUED" && job.status !== "ACTIVE") return false;
  if (job.cancelRequestedAt) return false;
  return true;
}

/**
 * Load eligible in-flight refresh jobs + recent completions (bounded).
 *
 * Indexes:
 * - in-flight: @@index([jobType, status, scheduledAt])
 * - completions: @@index([jobType, status, completedAt]) — additive Stage 4 index so
 *   polled ETA reads use an index range + LIMIT instead of an unbounded completedAt scan.
 */
export async function loadRefreshEtaJobEvidence(
  prisma: PrismaClient,
  options?: { nowMs?: number; throughputWindowSeconds?: number; completionTake?: number },
): Promise<{
  eligibleInFlight: RefreshEtaJobRef[];
  recentCompletions: Array<{ startedAt: Date | null; completedAt: Date }>;
  activeJobCount: number;
}> {
  const nowMs = options?.nowMs ?? Date.now();
  const windowSeconds = options?.throughputWindowSeconds ?? REFRESH_ETA_THROUGHPUT_WINDOW_SECONDS;
  const since = new Date(nowMs - windowSeconds * 1000);
  const take = Math.min(200, Math.max(20, options?.completionTake ?? 100));

  const [inFlight, completions] = await Promise.all([
    prisma.ingestionJob.findMany({
      where: {
        jobType: "refresh-character",
        status: { in: ["QUEUED", "ACTIVE"] },
      },
      select: {
        id: true,
        status: true,
        priority: true,
        scheduledAt: true,
        cancelRequestedAt: true,
        jobType: true,
      },
      orderBy: [{ priority: "desc" }, { scheduledAt: "asc" }],
      take: 2_000,
    }),
    prisma.ingestionJob.findMany({
      where: {
        jobType: "refresh-character",
        status: "COMPLETED",
        completedAt: { gte: since },
      },
      select: {
        startedAt: true,
        completedAt: true,
      },
      // Uses ingestion_jobs_job_type_status_completed_at_idx (jobType, status, completedAt).
      orderBy: { completedAt: "desc" },
      take,
    }),
  ]);

  const eligibleInFlight = inFlight.filter(isEligibleInFlight).map(toJobRef);
  const activeJobCount = eligibleInFlight.filter((j) => j.status === "ACTIVE").length;
  const recentCompletions = completions
    .filter((c): c is { startedAt: Date | null; completedAt: Date } => c.completedAt != null)
    .map((c) => ({ startedAt: c.startedAt, completedAt: c.completedAt }));

  return { eligibleInFlight, recentCompletions, activeJobCount };
}

async function readRedisSchedulingFacts(
  redis: AdmissionRedis,
  appEnv: string,
  config: ReturnType<typeof buildRefreshAdmissionConfig>,
  nowMs: number,
): Promise<{
  schedulingState: RefreshSchedulingState;
  activeRefreshCount: number;
  wclAdmitBlocked: boolean;
}> {
  const [schedulingState, slotCount, snapshot] = await Promise.all([
    readSchedulingState(redis, appEnv),
    readActiveGlobalSlots(redis, appEnv),
    readWclAdmissionSnapshot(redis, appEnv),
  ]);

  let wclAdmitBlocked = false;
  if (!snapshot) {
    // Missing snapshot: treat as blocked for ETA confidence when admission enforce is on.
    wclAdmitBlocked = config.mode === "enforce";
  } else {
    const fresh = isWclSnapshotFresh({
      fetchedAt: snapshot.fetchedAt,
      maxAgeSeconds: config.wclSnapshotMaxAgeSeconds,
      nowMs,
    });
    if (!fresh || !Number.isFinite(snapshot.pointsLimit) || snapshot.pointsLimit <= 0) {
      wclAdmitBlocked = true;
    }
  }

  return {
    schedulingState,
    activeRefreshCount: slotCount,
    wclAdmitBlocked,
  };
}

/**
 * Build public ETA fields for a single job (or global scheduling snapshot when job is null).
 * Returns null when REFRESH_ETA_ENABLED is false (caller should omit fields).
 */
export async function gatherRefreshEtaFields(
  deps: RefreshEtaGatherDeps,
  job: Pick<
    IngestionJob,
    "id" | "status" | "priority" | "scheduledAt" | "cancelRequestedAt" | "jobType"
  > | null,
): Promise<RefreshEtaFields | null> {
  const config = buildRefreshAdmissionConfig(deps.env);
  if (!config.etaEnabled) {
    return null;
  }

  const nowMs = deps.nowMs ?? Date.now();
  const evidence = await loadRefreshEtaJobEvidence(deps.prisma, { nowMs });

  let schedulingState: RefreshSchedulingState = "RUNNING";
  let activeRefreshCount = evidence.activeJobCount;
  let wclAdmitBlocked = false;

  if (deps.redis) {
    try {
      const redisFacts = await readRedisSchedulingFacts(
        deps.redis,
        deps.env.APP_ENV,
        config,
        nowMs,
      );
      schedulingState = redisFacts.schedulingState;
      // Prefer Redis admitted slots when enforce has been writing them; otherwise ACTIVE count.
      if (config.mode === "enforce" || redisFacts.activeRefreshCount > 0) {
        activeRefreshCount = redisFacts.activeRefreshCount;
      }
      wclAdmitBlocked = redisFacts.wclAdmitBlocked;
    } catch {
      // Redis read failures must not break refresh-status — degrade to LOW confidence facts.
      wclAdmitBlocked = config.mode === "enforce";
    }
  } else if (config.mode === "enforce") {
    wclAdmitBlocked = true;
  }

  const computation = computeRefreshEta({
    job: job && isEligibleInFlight(job) ? toJobRef(job) : job ? toJobRef(job) : null,
    eligibleInFlight: evidence.eligibleInFlight,
    recentCompletions: evidence.recentCompletions,
    schedulingState,
    activeRefreshCount,
    globalConcurrencyLimit: effectiveAdmissionGlobalConcurrency(config),
    wclAdmitBlocked,
    nowMs,
  });

  return {
    activeRefreshCount: computation.activeRefreshCount,
    effectiveWorkerCapacity: computation.effectiveWorkerCapacity,
    observedThroughput: computation.observedThroughput,
    queuePosition: computation.queuePosition,
    estimatedWaitSeconds: computation.estimatedWaitSeconds,
    estimateConfidence: computation.estimateConfidence,
    schedulingState: computation.schedulingState,
  };
}

/**
 * Shared gather for admin list: one Redis/Postgres read, then per-job positions.
 */
export async function gatherRefreshEtaContext(deps: RefreshEtaGatherDeps): Promise<{
  enabled: boolean;
  apply(job: Pick<
    IngestionJob,
    "id" | "status" | "priority" | "scheduledAt" | "cancelRequestedAt" | "jobType"
  >): RefreshEtaFields | null;
} | null> {
  const config = buildRefreshAdmissionConfig(deps.env);
  if (!config.etaEnabled) {
    return null;
  }

  const nowMs = deps.nowMs ?? Date.now();
  const evidence = await loadRefreshEtaJobEvidence(deps.prisma, { nowMs });

  let schedulingState: RefreshSchedulingState = "RUNNING";
  let activeRefreshCount = evidence.activeJobCount;
  let wclAdmitBlocked = false;

  if (deps.redis) {
    try {
      const redisFacts = await readRedisSchedulingFacts(
        deps.redis,
        deps.env.APP_ENV,
        config,
        nowMs,
      );
      schedulingState = redisFacts.schedulingState;
      if (config.mode === "enforce" || redisFacts.activeRefreshCount > 0) {
        activeRefreshCount = redisFacts.activeRefreshCount;
      }
      wclAdmitBlocked = redisFacts.wclAdmitBlocked;
    } catch {
      wclAdmitBlocked = config.mode === "enforce";
    }
  } else if (config.mode === "enforce") {
    wclAdmitBlocked = true;
  }

  const globalConcurrencyLimit = effectiveAdmissionGlobalConcurrency(config);

  return {
    enabled: true,
    apply(job) {
      const computation = computeRefreshEta({
        job: toJobRef(job),
        eligibleInFlight: evidence.eligibleInFlight,
        recentCompletions: evidence.recentCompletions,
        schedulingState,
        activeRefreshCount,
        globalConcurrencyLimit,
        wclAdmitBlocked,
        nowMs,
      });
      return {
        activeRefreshCount: computation.activeRefreshCount,
        effectiveWorkerCapacity: computation.effectiveWorkerCapacity,
        observedThroughput: computation.observedThroughput,
        queuePosition: computation.queuePosition,
        estimatedWaitSeconds: computation.estimatedWaitSeconds,
        estimateConfidence: computation.estimateConfidence,
        schedulingState: computation.schedulingState,
      };
    },
  };
}
