import type {
  EstimateConfidence,
  JobStatusDTO,
  RefreshEtaFields,
  RefreshSchedulingState,
} from "../api/types";

export type RefreshEtaView = Pick<
  RefreshEtaFields,
  | "activeRefreshCount"
  | "effectiveWorkerCapacity"
  | "observedThroughput"
  | "queuePosition"
  | "estimatedWaitSeconds"
  | "estimateConfidence"
  | "schedulingState"
>;

export function extractRefreshEta(
  source: Partial<RefreshEtaFields> | JobStatusDTO | null | undefined,
): RefreshEtaView | null {
  if (!source) return null;
  if (
    source.schedulingState == null &&
    source.queuePosition == null &&
    source.estimatedWaitSeconds == null &&
    source.activeRefreshCount == null
  ) {
    return null;
  }
  return {
    activeRefreshCount: source.activeRefreshCount ?? null,
    effectiveWorkerCapacity: source.effectiveWorkerCapacity ?? null,
    observedThroughput: source.observedThroughput ?? null,
    queuePosition: source.queuePosition ?? null,
    estimatedWaitSeconds: source.estimatedWaitSeconds ?? null,
    estimateConfidence: source.estimateConfidence ?? null,
    schedulingState: source.schedulingState ?? null,
  };
}

/** Human explanation when a numeric wait is unavailable. */
export function schedulingExplanation(
  state: RefreshSchedulingState | null | undefined,
): string | null {
  switch (state) {
    case "PAUSED":
      return "Refresh scheduling is paused. Wait estimates are unavailable.";
    case "DRAINING":
      return "Refresh queue is draining. New work is not starting; wait estimates are unavailable.";
    case "RATE_LIMITED":
      return "Provider rate limits are blocking new refreshes. Wait estimates are unavailable.";
    case "CIRCUIT_OPEN":
      return "Provider circuit is open. Wait estimates are unavailable.";
    case "RUNNING":
      return "Approximate wait is unavailable — not enough recent completions to estimate.";
    default:
      return null;
  }
}

/**
 * Coarse wait range label from bucketed seconds — never shows false precision.
 * Examples: "under 30s", "about 1–5 min", "about 30–60 min".
 */
export function formatCoarseWaitRange(estimatedWaitSeconds: number | null | undefined): string | null {
  if (estimatedWaitSeconds == null || !Number.isFinite(estimatedWaitSeconds)) return null;
  const s = Math.max(0, Math.floor(estimatedWaitSeconds));
  if (s === 0) return "starting soon";
  if (s <= 30) return "under 30s";
  if (s <= 60) return "about 30–60s";
  if (s <= 120) return "about 1–2 min";
  if (s <= 300) return "about 2–5 min";
  if (s <= 600) return "about 5–10 min";
  if (s <= 900) return "about 10–15 min";
  if (s <= 1800) return "about 15–30 min";
  if (s <= 3600) return "about 30–60 min";
  return "over an hour";
}

export function formatJobsAhead(queuePosition: number | null | undefined): string | null {
  if (queuePosition == null || !Number.isFinite(queuePosition)) return null;
  const n = Math.max(0, Math.floor(queuePosition));
  if (n === 0) return "Approximate jobs ahead: none (yours is next or running)";
  return `Approximate jobs ahead: ~${n}`;
}

export function formatEstimateConfidence(confidence: EstimateConfidence | null | undefined): string | null {
  if (!confidence) return null;
  return `Estimate confidence: ${confidence.toLowerCase()}`;
}

export function presentRefreshEtaSummary(eta: RefreshEtaView | null): {
  jobsAhead: string | null;
  waitRange: string | null;
  explanation: string | null;
  confidence: string | null;
  processingLabel: string | null;
} {
  if (!eta) {
    return {
      jobsAhead: null,
      waitRange: null,
      explanation: null,
      confidence: null,
      processingLabel: null,
    };
  }

  const waitRange = formatCoarseWaitRange(eta.estimatedWaitSeconds);
  const jobsAhead = formatJobsAhead(eta.queuePosition);
  const confidence = formatEstimateConfidence(eta.estimateConfidence);
  const explanation =
    eta.estimatedWaitSeconds == null
      ? schedulingExplanation(eta.schedulingState) ??
        (eta.estimateConfidence === "LOW"
          ? "Approximate wait is unavailable right now."
          : null)
      : null;

  return {
    jobsAhead,
    waitRange,
    explanation,
    confidence,
    processingLabel: null,
  };
}
