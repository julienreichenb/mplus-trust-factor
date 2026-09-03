import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { defineComponent, nextTick } from "vue";
import { mount, flushPromises } from "@vue/test-utils";
import {
  ADMIN_REFRESH_POLL_INTERVAL_MS,
  FIRST_SCORE_POLL_INTERVAL_MS,
  NORMAL_REFRESH_POLL_INTERVAL_MS,
  useRefreshPolling,
} from "./useRefreshPolling";
import type { RefreshStatusResponse } from "../api/types";

vi.mock("../api/client", () => ({
  api: {
    getRefreshStatus: vi.fn(),
  },
}));

import { api } from "../api/client";

const identity = { region: "EU" as const, realmSlug: "tarren-mill", name: "Aleria" };

function status(partial: Partial<RefreshStatusResponse>): RefreshStatusResponse {
  return {
    characterId: "char-1",
    refreshStatus: "QUEUED",
    job: null,
    cooldownSecondsRemaining: 0,
    ...partial,
  };
}

function mountPollingHarness() {
  let apiHandle: ReturnType<typeof useRefreshPolling> | null = null;
  const Comp = defineComponent({
    setup() {
      apiHandle = useRefreshPolling();
      return () => null;
    },
  });
  const wrapper = mount(Comp);
  return {
    wrapper,
    get api() {
      return apiHandle!;
    },
  };
}

describe("useRefreshPolling", () => {
  beforeEach(() => {
    vi.mocked(api.getRefreshStatus).mockReset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("stops on FRESH and invokes onComplete", async () => {
    const getRefreshStatus = vi.mocked(api.getRefreshStatus);
    getRefreshStatus
      .mockResolvedValueOnce(
        status({
          refreshStatus: "QUEUED",
          job: {
            jobId: "1",
            queue: "refresh-character",
            status: "queued",
            dedupeKey: null,
            createdAt: "",
            startedAt: null,
            finishedAt: null,
            errorMessage: null,
          },
        }),
      )
      .mockResolvedValueOnce(
        status({
          refreshStatus: "IN_PROGRESS",
          job: {
            jobId: "1",
            queue: "refresh-character",
            status: "active",
            dedupeKey: null,
            createdAt: "",
            startedAt: "",
            finishedAt: null,
            errorMessage: null,
          },
        }),
      )
      .mockResolvedValueOnce(
        status({
          refreshStatus: "FRESH",
          job: {
            jobId: "1",
            queue: "refresh-character",
            status: "completed",
            dedupeKey: null,
            createdAt: "",
            startedAt: "",
            finishedAt: "",
            errorMessage: null,
          },
        }),
      );

    const updates: string[] = [];
    const { api: pollingApi, wrapper } = mountPollingHarness();
    const done = new Promise<void>((resolve) => {
      void pollingApi.start({
        identity,
        intervalMs: 1000,
        maxDurationMs: 10_000,
        onUpdate: (s) => updates.push(s.refreshStatus),
        onComplete: (s) => {
          expect(s.refreshStatus).toBe("FRESH");
          resolve();
        },
      });
    });
    await flushPromises();
    await vi.advanceTimersByTimeAsync(1000);
    await flushPromises();
    await vi.advanceTimersByTimeAsync(1000);
    await flushPromises();
    await done;
    await nextTick();
    expect(pollingApi.polling.value).toBe(false);
    expect(updates).toContain("QUEUED");
    expect(updates).toContain("FRESH");
    wrapper.unmount();
  });

  it("stops on FAILED without waiting for FRESH", async () => {
    const getRefreshStatus = vi.mocked(api.getRefreshStatus);
    getRefreshStatus.mockResolvedValue(
      status({
        refreshStatus: "FAILED",
        job: {
          jobId: "2",
          queue: "refresh-character",
          status: "failed",
          dedupeKey: null,
          createdAt: "",
          startedAt: "",
          finishedAt: "",
          errorMessage: "provider timeout",
        },
      }),
    );

    const { api: pollingApi, wrapper } = mountPollingHarness();
    await new Promise<void>((resolve) => {
      void pollingApi.start({
        identity,
        onUpdate: () => undefined,
        onComplete: (s) => {
          expect(s.job?.status).toBe("failed");
          resolve();
        },
        maxDurationMs: 5_000,
      });
    });
    expect(pollingApi.polling.value).toBe(false);
    expect(getRefreshStatus).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });

  it("supports maxDurationMs null with no total timeout", async () => {
    const getRefreshStatus = vi.mocked(api.getRefreshStatus);
    getRefreshStatus.mockResolvedValue(
      status({
        refreshStatus: "IN_PROGRESS",
        job: {
          jobId: "no-timeout",
          queue: "refresh-character",
          status: "active",
          dedupeKey: null,
          createdAt: "",
          startedAt: "",
          finishedAt: null,
          errorMessage: null,
        },
      }),
    );

    const onTimeout = vi.fn();
    const { api: pollingApi, wrapper } = mountPollingHarness();
    void pollingApi.start({
      identity,
      intervalMs: FIRST_SCORE_POLL_INTERVAL_MS,
      maxDurationMs: null,
      onUpdate: () => undefined,
      onComplete: () => undefined,
      onTimeout,
    });
    await flushPromises();
    await vi.advanceTimersByTimeAsync(31 * 60_000);
    await flushPromises();

    expect(pollingApi.polling.value).toBe(true);
    expect(pollingApi.timedOut.value).toBe(false);
    expect(onTimeout).not.toHaveBeenCalled();
    expect(getRefreshStatus.mock.calls.length).toBeGreaterThan(1);
    wrapper.unmount();
  });

  it("stops on cancelled job status without treating it as active", async () => {
    const getRefreshStatus = vi.mocked(api.getRefreshStatus);
    getRefreshStatus.mockResolvedValue(
      status({
        refreshStatus: "STALE",
        job: {
          jobId: "3",
          queue: "refresh-character",
          status: "cancelled",
          dedupeKey: null,
          createdAt: "",
          startedAt: "",
          finishedAt: "",
          errorMessage: null,
        },
      }),
    );

    const { api: pollingApi, wrapper } = mountPollingHarness();
    await new Promise<void>((resolve) => {
      void pollingApi.start({
        identity,
        onUpdate: () => undefined,
        onComplete: (s) => {
          expect(s.job?.status).toBe("cancelled");
          expect(s.job?.errorMessage).toBeNull();
          resolve();
        },
        maxDurationMs: 5_000,
      });
    });
    expect(pollingApi.polling.value).toBe(false);
    expect(getRefreshStatus).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });

  it("uses a 60s interval for background refresh and fetches immediately on start", async () => {
    const getRefreshStatus = vi.mocked(api.getRefreshStatus);
    getRefreshStatus.mockResolvedValue(
      status({
        refreshStatus: "QUEUED",
        job: {
          jobId: "4",
          queue: "refresh-character",
          status: "queued",
          dedupeKey: null,
          createdAt: "",
          startedAt: null,
          finishedAt: null,
          errorMessage: null,
        },
      }),
    );

    const { api: pollingApi, wrapper } = mountPollingHarness();
    void pollingApi.start({
      identity,
      intervalMs: NORMAL_REFRESH_POLL_INTERVAL_MS,
      maxDurationMs: 180_000,
      onUpdate: () => undefined,
      onComplete: () => undefined,
    });
    await flushPromises();
    expect(getRefreshStatus).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(NORMAL_REFRESH_POLL_INTERVAL_MS - 1);
    await flushPromises();
    expect(getRefreshStatus).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    await flushPromises();
    expect(getRefreshStatus).toHaveBeenCalledTimes(2);
    expect(NORMAL_REFRESH_POLL_INTERVAL_MS).toBe(60_000);
    expect(FIRST_SCORE_POLL_INTERVAL_MS).toBe(5_000);
    expect(ADMIN_REFRESH_POLL_INTERVAL_MS).toBe(5_000);
    wrapper.unmount();
  });

  it("continues polling while the tab is hidden", async () => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "hidden",
    });

    const getRefreshStatus = vi.mocked(api.getRefreshStatus);
    getRefreshStatus.mockResolvedValue(
      status({
        refreshStatus: "IN_PROGRESS",
        job: {
          jobId: "5",
          queue: "refresh-character",
          status: "active",
          dedupeKey: null,
          createdAt: "",
          startedAt: "",
          finishedAt: null,
          errorMessage: null,
        },
      }),
    );

    const { api: pollingApi, wrapper } = mountPollingHarness();
    void pollingApi.start({
      identity,
      intervalMs: 5_000,
      maxDurationMs: 60_000,
      onUpdate: () => undefined,
      onComplete: () => undefined,
    });
    await flushPromises();
    expect(getRefreshStatus).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(5_000);
    await flushPromises();
    expect(getRefreshStatus).toHaveBeenCalledTimes(2);
    wrapper.unmount();
  });

  it("does not start a second concurrent status request while one is in flight", async () => {
    let resolveStatus: ((value: RefreshStatusResponse) => void) | null = null;
    let inFlight = 0;
    let maxInFlight = 0;
    const getRefreshStatus = vi.mocked(api.getRefreshStatus);
    getRefreshStatus.mockImplementation(
      () =>
        new Promise<RefreshStatusResponse>((resolve) => {
          inFlight += 1;
          maxInFlight = Math.max(maxInFlight, inFlight);
          resolveStatus = (value) => {
            inFlight -= 1;
            resolve(value);
          };
        }),
    );

    const { api: pollingApi, wrapper } = mountPollingHarness();
    void pollingApi.start({
      identity,
      intervalMs: 1_000,
      maxDurationMs: 60_000,
      onUpdate: () => undefined,
      onComplete: () => undefined,
    });
    await flushPromises();
    expect(getRefreshStatus).toHaveBeenCalledTimes(1);
    expect(inFlight).toBe(1);

    // A scheduled tick while the deferred request is open must coalesce, not overlap.
    await vi.advanceTimersByTimeAsync(1_000);
    await flushPromises();
    expect(getRefreshStatus).toHaveBeenCalledTimes(1);
    expect(maxInFlight).toBe(1);

    resolveStatus!(
      status({
        refreshStatus: "IN_PROGRESS",
        job: {
          jobId: "overlap",
          queue: "refresh-character",
          status: "active",
          dedupeKey: null,
          createdAt: "",
          startedAt: "",
          finishedAt: null,
          errorMessage: null,
        },
      }),
    );
    await flushPromises();
    expect(maxInFlight).toBe(1);
    wrapper.unmount();
  });

  it("clears timers on unmount", async () => {
    const getRefreshStatus = vi.mocked(api.getRefreshStatus);
    getRefreshStatus.mockResolvedValue(
      status({
        refreshStatus: "QUEUED",
        job: {
          jobId: "6",
          queue: "refresh-character",
          status: "queued",
          dedupeKey: null,
          createdAt: "",
          startedAt: null,
          finishedAt: null,
          errorMessage: null,
        },
      }),
    );

    const { api: pollingApi, wrapper } = mountPollingHarness();
    void pollingApi.start({
      identity,
      intervalMs: 5_000,
      maxDurationMs: 60_000,
      onUpdate: () => undefined,
      onComplete: () => undefined,
    });
    await flushPromises();
    wrapper.unmount();
    await vi.advanceTimersByTimeAsync(20_000);
    await flushPromises();
    expect(getRefreshStatus).toHaveBeenCalledTimes(1);
    expect(pollingApi.polling.value).toBe(false);
  });

  it("polling uses GET status only and never POSTs refresh", async () => {
    const getRefreshStatus = vi.mocked(api.getRefreshStatus);
    getRefreshStatus
      .mockResolvedValueOnce(
        status({
          refreshStatus: "IN_PROGRESS",
          job: {
            jobId: "poll-1",
            queue: "refresh-character",
            status: "active",
            dedupeKey: null,
            createdAt: "",
            startedAt: "",
            finishedAt: null,
            errorMessage: null,
          },
        }),
      )
      .mockResolvedValueOnce(
        status({
          refreshStatus: "FRESH",
          job: {
            jobId: "poll-1",
            queue: "refresh-character",
            status: "completed",
            dedupeKey: null,
            createdAt: "",
            startedAt: "",
            finishedAt: "",
            errorMessage: null,
          },
        }),
      );

    const { api: pollingApi, wrapper } = mountPollingHarness();
    const done = new Promise<void>((resolve) => {
      void pollingApi.start({
        identity,
        intervalMs: 1000,
        maxDurationMs: 10_000,
        onUpdate: () => undefined,
        onComplete: () => resolve(),
      });
    });
    await flushPromises();
    await vi.advanceTimersByTimeAsync(1000);
    await flushPromises();
    await done;

    expect(getRefreshStatus.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(Object.keys(api)).toEqual(["getRefreshStatus"]);
    wrapper.unmount();
  });
});
