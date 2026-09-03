import { onBeforeUnmount, ref } from "vue";
import { api } from "../api/client";
import type { CharacterIdentityInput, RefreshStatusResponse } from "../api/types";

export const NORMAL_REFRESH_POLL_INTERVAL_MS = 60_000;
export const ADMIN_REFRESH_POLL_INTERVAL_MS = 5_000;
export const NORMAL_REFRESH_POLL_MAX_MS = 30 * 60_000;
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
   * Normal users: 60s. Admins may pass a faster interval.
   */
  intervalMs?: number;
}

function isTerminalJobStatus(status: string | undefined): boolean {
  return status === "completed" || status === "failed" || status === "cancelled";
}

/**
 * Queued refresh polling — fixed interval, Page Visibility aware.
 * Immediately fetches once on start; never enqueues refresh work.
 * Continues polling while the tab is hidden so score publication cannot stall
 * in backgrounded / embedded browsers; resumes immediately on visibility.
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
  let visibilityHandler: (() => void) | null = null;

  function clearTimer(): void {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function detachVisibility(): void {
    if (visibilityHandler && typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", visibilityHandler);
    }
    visibilityHandler = null;
  }

  function stop(): void {
    stopped = true;
    polling.value = false;
    clearTimer();
    detachVisibility();
    activeOptions = null;
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

    if (Date.now() - startedAt >= maxDuration) {
      polling.value = false;
      timedOut.value = true;
      clearTimer();
      detachVisibility();
      options.onTimeout?.();
      return;
    }

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
        detachVisibility();
        await options.onComplete(status);
        return;
      }
    } catch {
      /* keep polling on transient errors until timeout */
    }

    if (stopped || activeOptions !== options) return;
    scheduleNext(intervalMs);
  }

  function attachVisibility(): void {
    detachVisibility();
    if (typeof document === "undefined") return;
    visibilityHandler = () => {
      if (stopped || !activeOptions || !polling.value) return;
      if (document.visibilityState === "visible") {
        clearTimer();
        void tick();
      }
    };
    document.addEventListener("visibilitychange", visibilityHandler);
  }

  async function start(options: RefreshPollingOptions): Promise<void> {
    stop();
    stopped = false;
    timedOut.value = false;
    polling.value = true;
    activeOptions = options;
    startedAt = Date.now();
    intervalMs = options.intervalMs ?? NORMAL_REFRESH_POLL_INTERVAL_MS;
    maxDuration =
      options.maxDurationMs ??
      (intervalMs >= NORMAL_REFRESH_POLL_INTERVAL_MS
        ? NORMAL_REFRESH_POLL_MAX_MS
        : ADMIN_REFRESH_POLL_MAX_MS);
    attachVisibility();
    await tick();
  }

  onBeforeUnmount(stop);

  return { polling, timedOut, start, stop };
}
