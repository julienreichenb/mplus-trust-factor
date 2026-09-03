import { onBeforeUnmount, ref } from "vue";
import { api } from "../api/client";
import type { CharacterIdentityInput, RefreshStatusResponse } from "../api/types";

/** Background refresh when a published score already exists (stale-while-revalidate). */
export const NORMAL_REFRESH_POLL_INTERVAL_MS = 60_000;
/** Interactive first-score wait — short enough for the loading panel. */
export const FIRST_SCORE_POLL_INTERVAL_MS = 5_000;
export const ADMIN_REFRESH_POLL_INTERVAL_MS = 5_000;
export const NORMAL_REFRESH_POLL_MAX_MS = 30 * 60_000;
export const FIRST_SCORE_POLL_MAX_MS = 30 * 60_000;
export const ADMIN_REFRESH_POLL_MAX_MS = 5 * 60_000;

export interface RefreshPollingOptions {
  identity: CharacterIdentityInput;
  onUpdate: (status: RefreshStatusResponse) => void;
  onComplete: (status: RefreshStatusResponse) => void;
  /** Called when polling hits the bounded timeout without a terminal status. */
  onTimeout?: () => void;
  maxDurationMs?: number;
  /**
   * Fixed poll interval after the immediate first fetch.
   * First-score wait: 5s. Background refresh: 60s. Admins may pass a faster interval.
   */
  intervalMs?: number;
}

function isTerminalJobStatus(status: string | undefined): boolean {
  return status === "completed" || status === "failed" || status === "cancelled";
}

/**
 * Queued refresh polling — fixed interval, single in-flight GET.
 * Immediately fetches once on start; never enqueues refresh work.
 * Continues while the tab is hidden so score publication cannot stall.
 * Clears timers on stop / unmount; does not create duplicate timers.
 * CANCELLED jobs are terminal (same as completed/failed) and stop polling.
 */
export function useRefreshPolling() {
  const polling = ref(false);
  const timedOut = ref(false);
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  let startedAt = 0;
  let maxDuration = NORMAL_REFRESH_POLL_MAX_MS;
  let intervalMs = NORMAL_REFRESH_POLL_INTERVAL_MS;
  let activeOptions: RefreshPollingOptions | null = null;
  /** At most one getRefreshStatus request at a time. */
  let requestInFlight = false;
  /** Coalesce ticks that arrive while a request is in flight. */
  let pendingTick = false;

  function clearTimer(): void {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function stop(): void {
    stopped = true;
    polling.value = false;
    clearTimer();
    activeOptions = null;
    requestInFlight = false;
    pendingTick = false;
  }

  function scheduleNext(delay: number): void {
    clearTimer();
    if (stopped) return;
    timer = setTimeout(() => {
      void tick();
    }, delay);
  }

  async function tick(): Promise<void> {
    const options = activeOptions;
    if (stopped || !options) return;

    if (requestInFlight) {
      pendingTick = true;
      return;
    }

    if (Date.now() - startedAt >= maxDuration) {
      polling.value = false;
      timedOut.value = true;
      clearTimer();
      options.onTimeout?.();
      return;
    }

    requestInFlight = true;
    try {
      const status = await api.getRefreshStatus(options.identity);
      if (stopped || activeOptions !== options) return;
      options.onUpdate(status);
      const jobTerminal = isTerminalJobStatus(status.job?.status);
      if (
        status.refreshStatus === "FRESH" ||
        status.refreshStatus === "FAILED" ||
        status.refreshStatus === "STALE" ||
        jobTerminal
      ) {
        polling.value = false;
        clearTimer();
        pendingTick = false;
        await options.onComplete(status);
        return;
      }
    } catch {
      /* keep polling on transient errors until timeout */
    } finally {
      requestInFlight = false;
    }

    if (stopped || activeOptions !== options) return;

    if (pendingTick) {
      pendingTick = false;
      scheduleNext(0);
      return;
    }
    scheduleNext(intervalMs);
  }

  async function start(options: RefreshPollingOptions): Promise<void> {
    stop();
    stopped = false;
    timedOut.value = false;
    polling.value = true;
    activeOptions = options;
    startedAt = Date.now();
    intervalMs = options.intervalMs ?? NORMAL_REFRESH_POLL_INTERVAL_MS;
    maxDuration = options.maxDurationMs ?? NORMAL_REFRESH_POLL_MAX_MS;
    await tick();
  }

  onBeforeUnmount(stop);

  return { polling, timedOut, start, stop };
}
