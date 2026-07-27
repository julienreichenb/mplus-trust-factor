/**
 * Sanitized WCL deep-smoke helpers — no secrets, no unrelated player roster dumps.
 */
import { createHash } from "node:crypto";

/** Mask report codes for logs: keep prefix/suffix, hide middle. */
export function sanitizeReportCode(code: string): string {
  if (code.length <= 6) return `${code.slice(0, 2)}****`;
  return `${code.slice(0, 4)}****${code.slice(-4)}`;
}

/** Stable short fingerprint for a report code (safe to print). */
export function reportCodeFingerprint(code: string): string {
  return createHash("sha256").update(code, "utf8").digest("hex").slice(0, 12);
}

export function sanitizeReportRef(code: string): { fingerprint: string; maskedCode: string } {
  return {
    fingerprint: reportCodeFingerprint(code),
    maskedCode: sanitizeReportCode(code),
  };
}

/** True when a GraphQL selection list includes a stale RateLimitData field. */
export function hasStaleRateLimitFields(query: string): boolean {
  return /\bpointsRemaining\b/.test(query) || /\bresetInSeconds\b/.test(query);
}

/** Worker refresh pipeline must call full discovery + fight analysis, not summary alone. */
export const WORKER_WCL_REQUIRED_CALLS = [
  "discoverCharacterSummary",
  "discoverCharacterRuns",
  "getReportFightDetails",
] as const;

export function assertWorkerWclPath(source: string): string[] {
  return WORKER_WCL_REQUIRED_CALLS.filter((call) => !source.includes(call));
}

export function rejectionReasonFromMatch(input: {
  confidence: string;
  evidence: {
    dungeonMatch: boolean;
    keyLevelMatch: boolean;
    timeDeltaMs: number | null;
    durationDeltaMs: number | null;
    rosterOverlapRatio: number | null;
  };
  autoMergeAllowed: boolean;
  timeToleranceMs?: number;
  durationToleranceMs?: number;
  /** When true, dungeon+key+(time|duration) is enough — roster absence is not a rejection. */
  acceptedForAnalysis?: boolean;
}): string | null {
  if (input.autoMergeAllowed || input.confidence === "HIGH") return null;
  if (input.acceptedForAnalysis) return null;
  const reasons: string[] = [];
  if (!input.evidence.dungeonMatch) reasons.push("dungeon_mismatch_or_unknown");
  if (!input.evidence.keyLevelMatch) reasons.push("key_level_mismatch_or_unknown");
  const timeTol = input.timeToleranceMs ?? 120_000;
  const durationTol = input.durationToleranceMs ?? 15_000;
  const timeOk =
    input.evidence.timeDeltaMs != null && input.evidence.timeDeltaMs <= timeTol;
  const durationOk =
    input.evidence.durationDeltaMs != null && input.evidence.durationDeltaMs <= durationTol;
  if (input.evidence.timeDeltaMs == null) reasons.push("completed_at_unknown");
  else if (!timeOk) reasons.push("completed_at_outside_window");
  if (input.evidence.durationDeltaMs == null) reasons.push("duration_unknown");
  // Roster is only a soft signal once dungeon+key+(time|duration) would accept analysis.
  if (!(timeOk || durationOk)) {
    if (input.evidence.rosterOverlapRatio == null) reasons.push("roster_unavailable");
    else if (input.evidence.rosterOverlapRatio < 0.5) reasons.push("roster_overlap_too_low");
  } else if (input.evidence.rosterOverlapRatio == null) {
    reasons.push("roster_unavailable");
  } else if (input.evidence.rosterOverlapRatio < 0.5) {
    reasons.push("roster_overlap_too_low");
  }
  if (reasons.length === 0) reasons.push(`confidence_${input.confidence.toLowerCase()}_below_merge_threshold`);
  return reasons.join(",");
}
