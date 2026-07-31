import { describe, expect, it, vi, beforeEach } from "vitest";
import { defineComponent, nextTick } from "vue";
import { mount, flushPromises } from "@vue/test-utils";
import { useRefreshPolling } from "./useRefreshPolling";
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
  return { wrapper, get api() { return apiHandle!; } };
}

describe("useRefreshPolling", () => {
  beforeEach(() => {
    vi.mocked(api.getRefreshStatus).mockReset();
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
    await new Promise<void>((resolve) => {
      void pollingApi.start({
        identity,
        onUpdate: (s) => updates.push(s.refreshStatus),
        onComplete: (s) => {
          expect(s.refreshStatus).toBe("FRESH");
          resolve();
        },
        maxDurationMs: 10_000,
      });
    });
    await flushPromises();
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
});
