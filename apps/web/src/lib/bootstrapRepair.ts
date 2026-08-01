import type { CharacterProfileView, RefreshStatusResponse } from "../api/types";

/** Canonical server signal for bootstrap repair CTA. */
export function hasExplicitBootstrapRepairSignal(
  profile: Pick<CharacterProfileView, "bootstrapRepairRequired" | "warnings">,
): boolean {
  return (
    profile.bootstrapRepairRequired === true ||
    (profile.warnings ?? []).some((w) => w.code === "CHARACTER_BOOTSTRAP_INCOMPLETE")
  );
}

/**
 * Narrow compatibility fallback for older/skewed API payloads that omit the
 * explicit repair signal but still look like the stranded incomplete shell
 * (Myzouth shape): no score, core Blizzard evidence missing, eligibility-unknown warning.
 *
 * Do not infer repair from optional presentation fields (faction, media, equipment, talents).
 */
export function inferBootstrapRepairRequired(
  profile: Pick<
    CharacterProfileView,
    | "bootstrapRepairRequired"
    | "warnings"
    | "score"
    | "level"
    | "role"
    | "classSlug"
    | "specSlug"
  >,
): boolean {
  if (hasExplicitBootstrapRepairSignal(profile)) return true;
  if (profile.score) return false;
  const hasEligibilityUnknown = (profile.warnings ?? []).some(
    (w) => w.code === "CHARACTER_REFRESH_ELIGIBILITY_UNKNOWN",
  );
  if (!hasEligibilityUnknown) return false;
  const coreIncomplete =
    profile.level == null ||
    profile.role == null ||
    profile.classSlug == null ||
    profile.specSlug == null;
  return coreIncomplete;
}

export function refreshStatusHasRealInFlightJob(
  status: Pick<RefreshStatusResponse, "refreshStatus" | "job">,
): boolean {
  const jobStatus = status.job?.status;
  if (jobStatus === "queued" || jobStatus === "active") return true;
  return false;
}

/** Map refresh-status onto coarse profile refreshStatus without inventing QUEUED. */
export function reconcileProfileRefreshStatus(input: {
  hasScore: boolean;
  status: Pick<RefreshStatusResponse, "refreshStatus" | "job">;
}): CharacterProfileView["refreshStatus"] {
  const cancelled = input.status.job?.status === "cancelled";
  const terminalFailed =
    !cancelled &&
    (input.status.refreshStatus === "FAILED" || input.status.job?.status === "failed");
  const inProgress =
    !cancelled &&
    refreshStatusHasRealInFlightJob(input.status) &&
    (input.status.refreshStatus === "IN_PROGRESS" ||
      input.status.refreshStatus === "QUEUED" ||
      input.status.job?.status === "queued" ||
      input.status.job?.status === "active");

  if (terminalFailed) return input.hasScore ? "STALE" : "FAILED";
  if (cancelled) return input.status.refreshStatus === "STALE" ? "STALE" : "FRESH";
  if (inProgress) return input.hasScore ? "REFRESHING" : "QUEUED";
  if (input.status.refreshStatus === "STALE") return "STALE";
  if (input.status.refreshStatus === "FRESH") return "FRESH";
  if (input.status.refreshStatus === "FAILED") return input.hasScore ? "STALE" : "FAILED";
  return input.hasScore ? "STALE" : "FAILED";
}
