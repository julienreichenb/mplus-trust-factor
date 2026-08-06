/**
 * Deterministic classification helpers for the Scoring V2 live character probe.
 * Pure — no provider I/O.
 */

export type DatasetAvailabilityStatus =
  | "REQUESTED"
  | "AVAILABLE"
  | "EMPTY_VALID"
  | "PARTIAL"
  | "FAILED"
  | "NOT_REQUIRED";

export type DimensionExecutable = "YES" | "PARTIAL" | "NO";

export type OverallVerdict =
  | "READY_FOR_SINGLE_CHARACTER_SHADOW"
  | "PARTIAL_DATA — FIXABLE"
  | "BLOCKED_BY_DISCOVERY"
  | "BLOCKED_BY_DATASET_COLLECTION"
  | "BLOCKED_BY_FACT_EXTRACTION"
  | "BLOCKED_BY_CALCULATOR_INPUT";

export interface DatasetCoverageRow {
  dataset: string;
  status: DatasetAvailabilityStatus;
  providerOperation: string | null;
  reportCode: string | null;
  fightId: number | null;
  actorId: number | null;
  pageCount: number | null;
  eventCount: number | null;
  normalizedFactCount: number | null;
  failureReasonCode: string | null;
}

export interface SlotHydrationSummary {
  dungeonSlug: string;
  slotIndex: 0 | 1;
  state: string;
  reportCode: string | null;
  fightId: number | null;
  reportRevision: number | null;
  actorId: number | null;
  fullyHydrated: boolean;
  wclReportValid: boolean;
  missingReason: string | null;
}

export interface DimensionReadinessInput {
  executable: DimensionExecutable;
  calculated: boolean;
  availability: string | null;
  missingFields: string[];
  failureReasons: string[];
}

export interface ProbeClassificationInput {
  dungeonCount: number;
  selectedSlotCount: number;
  expectedSlotCount: number;
  fullyHydratedSlots: number;
  discoveryFailed: boolean;
  datasetFailedSlots: number;
  factExtractionFailedSlots: number;
  performance: DimensionReadinessInput;
  survival: DimensionReadinessInput;
  utility: DimensionReadinessInput;
  experience: DimensionReadinessInput;
}

export function classifyDatasetStatus(input: {
  required: boolean;
  requested: boolean;
  available: boolean;
  eventCount: number | null;
  pageCount: number | null;
  truncated?: boolean;
  failed?: boolean;
  failureReasonCode?: string | null;
}): DatasetAvailabilityStatus {
  if (!input.required && !input.requested) return "NOT_REQUIRED";
  if (input.failed) return "FAILED";
  if (!input.available) return input.requested || input.required ? "FAILED" : "NOT_REQUIRED";
  if (input.truncated) return "PARTIAL";
  if (input.eventCount === 0) return "EMPTY_VALID";
  if (input.available) return "AVAILABLE";
  return "REQUESTED";
}

export function classifyDimensionExecutable(input: {
  calculated: boolean;
  availability: string | null;
  missingFields: string[];
  failureReasons: string[];
}): DimensionExecutable {
  if (input.calculated) {
    const avail = (input.availability ?? "").toUpperCase();
    if (avail === "AVAILABLE" || avail === "OK") return "YES";
    if (avail === "PARTIAL") return "PARTIAL";
    if (avail === "UNAVAILABLE") return "NO";
    return "YES";
  }
  if (input.missingFields.length > 0 || input.failureReasons.length > 0) {
    const onlyPartial = input.failureReasons.every(
      (r) =>
        r.includes("PARTIAL") ||
        r.includes("partial") ||
        r.includes("coverage") ||
        r.includes("missing_"),
    );
    return onlyPartial ? "PARTIAL" : "NO";
  }
  return "NO";
}

export function classifyOverallVerdict(input: ProbeClassificationInput): OverallVerdict {
  if (input.discoveryFailed || input.selectedSlotCount === 0) {
    return "BLOCKED_BY_DISCOVERY";
  }

  if (input.datasetFailedSlots > 0 && input.fullyHydratedSlots === 0) {
    return "BLOCKED_BY_DATASET_COLLECTION";
  }

  const dims = [input.performance, input.survival, input.utility];
  const allNo = dims.every((d) => d.executable === "NO");
  const anyFactBlocked = dims.some((d) =>
    d.failureReasons.some(
      (r) =>
        r.includes("extraction") ||
        r.includes("fact_") ||
        r.includes("missing_fact") ||
        r.includes("extractor"),
    ),
  );
  const anyInputBlocked = dims.some((d) =>
    d.failureReasons.some(
      (r) =>
        r.includes("calculator_input") ||
        r.includes("adapt_") ||
        r.includes("missing_experience_history") ||
        r.includes("input_"),
    ),
  );

  if (allNo && anyFactBlocked && input.fullyHydratedSlots > 0) {
    return "BLOCKED_BY_FACT_EXTRACTION";
  }
  if (allNo && anyInputBlocked) {
    return "BLOCKED_BY_CALCULATOR_INPUT";
  }

  const wclReady =
    input.performance.executable !== "NO" &&
    input.survival.executable !== "NO" &&
    input.utility.executable !== "NO";
  const fullSlots = input.selectedSlotCount >= input.expectedSlotCount;
  const allHydrated = input.fullyHydratedSlots >= input.selectedSlotCount && input.selectedSlotCount > 0;

  if (wclReady && fullSlots && allHydrated && input.experience.executable !== "NO") {
    return "READY_FOR_SINGLE_CHARACTER_SHADOW";
  }

  if (wclReady && input.selectedSlotCount > 0) {
    return "PARTIAL_DATA — FIXABLE";
  }

  if (input.datasetFailedSlots > 0 && input.fullyHydratedSlots < input.selectedSlotCount) {
    return "BLOCKED_BY_DATASET_COLLECTION";
  }

  if (anyFactBlocked) return "BLOCKED_BY_FACT_EXTRACTION";
  if (anyInputBlocked) return "BLOCKED_BY_CALCULATOR_INPUT";

  return "PARTIAL_DATA — FIXABLE";
}

export function summarizeMissingDungeonSlots(input: {
  activeDungeonSlugs: string[];
  slots: Array<{ dungeonSlug: string; slotIndex: 0 | 1; state: string }>;
}): Array<{ dungeonSlug: string; missingSlotIndexes: Array<0 | 1>; reason: string }> {
  const out: Array<{ dungeonSlug: string; missingSlotIndexes: Array<0 | 1>; reason: string }> = [];
  for (const dungeon of input.activeDungeonSlugs) {
    const dungeonSlots = input.slots.filter((s) => s.dungeonSlug === dungeon);
    const selectedCount = dungeonSlots.filter((s) => s.state === "SELECTED").length;
    const missing: Array<0 | 1> = [];
    for (const idx of [0, 1] as const) {
      const slot = dungeonSlots.find((s) => s.slotIndex === idx);
      if (!slot || slot.state !== "SELECTED") missing.push(idx);
    }
    if (missing.length > 0) {
      out.push({
        dungeonSlug: dungeon,
        missingSlotIndexes: missing,
        reason:
          selectedCount === 0
            ? "character_has_no_eligible_logged_run"
            : "insufficient_eligible_logged_runs",
      });
    }
  }
  return out;
}
