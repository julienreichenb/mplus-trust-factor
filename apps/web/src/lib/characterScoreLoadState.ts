import type { CharacterProfileView } from "../api/types";

/**
 * Score presentation phases for CharacterPage.
 * Distinguishes first-time calculation from stale-while-revalidate refresh.
 */
export type CharacterScoreLoadPhase =
  | "ready"
  | "calculating"
  | "failed"
  | "timed_out"
  | "unavailable";

export function hasPublishedScore(
  profile: Pick<CharacterProfileView, "score"> | null | undefined,
): boolean {
  return Boolean(profile?.score);
}

/**
 * True when the character has no published score and a refresh is still in flight.
 * Profile uses QUEUED / REFRESHING (API maps IN_PROGRESS → these).
 */
export function isInitialScoreCalculating(
  profile: Pick<CharacterProfileView, "score" | "refreshStatus"> | null | undefined,
): boolean {
  if (!profile || hasPublishedScore(profile)) return false;
  return profile.refreshStatus === "QUEUED" || profile.refreshStatus === "REFRESHING";
}

/**
 * Stale-while-revalidate: keep showing a usable score during background refresh.
 */
export function shouldShowPublishedScore(
  profile: Pick<CharacterProfileView, "score" | "refreshStatus"> | null | undefined,
): boolean {
  return hasPublishedScore(profile);
}

export function resolveCharacterScoreLoadPhase(input: {
  profile: Pick<CharacterProfileView, "score" | "refreshStatus"> | null | undefined;
  timedOut?: boolean;
  /** Explicit terminal failure from refresh-status / load error while still score-less. */
  terminalFailure?: boolean;
}): CharacterScoreLoadPhase {
  const { profile, timedOut = false, terminalFailure = false } = input;
  if (hasPublishedScore(profile)) return "ready";
  if (timedOut) return "timed_out";
  if (terminalFailure || profile?.refreshStatus === "FAILED") return "failed";
  if (isInitialScoreCalculating(profile)) return "calculating";
  return "unavailable";
}

export function characterScoreLoadStatusMessage(phase: CharacterScoreLoadPhase): string {
  switch (phase) {
    case "calculating":
      return "Calculating Trust Score…";
    case "timed_out":
      return "Score calculation timed out. Retry or reopen this profile.";
    case "failed":
      return "Score calculation failed. You can retry without losing character identity.";
    case "unavailable":
      return "Trust Score is not available for this character yet.";
    case "ready":
    default:
      return "";
  }
}
