/**
 * Background WCL rate-snapshot refresher for admission Redis mirror.
 * Must NOT run inside character-refresh admit (admit fails closed on missing/stale).
 */

import { deriveWclWindowId } from "@mplus/config";
import type { Logger } from "@mplus/observability";
import {
  writeWclAdmissionSnapshot,
  type AdmissionRedis,
} from "./redis-ops.js";
import type { RefreshAdmissionRateSnapshot } from "./types.js";

export interface AdmissionRateLimitFetcher {
  fetchRateLimit: (ctx: {
    requestId: string;
    correlationId: string;
    requestedAt: string;
  }) => Promise<{
    snapshot: {
      pointsRemaining: number;
      limitPerHour: number;
      resetAt: string | null;
      fetchedAt: string;
    };
    action?: string;
  }>;
}

export async function refreshWclAdmissionSnapshot(input: {
  redis: AdmissionRedis;
  appEnv: string;
  warcraftlogs: AdmissionRateLimitFetcher;
  logger?: Logger | null;
  correlationId?: string;
}): Promise<RefreshAdmissionRateSnapshot | null> {
  try {
    const decision = await input.warcraftlogs.fetchRateLimit({
      requestId: input.correlationId ?? `admission-snap-${Date.now()}`,
      correlationId: input.correlationId ?? `admission-snap-${Date.now()}`,
      requestedAt: new Date().toISOString(),
    });
    const snap = decision.snapshot;
    const mapped: RefreshAdmissionRateSnapshot = {
      pointsRemaining: snap.pointsRemaining,
      pointsLimit: snap.limitPerHour,
      resetAt: snap.resetAt,
      fetchedAt: snap.fetchedAt,
      windowId: deriveWclWindowId(snap.resetAt),
    };
    await writeWclAdmissionSnapshot(input.redis, input.appEnv, mapped);
    input.logger?.info(
      {
        event: "refresh.admission.snapshot_refreshed",
        pointsRemaining: mapped.pointsRemaining,
        pointsLimit: mapped.pointsLimit,
        windowId: mapped.windowId,
      },
      "refresh.admission.snapshot_refreshed",
    );
    return mapped;
  } catch (err) {
    input.logger?.warn(
      { event: "refresh.admission.snapshot_refresh_failed", err },
      "refresh.admission.snapshot_refresh_failed",
    );
    return null;
  }
}

export function startWclAdmissionSnapshotRefresher(input: {
  redis: AdmissionRedis;
  appEnv: string;
  warcraftlogs: unknown;
  logger?: Logger | null;
  intervalMs: number;
  enabled: boolean;
}): { stop(): void } {
  const fetcher = input.warcraftlogs as Partial<AdmissionRateLimitFetcher>;
  if (!input.enabled || typeof fetcher.fetchRateLimit !== "function") {
    return { stop() {} };
  }
  const tick = () => {
    void refreshWclAdmissionSnapshot({
      redis: input.redis,
      appEnv: input.appEnv,
      warcraftlogs: fetcher as AdmissionRateLimitFetcher,
      logger: input.logger,
    });
  };
  tick();
  const timer = setInterval(tick, Math.max(5_000, input.intervalMs));
  if (typeof timer.unref === "function") timer.unref();
  return {
    stop() {
      clearInterval(timer);
    },
  };
}
