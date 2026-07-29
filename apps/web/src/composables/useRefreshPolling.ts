import { onBeforeUnmount, ref } from "vue";
import { api } from "../api/client";
import type { CharacterIdentityInput, RefreshStatusResponse } from "../api/types";

export interface RefreshPollingOptions {
  identity: CharacterIdentityInput;
  onUpdate: (status: RefreshStatusResponse) => void;
  onComplete: (status: RefreshStatusResponse) => void;
  /** Called when polling hits the bounded timeout without a terminal status. */
  onTimeout?: () => void;
  maxDurationMs?: number;
}

/**
 * Queued refresh polling with exponential backoff and stop conditions.
 * Never leaves an infinite spinner — timeout always clears `polling`.
 */
export function useRefreshPolling() {
  const polling = ref(false);
  const timedOut = ref(false);
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

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
  }

  async function start(options: RefreshPollingOptions): Promise<void> {
    stop();
    stopped = false;
    timedOut.value = false;
    polling.value = true;
    const startedAt = Date.now();
    const maxDuration = options.maxDurationMs ?? 90_000;
    let delayMs = 1000;

    const tick = async (): Promise<void> => {
      if (stopped) return;
      if (Date.now() - startedAt > maxDuration) {
        polling.value = false;
        timedOut.value = true;
        options.onTimeout?.();
        return;
      }
      try {
        const status = await api.getRefreshStatus(options.identity);
        if (stopped) return;
        options.onUpdate(status);
        const jobTerminal =
          status.job?.status === "completed" || status.job?.status === "failed";
        if (
          status.refreshStatus === "FRESH" ||
          status.refreshStatus === "FAILED" ||
          status.refreshStatus === "STALE" ||
          jobTerminal
        ) {
          polling.value = false;
          options.onComplete(status);
          return;
        }
      } catch {
        /* keep polling on transient errors until timeout */
      }
      if (stopped) return;
      timer = setTimeout(() => {
        void tick();
      }, delayMs);
      delayMs = Math.min(delayMs * 2, 8000);
    };

    await tick();
  }

  onBeforeUnmount(stop);

  return { polling, timedOut, start, stop };
}
