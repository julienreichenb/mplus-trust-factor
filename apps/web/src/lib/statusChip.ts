/** Shared semantic tone for refresh / score-computation status chips. */
export type StatusChipTone = "success" | "warning" | "danger" | "neutral";

export interface StatusChipPresentation {
  /** Visible chip text — the status itself, no redundant "Refresh" prefix. */
  label: string;
  tone: StatusChipTone;
}

const SUCCESS = new Set([
  "COMPLETED",
  "AVAILABLE",
  "FRESH",
  "UP_TO_DATE",
  "SUCCESS",
  "DRY_RUN_COMPLETED",
  "OK",
]);

const WARNING = new Set([
  "QUEUED",
  "ACTIVE",
  "RUNNING",
  "REFRESHING",
  "DISCOVERING",
  "STALE",
  "PARTIAL",
  "SELECTING",
  "PAUSED",
  "WARNING",
]);

const DANGER = new Set([
  "FAILED",
  "CANCELLED",
  "CANCELED",
  "INELIGIBLE",
  "UNAVAILABLE",
  "ERROR",
  "DISPATCH_FAILED",
]);

/** Human labels for known persisted enums (values themselves stay unchanged in APIs). */
const LABEL_OVERRIDES: Record<string, string> = {
  FRESH: "Up to date",
  UP_TO_DATE: "Up to date",
  RUNNING: "Analyzing",
  DRY_RUN_COMPLETED: "Dry-run completed",
  PARTIAL: "Partial data",
};

/**
 * Map a refresh / score / job status string to chip presentation.
 * Color is never the only signal — label text is always present.
 */
export function presentStatusChip(
  status: string | null | undefined,
  fallbackLabel = "—",
): StatusChipPresentation {
  if (status == null || status === "") {
    return { label: fallbackLabel, tone: "neutral" };
  }
  const key = status.trim().toUpperCase().replace(/\s+/g, "_");
  const label =
    LABEL_OVERRIDES[key] ??
    status
      .trim()
      .replace(/_/g, " ")
      .toLowerCase()
      .replace(/\b\w/g, (c) => c.toUpperCase());

  if (SUCCESS.has(key)) return { label, tone: "success" };
  if (WARNING.has(key)) return { label, tone: "warning" };
  if (DANGER.has(key)) return { label, tone: "danger" };
  return { label, tone: "neutral" };
}
