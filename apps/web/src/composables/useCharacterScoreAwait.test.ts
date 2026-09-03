import { afterEach, describe, expect, it, vi } from "vitest";
import { defineComponent, nextTick, ref } from "vue";
import { mount, flushPromises } from "@vue/test-utils";
import { useCharacterScoreAwait } from "./useCharacterScoreAwait";
import type { CharacterProfileView, RefreshStatusResponse } from "../api/types";
import { FIXTURE_CHARACTERS } from "../api/mock/fixtures";

const getRefreshStatus = vi.fn();
const getCharacterProfile = vi.fn();

vi.mock("../api/client", () => ({
  api: {
    getRefreshStatus: (...args: unknown[]) => getRefreshStatus(...args),
    getCharacterProfile: (...args: unknown[]) => getCharacterProfile(...args),
  },
}));

function queuedProfile(): CharacterProfileView {
  return {
    ...FIXTURE_CHARACTERS[0]!.profile,
    score: null,
    refreshStatus: "QUEUED",
  };
}

function scoredProfile(): CharacterProfileView {
  return {
    ...FIXTURE_CHARACTERS[0]!.profile,
    refreshStatus: "FRESH",
  };
}

function status(partial: Partial<RefreshStatusResponse>): RefreshStatusResponse {
  return {
    characterId: FIXTURE_CHARACTERS[0]!.profile.characterId,
    refreshStatus: "QUEUED",
    job: {
      jobId: "job-1",
      queue: "refresh-character",
      status: "queued",
      dedupeKey: null,
      createdAt: "2026-07-20T12:00:00.000Z",
      startedAt: null,
      finishedAt: null,
      errorMessage: null,
    },
    cooldownSecondsRemaining: 0,
    bootstrapRepairRequired: false,
    ...partial,
  };
}

function mountAwaitHarness() {
  const profile = ref<CharacterProfileView | null>(queuedProfile());
  let api: ReturnType<typeof useCharacterScoreAwait> | null = null;
  const Host = defineComponent({
    setup() {
      api = useCharacterScoreAwait();
      return () => null;
    },
  });
  const wrapper = mount(Host);
  return { api: api!, wrapper, profile };
}

describe("useCharacterScoreAwait", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("shows loading UI for a queued character without a score", () => {
    const { api, wrapper, profile } = mountAwaitHarness();
    expect(api.showScoreLoadingUi(profile.value)).toBe(true);
    expect(api.showScoreContent(profile.value)).toBe(false);
    expect(api.scorePhaseFor(profile.value)).toBe("calculating");
    wrapper.unmount();
  });

  it("keeps a stale score visible during background refresh", () => {
    const { api, wrapper } = mountAwaitHarness();
    const refreshing = {
      ...scoredProfile(),
      refreshStatus: "REFRESHING" as const,
    };
    expect(api.showScoreLoadingUi(refreshing)).toBe(false);
    expect(api.showScoreContent(refreshing)).toBe(true);
    expect(api.scorePhaseFor(refreshing)).toBe("ready");
    wrapper.unmount();
  });

  it("polls until a score becomes ready and replaces loading state", async () => {
    vi.useFakeTimers();
    getRefreshStatus.mockResolvedValue(
      status({
        refreshStatus: "IN_PROGRESS",
        job: {
          jobId: "job-1",
          queue: "refresh-character",
          status: "active",
          dedupeKey: null,
          createdAt: "2026-07-20T12:00:00.000Z",
          startedAt: "2026-07-20T12:00:01.000Z",
          finishedAt: null,
          errorMessage: null,
        },
      }),
    );
    getCharacterProfile.mockResolvedValue(scoredProfile());

    const { api, wrapper, profile } = mountAwaitHarness();
    await api.startAwaiting({
      identity: { region: "EU", realmSlug: "archimonde", name: "Wallidrixe" },
      profile,
    });
    await flushPromises();
    expect(api.polling.value).toBe(true);
    expect(api.showScoreLoadingUi(profile.value)).toBe(true);

    getRefreshStatus.mockResolvedValueOnce(
      status({
        refreshStatus: "FRESH",
        job: {
          jobId: "job-1",
          queue: "refresh-character",
          status: "completed",
          dedupeKey: null,
          createdAt: "2026-07-20T12:00:00.000Z",
          startedAt: "2026-07-20T12:00:01.000Z",
          finishedAt: "2026-07-20T12:01:00.000Z",
          errorMessage: null,
        },
      }),
    );

    await vi.advanceTimersByTimeAsync(60_000);
    await flushPromises();

    expect(getCharacterProfile).toHaveBeenCalled();
    expect(profile.value?.score).toBeTruthy();
    expect(api.showScoreLoadingUi(profile.value)).toBe(false);
    expect(api.showScoreContent(profile.value)).toBe(true);
    expect(api.polling.value).toBe(false);
    wrapper.unmount();
  });

  it("surfaces terminal failure without empty score cards", async () => {
    getRefreshStatus.mockResolvedValue(
      status({
        refreshStatus: "FAILED",
        job: {
          jobId: "job-1",
          queue: "refresh-character",
          status: "failed",
          dedupeKey: null,
          createdAt: "2026-07-20T12:00:00.000Z",
          startedAt: "2026-07-20T12:00:01.000Z",
          finishedAt: "2026-07-20T12:01:00.000Z",
          errorMessage: "Provider timeout",
        },
      }),
    );
    getCharacterProfile.mockResolvedValue({
      ...queuedProfile(),
      refreshStatus: "FAILED",
      score: null,
    });

    const onError = vi.fn();
    const { api, wrapper, profile } = mountAwaitHarness();
    await api.startAwaiting({
      identity: { region: "EU", realmSlug: "archimonde", name: "Wallidrixe" },
      profile,
      onError,
    });
    await flushPromises();

    expect(api.scorePhaseFor(profile.value)).toBe("failed");
    expect(api.showScoreLoadingUi(profile.value)).toBe(true);
    expect(api.showScoreContent(profile.value)).toBe(false);
    expect(onError).toHaveBeenCalled();
    wrapper.unmount();
  });

  it("marks timeout for initial calculation", async () => {
    vi.useFakeTimers();
    getRefreshStatus.mockResolvedValue(
      status({
        refreshStatus: "IN_PROGRESS",
        job: {
          jobId: "job-1",
          queue: "refresh-character",
          status: "active",
          dedupeKey: null,
          createdAt: "2026-07-20T12:00:00.000Z",
          startedAt: "2026-07-20T12:00:01.000Z",
          finishedAt: null,
          errorMessage: null,
        },
      }),
    );

    const onError = vi.fn();
    const { api, wrapper, profile } = mountAwaitHarness();
    await api.startAwaiting({
      identity: { region: "EU", realmSlug: "archimonde", name: "Wallidrixe" },
      profile,
      onError,
    });

    await vi.advanceTimersByTimeAsync(31 * 60_000);
    await flushPromises();

    expect(api.timedOut.value).toBe(true);
    expect(api.scorePhaseFor(profile.value)).toBe("timed_out");
    expect(onError).toHaveBeenCalled();
    wrapper.unmount();
  });

  it("stops polling on unmount", async () => {
    vi.useFakeTimers();
    getRefreshStatus.mockResolvedValue(
      status({
        refreshStatus: "IN_PROGRESS",
        job: {
          jobId: "job-1",
          queue: "refresh-character",
          status: "active",
          dedupeKey: null,
          createdAt: "2026-07-20T12:00:00.000Z",
          startedAt: "2026-07-20T12:00:01.000Z",
          finishedAt: null,
          errorMessage: null,
        },
      }),
    );

    const { api, wrapper, profile } = mountAwaitHarness();
    await api.startAwaiting({
      identity: { region: "EU", realmSlug: "archimonde", name: "Wallidrixe" },
      profile,
    });
    expect(api.polling.value).toBe(true);
    const callsBefore = getRefreshStatus.mock.calls.length;
    wrapper.unmount();
    await nextTick();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(getRefreshStatus.mock.calls.length).toBe(callsBefore);
  });
});
