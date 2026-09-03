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
  NORMAL_REFRESH_POLL_INTERVAL_MS,
  NORMAL_REFRESH_POLL_MAX_MS,
  useRefreshPolling,
} from "./useRefreshPolling";

export interface CharacterScoreAwaitOptions {
  identity: CharacterIdentityInput;
  /** Current profile ref — updated in place as status/profile arrive. */
  profile: Ref<CharacterProfileView | null>;
  admin?: boolean;
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
 * Focused lifecycle for first-time score calculation (and shared refresh polling helpers).
 * Prevents overlapping polls; cleans up on unmount; preserves stale-while-revalidate.
 */
export function useCharacterScoreAwait() {
  const { polling, timedOut, start, stop } = useRefreshPolling();
  const lastRefreshStatus = ref<RefreshStatusResponse | null>(null);
  const terminalFailure = ref(false);
  let activeIdentityKey: string | null = null;
  let fetchInFlight = false;

  function identityKey(identity: CharacterIdentityInput): string {
    return `${identity.region}:${identity.realmSlug}:${identity.name}`.toLowerCase();
  }

  function pollingOptions(admin: boolean) {
    return {
      intervalMs: admin ? ADMIN_REFRESH_POLL_INTERVAL_MS : NORMAL_REFRESH_POLL_INTERVAL_MS,
      maxDurationMs: admin ? ADMIN_REFRESH_POLL_MAX_MS : NORMAL_REFRESH_POLL_MAX_MS,
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
    return withBootstrapRepairSignal(await api.getCharacterProfile(identity));
  }

  async function startAwaiting(options: CharacterScoreAwaitOptions): Promise<void> {
    const key = identityKey(options.identity);
    // Prevent overlapping polling sessions for the same identity.
    if (polling.value && activeIdentityKey === key) return;

    terminalFailure.value = false;
    activeIdentityKey = key;
    stop();

    const current = options.profile.value;
    if (!current) return;

    let initialStatus: RefreshStatusResponse;
    try {
      initialStatus = await api.getRefreshStatus(options.identity);
    } catch {
      initialStatus = {
        characterId: current.characterId,
        refreshStatus: current.refreshStatus === "REFRESHING" ? "IN_PROGRESS" : "QUEUED",
        job: null,
        cooldownSecondsRemaining: 0,
        bootstrapRepairRequired: current.bootstrapRepairRequired === true,
      };
    }

    const reconciled = applyRefreshStatusToProfile(current, initialStatus);
    options.profile.value = reconciled;
    lastRefreshStatus.value = initialStatus;

    const awaitingFirstScore = isInitialScoreCalculating(reconciled);
    const backgroundRefresh =
      hasPublishedScore(reconciled) &&
      (reconciled.refreshStatus === "QUEUED" || reconciled.refreshStatus === "REFRESHING");

    const shouldPoll =
      refreshStatusHasRealInFlightJob(initialStatus) &&
      (initialStatus.refreshStatus === "QUEUED" ||
        initialStatus.refreshStatus === "IN_PROGRESS") &&
      (awaitingFirstScore || backgroundRefresh);

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

    void start({
      identity: options.identity,
      ...pollingOptions(options.admin === true),
      onUpdate: (status) => {
        lastRefreshStatus.value = status;
        if (!options.profile.value) return;
        options.profile.value = applyRefreshStatusToProfile(options.profile.value, status);
      },
      onComplete: async (status) => {
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

        if (fetchInFlight) return;
        fetchInFlight = true;
        try {
          const refreshed = await fetchProfile(options.identity);
          if (activeIdentityKey !== key) return;
          options.profile.value = refreshed;
          if (hasPublishedScore(refreshed)) {
            terminalFailure.value = false;
            options.onError?.(null);
          } else if (failed) {
            terminalFailure.value = true;
          }
          if (
            status.refreshStatus === "FRESH" ||
            status.job?.status === "completed" ||
            status.job?.status === "cancelled"
          ) {
            lastRefreshStatus.value = null;
          }
        } finally {
          fetchInFlight = false;
        }
      },
      onTimeout: () => {
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

  function stopAwaiting(): void {
    stop();
    activeIdentityKey = null;
    lastRefreshStatus.value = null;
    fetchInFlight = false;
  }

  onBeforeUnmount(stopAwaiting);

  return {
    polling,
    timedOut,
    lastRefreshStatus,
    terminalFailure,
    startAwaiting,
    stopAwaiting,
    scorePhaseFor,
    showScoreLoadingUi,
    showScoreContent,
    applyRefreshStatusToProfile,
    withBootstrapRepairSignal,
    /** Low-level refresh polling for manual refresh button (existing behaviour). */
    startPolling: start,
    stopPolling: stop,
    pollingOptions,
  };
}
