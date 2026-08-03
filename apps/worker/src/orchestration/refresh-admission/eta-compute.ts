/**
 * Pure refresh ETA / scheduling read-model computation (Stage 4).
 * Throughput-based wait; never uses activeRefreshCount alone as capacity denominator.
 * See doc/architecture/parallel-refresh-scheduling.md §12.
 */

import type { EstimateConfidence, RefreshSchedulingState } from "@mplus/contracts";

/** Coarse wait buckets (seconds) — never claim second-by-second precision. */
export const REFRESH_ETA_WAIT_BUCKETS_SECONDS = [
  0, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200,
] as const;

/** Default moving window for completion throughput. */
export const REFRESH_ETA_THROUGHPUT_WINDOW_SECONDS = 15 * 60;

/** Minimum completions in the window for throughput-based estimates. */
export const REFRESH_ETA_MIN_THROUGHPUT_SAMPLES = 3;

/** Strong sample count for HIGH confidence (when otherwise healthy). */
export const REFRESH_ETA_HIGH_THROUGHPUT_SAMPLES = 10;

/** Fallback mean job duration when throughput samples are thin (seconds). */
export const REFRESH_ETA_DEFAULT_DURATION_SECONDS = 90;

export interface RefreshEtaJobRef {
  id: string;
  status: "QUEUED" | "ACTIVE" | string;
  priority: number;
  scheduledAt: Date | string | number;
  cancelRequestedAt?: Date | string | number | null;
}

export interface RefreshEtaCompletionSample {
  startedAt: Date | string | number | null;
  completedAt: Date | string | number;
}

export interface ComputeRefreshEtaInput {
  job: RefreshEtaJobRef | null;
  /** Eligible non-terminal refresh jobs (caller already filtered cancel-requested). */
  eligibleInFlight: RefreshEtaJobRef[];
  /** Recent COMPLETED refresh jobs (bounded). */
  recentCompletions: RefreshEtaCompletionSample[];
  schedulingState: RefreshSchedulingState;
  /** Redis admitted slots when available; else ACTIVE count. */
  activeRefreshCount: number;
  /** Configured effective global concurrency (serial 1 until concurrency activation). */
  globalConcurrencyLimit: number;
  /** WCL snapshot missing/stale or admit blocked indefinitely for WCL-heavy work. */
  wclAdmitBlocked?: boolean;
  /** Throughput window length in seconds. */
  throughputWindowSeconds?: number;
  nowMs?: number;
}

export interface RefreshEtaComputation {
  activeRefreshCount: number;
  effectiveWorkerCapacity: number;
  observedThroughput: number | null;
  queuePosition: number | null;
  estimatedWaitSeconds: number | null;
  estimateConfidence: EstimateConfidence;
  schedulingState: RefreshSchedulingState;
  /** Diagnostic — not a public DTO field. */
  reason: string;
}

function toMs(value: Date | string | number | null | undefined): number | null {
  if (value == null) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

/** Map raw seconds into the next coarse bucket. */
export function bucketEstimatedWaitSeconds(rawSeconds: number): number {
  if (!Number.isFinite(rawSeconds) || rawSeconds <= 0) return 0;
  for (const bucket of REFRESH_ETA_WAIT_BUCKETS_SECONDS) {
    if (rawSeconds <= bucket) return bucket;
  }
  return REFRESH_ETA_WAIT_BUCKETS_SECONDS[REFRESH_ETA_WAIT_BUCKETS_SECONDS.length - 1]!;
}

/**
 * Whether candidate is expected ahead of target.
 *
 * Ordering rules:
 * 1. Any ACTIVE job is always ahead of any QUEUED job (already executing — cannot be overtaken).
 * 2. Among ACTIVE jobs: earlier scheduledAt, then id.
 * 3. Among QUEUED (waiting) jobs only: higher DB priority, then earlier scheduledAt, then id.
 *
 * Priority must never pretend a queued high-priority job can overtake work already executing.
 */
export function isRefreshJobAheadOf(
  candidate: RefreshEtaJobRef,
  target: RefreshEtaJobRef,
): boolean {
  if (candidate.id === target.id) return false;

  const candidateActive = candidate.status === "ACTIVE";
  const targetActive = target.status === "ACTIVE";

  // Executing work always precedes waiting work, regardless of DB priority.
  if (candidateActive && !targetActive) return true;
  if (!candidateActive && targetActive) return false;

  if (candidateActive && targetActive) {
    const cStart = toMs(candidate.scheduledAt) ?? 0;
    const tStart = toMs(target.scheduledAt) ?? 0;
    if (cStart !== tStart) return cStart < tStart;
    return candidate.id < target.id;
  }

  // Waiting jobs only: priority then FIFO scheduledAt.
  if (candidate.priority !== target.priority) {
    return candidate.priority > target.priority;
  }
  const cSched = toMs(candidate.scheduledAt) ?? 0;
  const tSched = toMs(target.scheduledAt) ?? 0;
  if (cSched !== tSched) return cSched < tSched;
  return candidate.id < target.id;
}

/**
 * Approximate eligible jobs ahead of `job` (0 when already ACTIVE / missing).
 * Priority-aware using durable DB weights — does not require BullMQ priority.
 */
export function countQueuePosition(
  job: RefreshEtaJobRef | null,
  eligibleInFlight: RefreshEtaJobRef[],
): number | null {
  if (!job) return null;
  if (job.cancelRequestedAt) return null;
  if (job.status === "ACTIVE") return 0;
  if (job.status !== "QUEUED") return null;

  let ahead = 0;
  for (const other of eligibleInFlight) {
    if (other.id === job.id) continue;
    if (other.cancelRequestedAt) continue;
    if (other.status !== "QUEUED" && other.status !== "ACTIVE") continue;
    if (isRefreshJobAheadOf(other, job)) ahead += 1;
  }
  return ahead;
}

export function computeObservedThroughput(input: {
  completions: RefreshEtaCompletionSample[];
  windowSeconds: number;
  nowMs: number;
}): { throughputPerSecond: number | null; sampleCount: number; meanDurationSeconds: number | null } {
  const windowMs = Math.max(1, Math.floor(input.windowSeconds)) * 1000;
  const since = input.nowMs - windowMs;
  const inWindow: RefreshEtaCompletionSample[] = [];
  const durations: number[] = [];

  for (const sample of input.completions) {
    const completedMs = toMs(sample.completedAt);
    if (completedMs == null || completedMs < since || completedMs > input.nowMs) continue;
    inWindow.push(sample);
    const startedMs = toMs(sample.startedAt);
    if (startedMs != null && completedMs >= startedMs) {
      durations.push((completedMs - startedMs) / 1000);
    }
  }

  const sampleCount = inWindow.length;
  const meanDurationSeconds =
    durations.length > 0
      ? durations.reduce((sum, d) => sum + d, 0) / durations.length
      : null;

  if (sampleCount < REFRESH_ETA_MIN_THROUGHPUT_SAMPLES) {
    return { throughputPerSecond: null, sampleCount, meanDurationSeconds };
  }

  const throughputPerSecond = sampleCount / (windowMs / 1000);
  return { throughputPerSecond, sampleCount, meanDurationSeconds };
}

function schedulingBlocksEta(state: RefreshSchedulingState): boolean {
  return (
    state === "PAUSED" ||
    state === "DRAINING" ||
    state === "RATE_LIMITED" ||
    state === "CIRCUIT_OPEN"
  );
}

function stepDownConfidence(confidence: EstimateConfidence): EstimateConfidence {
  if (confidence === "HIGH") return "MEDIUM";
  if (confidence === "MEDIUM") return "LOW";
  return "LOW";
}

/**
 * Compute the Stage 4 refresh ETA read model from gathered facts.
 * Read-only: never mutates queues, Redis admission, or providers.
 */
export function computeRefreshEta(input: ComputeRefreshEtaInput): RefreshEtaComputation {
  const nowMs = input.nowMs ?? Date.now();
  const windowSeconds = input.throughputWindowSeconds ?? REFRESH_ETA_THROUGHPUT_WINDOW_SECONDS;
  const schedulingState = input.schedulingState;
  const activeRefreshCount = Math.max(0, Math.floor(input.activeRefreshCount));
  const globalLimit = Math.max(1, Math.floor(input.globalConcurrencyLimit));

  const healthyCapacity =
    schedulingState === "RUNNING" && !input.wclAdmitBlocked
      ? Math.max(0, globalLimit - activeRefreshCount)
      : 0;

  const queuePositionRaw = countQueuePosition(input.job, input.eligibleInFlight);
  // Defensive: a QUEUED job must count at least the occupied slots ahead when
  // activeRefreshCount says the worker is busy (never claim position 0 / wait 0).
  let queuePosition = queuePositionRaw;
  if (
    input.job?.status === "QUEUED" &&
    activeRefreshCount > 0 &&
    queuePosition != null &&
    queuePosition < activeRefreshCount
  ) {
    queuePosition = activeRefreshCount;
  }

  const { throughputPerSecond, sampleCount, meanDurationSeconds } = computeObservedThroughput({
    completions: input.recentCompletions,
    windowSeconds,
    nowMs,
  });

  const base: RefreshEtaComputation = {
    activeRefreshCount,
    effectiveWorkerCapacity: healthyCapacity,
    observedThroughput: throughputPerSecond,
    queuePosition,
    estimatedWaitSeconds: null,
    estimateConfidence: "LOW",
    schedulingState,
    reason: "init",
  };

  if (schedulingBlocksEta(schedulingState)) {
    return { ...base, estimatedWaitSeconds: null, estimateConfidence: "LOW", reason: `scheduling_${schedulingState}` };
  }

  if (input.wclAdmitBlocked) {
    return {
      ...base,
      effectiveWorkerCapacity: 0,
      estimatedWaitSeconds: null,
      estimateConfidence: "LOW",
      reason: "wcl_admit_blocked",
    };
  }

  if (queuePosition == null) {
    return { ...base, reason: "no_queue_position" };
  }

  // Already running, or next with free capacity — only when nothing is occupying slots ahead.
  if (queuePosition === 0 && healthyCapacity > 0 && activeRefreshCount === 0) {
    let confidence: EstimateConfidence =
      sampleCount >= REFRESH_ETA_HIGH_THROUGHPUT_SAMPLES
        ? "HIGH"
        : sampleCount >= REFRESH_ETA_MIN_THROUGHPUT_SAMPLES
          ? "MEDIUM"
          : "MEDIUM";
    if (input.job && input.job.priority < 0) {
      confidence = stepDownConfidence(confidence);
    }
    return {
      ...base,
      estimatedWaitSeconds: 0,
      estimateConfidence: confidence,
      reason: "ready_or_active",
    };
  }

  // ACTIVE job holding the only slot: wait is effectively now (already executing).
  if (input.job?.status === "ACTIVE" && queuePosition === 0) {
    const confidence: EstimateConfidence =
      sampleCount >= REFRESH_ETA_HIGH_THROUGHPUT_SAMPLES
        ? "HIGH"
        : sampleCount >= REFRESH_ETA_MIN_THROUGHPUT_SAMPLES
          ? "MEDIUM"
          : "MEDIUM";
    return {
      ...base,
      estimatedWaitSeconds: 0,
      estimateConfidence: confidence,
      reason: "already_active",
    };
  }

  let rawWait: number | null = null;
  let confidence: EstimateConfidence = "LOW";
  let reason = "insufficient_evidence";

  if (throughputPerSecond != null && throughputPerSecond > 0) {
    rawWait = queuePosition / throughputPerSecond;
    confidence =
      sampleCount >= REFRESH_ETA_HIGH_THROUGHPUT_SAMPLES ? "HIGH" : "MEDIUM";
    reason = "throughput";
  } else if (healthyCapacity > 0) {
    const duration =
      meanDurationSeconds != null && meanDurationSeconds > 0
        ? meanDurationSeconds
        : sampleCount > 0
          ? REFRESH_ETA_DEFAULT_DURATION_SECONDS
          : null;
    if (duration != null) {
      rawWait = (queuePosition / healthyCapacity) * duration;
      confidence = sampleCount > 0 ? "MEDIUM" : "LOW";
      reason = sampleCount > 0 ? "duration_ema_fallback" : "default_duration_fallback";
    } else if (activeRefreshCount === 0) {
      rawWait = 0;
      confidence = "MEDIUM";
      reason = "idle_capacity";
    }
  } else if (queuePosition > 0) {
    // Worker capacity exhausted (e.g. serial concurrency 1 occupied): estimate from
    // jobs ahead × duration — never claim zero wait while work is already executing.
    const duration =
      meanDurationSeconds != null && meanDurationSeconds > 0
        ? meanDurationSeconds
        : REFRESH_ETA_DEFAULT_DURATION_SECONDS;
    rawWait = queuePosition * duration;
    confidence = sampleCount >= REFRESH_ETA_MIN_THROUGHPUT_SAMPLES ? "MEDIUM" : "LOW";
    reason = "occupied_duration_fallback";
  }

  if (rawWait == null) {
    return { ...base, estimatedWaitSeconds: null, estimateConfidence: "LOW", reason };
  }

  // Queued work with jobs ahead must never bucket to a zero wait.
  if (queuePosition > 0 && rawWait <= 0) {
    rawWait = REFRESH_ETA_WAIT_BUCKETS_SECONDS[1] ?? 30;
  }

  // Low-priority jobs may be overtaken — never claim HIGH.
  if (input.job && input.job.priority < 0) {
    confidence = confidence === "HIGH" ? "MEDIUM" : stepDownConfidence(confidence);
    reason = `${reason}_low_priority`;
  }

  // Heterogeneous / thin evidence: if we used default duration with no samples, stay LOW.
  if (reason === "default_duration_fallback" || reason === "occupied_duration_fallback") {
    if (sampleCount < REFRESH_ETA_MIN_THROUGHPUT_SAMPLES) {
      confidence = "LOW";
    }
  }

  return {
    ...base,
    estimatedWaitSeconds: bucketEstimatedWaitSeconds(rawWait),
    estimateConfidence: confidence,
    reason,
  };
}
