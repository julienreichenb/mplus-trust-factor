import { onBeforeUnmount, ref, type Ref } from "vue";
import { api } from "../api/client";
import type { CharacterIdentityInput, CharacterProfileView, RefreshStatusResponse } from "../api/types";
import {
  inferBootstrapRepairRequired,
  reconcileProfileRefreshStatus,
  refreshStatusHasRealInFlightJob,
} from "../lib/bootstrapRepair";
import {
  hasPublishedScore,
  isInitialScoreCalculating,
  resolveCharacterScoreLoadPhase,
  shouldShowPublishedScore,
  type CharacterScoreLoadPhase,
} from "../lib/characterScoreLoadState";
import {
  ADMIN_REFRESH_POLL_INTERVAL_MS,
  ADMIN_REFRESH_POLL_MAX_MS,
  FIRST_SCORE_POLL_INTERVAL_MS,
  NORMAL_REFRESH_POLL_INTERVAL_MS,
  NORMAL_REFRESH_POLL_MAX_MS,
  useRefreshPolling,
} from "./useRefreshPolling";

export interface CharacterScoreAwaitOptions {
  identity: CharacterIdentityInput;
  /** Current profile ref — updated in place as status/profile arrive. */
  profile: Ref<CharacterProfileView | null>;
  admin?: boolean;
  /** Restart even if a poll loop for this identity is already active. */
  force?: boolean;
  /**
   * Optional status already obtained (e.g. after admin POST refresh).
   * When set, skips the initial getRefreshStatus round-trip.
   */
  seedStatus?: RefreshStatusResponse;
  onNotice?: (message: string | null) => void;
  onError?: (message: string | null) => void;
}

function withBootstrapRepairSignal(data: CharacterProfileView): CharacterProfileView {
  if (inferBootstrapRepairRequired(data) && data.bootstrapRepairRequired !== true) {
    return { ...data, bootstrapRepairRequired: true };
  }
  return data;
}

function applyRefreshStatusToProfile(
  current: CharacterProfileView,
  status: RefreshStatusResponse,
): CharacterProfileView {
  return withBootstrapRepairSignal({
    ...current,
    refreshStatus: reconcileProfileRefreshStatus({
      hasScore: Boolean(current.score),
      status,
    }),
    bootstrapRepairRequired:
      status.bootstrapRepairRequired === true
        ? true
        : current.bootstrapRepairRequired === true
          ? true
          : inferBootstrapRepairRequired(current),
  });
}

/**
 * Single authoritative score/refresh polling lifecycle for CharacterPage.
 * Prevents overlapping polls; cleans up on unmount; preserves stale-while-revalidate.
 */
export function useCharacterScoreAwait() {
  const { polling, timedOut, start, stop } = useRefreshPolling();
  const lastRefreshStatus = ref<RefreshStatusResponse | null>(null);
  const terminalFailure = ref(false);
  let activeIdentityKey: string | null = null;
  let fetchInFlight = false;
  let pendingProfileFetch: CharacterIdentityInput | null = null;
  let pollEpoch = 0;

  function identityKey(identity: CharacterIdentityInput): string {
    return `${identity.region}:${identity.realmSlug}:${identity.name}`.toLowerCase();
  }

  /**
   * First-score wait uses a short interval (5s) for the interactive loading panel.
   * Background refresh of an existing score keeps the slower 60s cadence.
   * Admins keep the faster 5s interval either way.
   */
  function pollingOptions(admin: boolean, awaitingFirstScore: boolean) {
    // No published score: 5s GET observation with no total timeout, including
    // an admin merely opening a character that is already queued/calculating.
    if (awaitingFirstScore) {
      return {
        intervalMs: FIRST_SCORE_POLL_INTERVAL_MS,
        maxDurationMs: null,
      };
    }
    if (admin) {
      return {
        intervalMs: ADMIN_REFRESH_POLL_INTERVAL_MS,
        maxDurationMs: ADMIN_REFRESH_POLL_MAX_MS,
      };
    }
    return {
      intervalMs: NORMAL_REFRESH_POLL_INTERVAL_MS,
      maxDurationMs: NORMAL_REFRESH_POLL_MAX_MS,
    };
  }

  function scorePhaseFor(
    profile: CharacterProfileView | null | undefined,
  ): CharacterScoreLoadPhase {
    return resolveCharacterScoreLoadPhase({
      profile,
      timedOut: timedOut.value && !hasPublishedScore(profile),
      terminalFailure: terminalFailure.value && !hasPublishedScore(profile),
    });
  }

  function showScoreLoadingUi(profile: CharacterProfileView | null | undefined): boolean {
    const p = scorePhaseFor(profile);
    return p === "calculating" || p === "timed_out" || p === "failed";
  }

  function showScoreContent(profile: CharacterProfileView | null | undefined): boolean {
    return shouldShowPublishedScore(profile);
  }

  async function fetchProfile(identity: CharacterIdentityInput): Promise<CharacterProfileView> {
    // Bust intermediary caches so a newly published score is never masked by a stale GET.
    return withBootstrapRepairSignal(
      await api.getCharacterProfile({
        ...identity,
      }),
    );
  }

  async function applyFetchedProfile(
    options: CharacterScoreAwaitOptions,
    key: string,
    epoch: number,
    failed: boolean,
  ): Promise<void> {
    if (fetchInFlight) {
      pendingProfileFetch = options.identity;
      return;
    }
    fetchInFlight = true;
    try {
      do {
        pendingProfileFetch = null;
        const refreshed = await fetchProfile(options.identity);
        if (activeIdentityKey !== key || epoch !== pollEpoch) return;
        options.profile.value = refreshed;
        if (hasPublishedScore(refreshed)) {
          terminalFailure.value = false;
          options.onError?.(null);
        } else if (failed) {
          terminalFailure.value = true;
        }
      } while (
        pendingProfileFetch &&
        activeIdentityKey === key &&
        epoch === pollEpoch &&
        identityKey(pendingProfileFetch) === key
      );
    } finally {
      fetchInFlight = false;
    }
  }

  async function startAwaiting(options: CharacterScoreAwaitOptions): Promise<void> {
    const key = identityKey(options.identity);
    if (polling.value && activeIdentityKey === key && !options.force) return;

    const epoch = ++pollEpoch;
    terminalFailure.value = false;
    activeIdentityKey = key;
    pendingProfileFetch = null;
    stop();

    const current = options.profile.value;
    if (!current) return;

    let initialStatus: RefreshStatusResponse | null = null;
    let initialStatusFailed = false;
    if (options.seedStatus) {
      initialStatus = options.seedStatus;
    } else {
      try {
        initialStatus = await api.getRefreshStatus(options.identity);
      } catch {
        initialStatusFailed = true;
      }
    }
    if (epoch !== pollEpoch || activeIdentityKey !== key) return;

    const awaitingFirstScore = isInitialScoreCalculating(current);

    // Transient GET failure must not abandon a first-score wait — keep GET-only observation.
    if (initialStatusFailed) {
      if (!awaitingFirstScore) return;
      lastRefreshStatus.value = null;
      await start({
        identity: options.identity,
        ...pollingOptions(options.admin === true, true),
        onUpdate: (status) => {
          if (epoch !== pollEpoch || activeIdentityKey !== key) return;
          lastRefreshStatus.value = status;
          if (!options.profile.value) return;
          options.profile.value = applyRefreshStatusToProfile(options.profile.value, status);
        },
        onComplete: async (status) => {
          if (epoch !== pollEpoch || activeIdentityKey !== key) return;
          lastRefreshStatus.value = status;
          const failed =
            status.job?.status !== "cancelled" &&
            (status.refreshStatus === "FAILED" || status.job?.status === "failed");

          if (failed) {
            terminalFailure.value = !hasPublishedScore(options.profile.value);
            const message =
              status.job?.errorMessage?.trim() ||
              "Score calculation failed. You can retry without losing character identity.";
            options.onError?.(message);
          }

          await applyFetchedProfile(options, key, epoch, failed);
          if (epoch !== pollEpoch || activeIdentityKey !== key) return;

          if (
            status.refreshStatus === "FRESH" ||
            status.job?.status === "completed" ||
            status.job?.status === "cancelled"
          ) {
            lastRefreshStatus.value = null;
          }
        },
        onTimeout: () => {
          if (epoch !== pollEpoch || activeIdentityKey !== key) return;
          options.onError?.(
            "Score calculation is taking longer than expected. Retry or reopen this profile.",
          );
        },
      });
      return;
    }

    if (!initialStatus) return;

    const reconciled = applyRefreshStatusToProfile(current, initialStatus);
    options.profile.value = reconciled;
    lastRefreshStatus.value = initialStatus;

    const awaitingAfterStatus = isInitialScoreCalculating(reconciled);
    const backgroundAfterStatus =
      hasPublishedScore(reconciled) &&
      (reconciled.refreshStatus === "QUEUED" || reconciled.refreshStatus === "REFRESHING");

    const shouldPoll =
      refreshStatusHasRealInFlightJob(initialStatus) &&
      (initialStatus.refreshStatus === "QUEUED" ||
        initialStatus.refreshStatus === "IN_PROGRESS") &&
      (awaitingAfterStatus || backgroundAfterStatus);

    if (!shouldPoll) {
      if (reconciled.refreshStatus === "FAILED" && !hasPublishedScore(reconciled)) {
        terminalFailure.value = true;
        options.onError?.(
          initialStatus.job?.errorMessage?.trim() ||
            "Score calculation failed. You can retry without losing character identity.",
        );
      }
      return;
    }

    await start({
      identity: options.identity,
      ...pollingOptions(options.admin === true, awaitingAfterStatus),
      onUpdate: (status) => {
        if (epoch !== pollEpoch || activeIdentityKey !== key) return;
        lastRefreshStatus.value = status;
        if (!options.profile.value) return;
        options.profile.value = applyRefreshStatusToProfile(options.profile.value, status);
      },
      onComplete: async (status) => {
        if (epoch !== pollEpoch || activeIdentityKey !== key) return;
        lastRefreshStatus.value = status;
        const failed =
          status.job?.status !== "cancelled" &&
          (status.refreshStatus === "FAILED" || status.job?.status === "failed");

        if (failed) {
          terminalFailure.value = !hasPublishedScore(options.profile.value);
          const message =
            status.job?.errorMessage?.trim() ||
            (hasPublishedScore(options.profile.value)
              ? "Refresh failed. You can retry without losing the last available snapshot."
              : "Score calculation failed. You can retry without losing character identity.");
          if (hasPublishedScore(options.profile.value)) {
            options.onNotice?.(message);
          } else {
            options.onError?.(message);
          }
        }

        await applyFetchedProfile(options, key, epoch, failed);
        if (epoch !== pollEpoch || activeIdentityKey !== key) return;

        if (
          status.refreshStatus === "FRESH" ||
          status.job?.status === "completed" ||
          status.job?.status === "cancelled"
        ) {
          lastRefreshStatus.value = null;
        }
      },
      onTimeout: () => {
        if (epoch !== pollEpoch || activeIdentityKey !== key) return;
        if (!hasPublishedScore(options.profile.value)) {
          options.onError?.(
            "Score calculation is taking longer than expected. Retry or reopen this profile.",
          );
        } else {
          options.onError?.("Refresh is taking longer than expected. Retry or reopen this profile.");
        }
      },
    });
  }

  /**
   * Public-safe retry: re-read profile + status and restart bounded polling.
   * Never enqueues provider work (no POST refresh).
   */
  async function retryScoreLoad(options: CharacterScoreAwaitOptions): Promise<void> {
    const key = identityKey(options.identity);
    const epoch = ++pollEpoch;
    terminalFailure.value = false;
    activeIdentityKey = key;
    pendingProfileFetch = null;
    stop();
    options.onError?.(null);

    try {
      const refreshed = await fetchProfile(options.identity);
      if (epoch !== pollEpoch || activeIdentityKey !== key) return;
      options.profile.value = refreshed;
      if (hasPublishedScore(refreshed) && !isInitialScoreCalculating(refreshed)) {
        lastRefreshStatus.value = null;
        return;
      }
    } catch (err) {
      if (epoch !== pollEpoch || activeIdentityKey !== key) return;
      options.onError?.((err as Error).message || "Failed to reload profile");
      return;
    }

    await startAwaiting({ ...options, force: true });
  }

  function stopAwaiting(): void {
    pollEpoch += 1;
    stop();
    activeIdentityKey = null;
    lastRefreshStatus.value = null;
    fetchInFlight = false;
    pendingProfileFetch = null;
  }

  onBeforeUnmount(stopAwaiting);

  return {
    polling,
    timedOut,
    lastRefreshStatus,
    terminalFailure,
    startAwaiting,
    retryScoreLoad,
    stopAwaiting,
    scorePhaseFor,
    showScoreLoadingUi,
    showScoreContent,
    applyRefreshStatusToProfile,
    withBootstrapRepairSignal,
    pollingOptions,
  };
}
