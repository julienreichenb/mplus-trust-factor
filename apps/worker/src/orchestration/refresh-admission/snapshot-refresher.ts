/**
 * Background WCL rate-snapshot refresher for admission Redis mirror.
 * Must NOT run inside character-refresh admit (admit fails closed on missing/stale).
 *
 * Uses the typed WarcraftLogsRateLimitCapability — never `unknown` casts.
 */

import {
  buildWclRateLimitFetchContext,
  hasWarcraftLogsRateLimitCapability,
  type WarcraftLogsProvider,
} from "@mplus/contracts";
import { deriveWclWindowId } from "@mplus/config";
import type { Logger } from "@mplus/observability";
import {
  readWclAdmissionSnapshot,
  writeWclAdmissionSnapshot,
  type AdmissionRedis,
} from "./redis-ops.js";
import {
  isAdmissionSnapshotFreshForReadiness,
  validateAdmissionRateSnapshot,
} from "./snapshot-validation.js";
import type { RefreshAdmissionRateSnapshot } from "./types.js";

export type SnapshotRefresherStartReason =
  | "started"
  | "mode_off_not_required"
  | "wcl_disabled_not_required"
  | "capability_missing"
  | "initial_refresh_failed"
  | "disabled";

export interface WclAdmissionSnapshotRefresherHandle {
  started: boolean;
  reason: SnapshotRefresherStartReason | string;
  initialSnapshot: RefreshAdmissionRateSnapshot | null;
  stop(): Promise<void>;
}

export interface StartWclAdmissionSnapshotRefresherInput {
  redis: AdmissionRedis;
  appEnv: string;
  warcraftlogs: WarcraftLogsProvider;
  logger?: Logger | null;
  intervalMs: number;
  /**
   * Whether periodic refresh should run.
   * Caller still decides mode/WCL gating; this is the low-level switch.
   */
  enabled: boolean;
  /** Max age used to decide whether a preserved snapshot is still usable after a failed refresh. */
  maxAgeSeconds: number;
  /** Awaited before returning when started. */
  awaitInitial?: boolean;
  /** Bounded wait for in-flight tick on stop (ms). */
  shutdownWaitMs?: number;
}

function mapDecisionToAdmissionSnapshot(decision: {
  snapshot: {
    pointsRemaining: number;
    pointsLimit: number;
    resetAt: string | null;
    fetchedAt: string;
  };
}): RefreshAdmissionRateSnapshot {
  return {
    pointsRemaining: decision.snapshot.pointsRemaining,
    pointsLimit: decision.snapshot.pointsLimit,
    resetAt: decision.snapshot.resetAt,
    fetchedAt: decision.snapshot.fetchedAt,
    windowId: deriveWclWindowId(decision.snapshot.resetAt),
  };
}

/**
 * One-shot refresh: fetch → validate → write.
 * On failure, preserves the last still-fresh valid Redis snapshot (does not clear it).
 */
export async function refreshWclAdmissionSnapshot(input: {
  redis: AdmissionRedis;
  appEnv: string;
  warcraftlogs: WarcraftLogsProvider;
  logger?: Logger | null;
  correlationId?: string;
  maxAgeSeconds: number;
  nowMs?: number;
}): Promise<RefreshAdmissionRateSnapshot | null> {
  if (!hasWarcraftLogsRateLimitCapability(input.warcraftlogs)) {
    input.logger?.warn(
      {
        event: "refresh.admission.snapshot_refresh_failed",
        reason: "capability_missing",
      },
      "refresh.admission.snapshot_refresh_failed",
    );
    return null;
  }

  const existing = await readWclAdmissionSnapshot(input.redis, input.appEnv);
  const nowMs = input.nowMs ?? Date.now();

  try {
    const ctx = buildWclRateLimitFetchContext({
      requestId: input.correlationId ?? `admission-snap-${nowMs}`,
      correlationId: input.correlationId ?? `admission-snap-${nowMs}`,
    });
    const decision = await input.warcraftlogs.fetchRateLimit(ctx);
    const mapped = mapDecisionToAdmissionSnapshot(decision);
    const writeResult = await writeWclAdmissionSnapshot(input.redis, input.appEnv, mapped, {
      nowMs,
    });
    if (!writeResult.written) {
      input.logger?.warn(
        {
          event: "refresh.admission.snapshot_refresh_failed",
          reason: "snapshot_invalid",
          validationReason: writeResult.reason,
        },
        "refresh.admission.snapshot_refresh_failed",
      );
      // Preserve last still-fresh valid snapshot.
      if (
        existing &&
        validateAdmissionRateSnapshot(existing, { nowMs }).ok &&
        isAdmissionSnapshotFreshForReadiness(existing, input.maxAgeSeconds, nowMs)
      ) {
        return existing;
      }
      return null;
    }

    input.logger?.info(
      {
        event: "refresh.admission.snapshot_refreshed",
        pointsRemaining: mapped.pointsRemaining,
        pointsLimit: mapped.pointsLimit,
        windowId: mapped.windowId,
      },
      "refresh.admission.snapshot_refreshed",
    );
    return (await readWclAdmissionSnapshot(input.redis, input.appEnv)) ?? mapped;
  } catch (err) {
    input.logger?.warn(
      { event: "refresh.admission.snapshot_refresh_failed", err },
      "refresh.admission.snapshot_refresh_failed",
    );
    if (
      existing &&
      validateAdmissionRateSnapshot(existing, { nowMs }).ok &&
      isAdmissionSnapshotFreshForReadiness(existing, input.maxAgeSeconds, nowMs)
    ) {
      return existing;
    }
    return null;
  }
}

/**
 * Start the admission snapshot refresher with explicit start state.
 * Never returns an indistinguishable silent no-op.
 *
 * Single-flight: overlapping interval ticks skip with `snapshot_refresh_skipped_inflight`.
 * Uses recursive setTimeout after completion (not overlapping setInterval).
 */
export async function startWclAdmissionSnapshotRefresher(
  input: StartWclAdmissionSnapshotRefresherInput,
): Promise<WclAdmissionSnapshotRefresherHandle> {
  if (!input.enabled) {
    return {
      started: false,
      reason: "disabled",
      initialSnapshot: null,
      async stop() {},
    };
  }

  if (!hasWarcraftLogsRateLimitCapability(input.warcraftlogs)) {
    return {
      started: false,
      reason: "capability_missing",
      initialSnapshot: null,
      async stop() {},
    };
  }

  let stopped = false;
  let inFlight: Promise<RefreshAdmissionRateSnapshot | null> | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const intervalMs = Math.max(50, input.intervalMs);
  const shutdownWaitMs = Math.max(1_000, input.shutdownWaitMs ?? 10_000);
  const capable = input.warcraftlogs;

  const runTick = async (): Promise<RefreshAdmissionRateSnapshot | null> => {
    return refreshWclAdmissionSnapshot({
      redis: input.redis,
      appEnv: input.appEnv,
      warcraftlogs: capable,
      logger: input.logger,
      maxAgeSeconds: input.maxAgeSeconds,
    });
  };

  const scheduleNext = (): void => {
    if (stopped) return;
    timer = setTimeout(() => {
      void (async () => {
        if (stopped) return;
        if (inFlight) {
          input.logger?.info(
            { event: "refresh.admission.snapshot_refresh_skipped_inflight" },
            "snapshot_refresh_skipped_inflight",
          );
          scheduleNext();
          return;
        }
        inFlight = runTick();
        try {
          await inFlight;
        } finally {
          inFlight = null;
        }
        scheduleNext();
      })();
    }, intervalMs);
    if (typeof timer.unref === "function") timer.unref();
  };

  // Start the first refresh immediately and schedule the loop so an early
  // interval tick can hit the in-flight skip path (single-flight).
  inFlight = runTick();
  const initialPromise = inFlight;
  scheduleNext();

  let initialSnapshot: RefreshAdmissionRateSnapshot | null = null;
  if (input.awaitInitial !== false) {
    try {
      initialSnapshot = await initialPromise;
    } finally {
      // Clear only if this promise is still the active inFlight handle.
      if (inFlight === initialPromise) inFlight = null;
    }
    if (!initialSnapshot) {
      stopped = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      return {
        started: false,
        reason: "initial_refresh_failed",
        initialSnapshot: null,
        async stop() {},
      };
    }
  }

  return {
    started: true,
    reason: "started",
    initialSnapshot,
    async stop() {
      stopped = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      if (inFlight) {
        const timeout = new Promise<null>((resolve) => {
          const t = setTimeout(() => resolve(null), shutdownWaitMs);
          if (typeof t.unref === "function") t.unref();
        });
        await Promise.race([inFlight, timeout]);
        inFlight = null;
      }
    },
  };
}

/**
 * High-level bootstrap for worker main: interprets admission mode + WCL flags
 * and returns explicit start state for readiness wiring.
 */
export async function bootstrapWclAdmissionSnapshotRefresher(input: {
  redis: AdmissionRedis;
  appEnv: string;
  warcraftlogs: WarcraftLogsProvider;
  logger?: Logger | null;
  intervalMs: number;
  maxAgeSeconds: number;
  admissionMode: "off" | "shadow" | "enforce";
  wclEnabled: boolean;
  wclDisabledBySet?: boolean;
}): Promise<WclAdmissionSnapshotRefresherHandle> {
  const wclActive = input.wclEnabled && !input.wclDisabledBySet;

  if (input.admissionMode === "off") {
    return {
      started: false,
      reason: "mode_off_not_required",
      initialSnapshot: null,
      async stop() {},
    };
  }

  if (!wclActive) {
    return {
      started: false,
      reason: "wcl_disabled_not_required",
      initialSnapshot: null,
      async stop() {},
    };
  }

  if (!hasWarcraftLogsRateLimitCapability(input.warcraftlogs)) {
    const reason = "capability_missing";
    if (input.admissionMode === "shadow") {
      input.logger?.warn(
        {
          event: "refresh.admission.snapshot_refresher_unavailable",
          reason,
          mode: "shadow",
        },
        "WCL rate-limit capability missing — shadow admission continues without snapshot mirror",
      );
    } else {
      input.logger?.error(
        {
          event: "refresh.admission.snapshot_refresher_unavailable",
          reason,
          mode: "enforce",
        },
        "WCL rate-limit capability missing — enforce mode cannot refresh admission snapshot",
      );
    }
    return {
      started: false,
      reason,
      initialSnapshot: null,
      async stop() {},
    };
  }

  const handle = await startWclAdmissionSnapshotRefresher({
    redis: input.redis,
    appEnv: input.appEnv,
    warcraftlogs: input.warcraftlogs,
    logger: input.logger,
    intervalMs: input.intervalMs,
    enabled: true,
    maxAgeSeconds: input.maxAgeSeconds,
    awaitInitial: true,
  });

  if (!handle.started && input.admissionMode === "shadow") {
    input.logger?.warn(
      {
        event: "refresh.admission.snapshot_refresher_unavailable",
        reason: handle.reason,
        mode: "shadow",
      },
      "initial WCL admission snapshot refresh failed — shadow continues",
    );
  }

  if (!handle.started && input.admissionMode === "enforce") {
    input.logger?.error(
      {
        event: "refresh.admission.snapshot_refresher_unavailable",
        reason: handle.reason,
        mode: "enforce",
      },
      "initial WCL admission snapshot refresh failed — worker must not report ready",
    );
  }

  return handle;
}
