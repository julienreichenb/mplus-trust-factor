/**
 * Shared ReportEvents pagination — fight-bounded, explicit stop reasons.
 */
import type {
  SharedEvidencePaginationDiagnostics,
  SharedEvidencePaginationStopReason,
} from "./wcl-run-evidence-types.js";

export function eventIdentityKey(ev: Record<string, unknown>): string {
  const source = ev.source as { id?: number } | undefined;
  const ability = ev.ability as { guid?: number } | undefined;
  return [
    ev.timestamp,
    ev.type,
    source?.id ?? ev.sourceID,
    ability?.guid ?? ev.abilityGameID,
    ev.targetInstance ?? "",
  ].join(":");
}

export function eventTimestampMs(ev: Record<string, unknown>): number | null {
  return typeof ev.timestamp === "number" && Number.isFinite(ev.timestamp)
    ? ev.timestamp
    : null;
}

export function pageTimestampBounds(events: Array<Record<string, unknown>>): {
  first: number | null;
  last: number | null;
} {
  let first: number | null = null;
  let last: number | null = null;
  for (const ev of events) {
    const ts = eventTimestampMs(ev);
    if (ts == null) continue;
    if (first == null || ts < first) first = ts;
    if (last == null || ts > last) last = ts;
  }
  return { first, last };
}

export function computePaginationCoverageRatio(input: {
  requestedFightStartMs: number | null;
  requestedFightEndMs: number | null;
  lastEventTimestampMs: number | null;
}): number | null {
  const { requestedFightStartMs, requestedFightEndMs, lastEventTimestampMs } = input;
  if (
    requestedFightStartMs == null ||
    requestedFightEndMs == null ||
    lastEventTimestampMs == null ||
    requestedFightEndMs <= requestedFightStartMs
  ) {
    return null;
  }
  const covered = Math.min(
    requestedFightEndMs,
    Math.max(requestedFightStartMs, lastEventTimestampMs),
  );
  const ratio =
    (covered - requestedFightStartMs) / (requestedFightEndMs - requestedFightStartMs);
  return Math.round(Math.max(0, Math.min(1, ratio)) * 1000) / 1000;
}

export function buildPaginationDiagnostics(input: {
  requestedFightStartMs: number | null;
  requestedFightEndMs: number | null;
  firstEventTimestampMs: number | null;
  lastEventTimestampMs: number | null;
  nextPageTimestamp: number | null;
  pageCount: number;
  stopReason: SharedEvidencePaginationStopReason;
  complete: boolean;
}): SharedEvidencePaginationDiagnostics {
  return {
    requestedFightStartMs: input.requestedFightStartMs,
    requestedFightEndMs: input.requestedFightEndMs,
    firstEventTimestampMs: input.firstEventTimestampMs,
    lastEventTimestampMs: input.lastEventTimestampMs,
    nextPageTimestamp: input.nextPageTimestamp,
    pageCount: input.pageCount,
    stopReason: input.stopReason,
    coverageRatio: computePaginationCoverageRatio(input),
    complete: input.complete,
  };
}

export class SharedEvidencePaginationError extends Error {
  readonly code = "SHARED_EVIDENCE_PAGINATION" as const;
  readonly stopReason: SharedEvidencePaginationStopReason;

  constructor(message: string, stopReason: SharedEvidencePaginationStopReason) {
    super(message);
    this.name = "SharedEvidencePaginationError";
    this.stopReason = stopReason;
  }
}

export interface PaginationPageDecision {
  /** Continue fetching another page. */
  continue: boolean;
  /** Next ReportEvents startTime when continuing. */
  nextStartTime?: number;
  stopReason?: SharedEvidencePaginationStopReason;
  complete?: boolean;
  truncated?: boolean;
  /** Fail closed with SharedEvidencePaginationError. */
  fail?: boolean;
}

/**
 * Decide whether to continue ReportEvents pagination after one page.
 *
 * Continues while nextPageTimestamp advances, or when WCL returns a full page
 * without a cursor but the fight end has not been reached (fallback cursor).
 */
export function decideSharedEvidencePageContinuation(input: {
  pageEventsRawCount: number;
  pageLimit: number;
  nextPageTimestamp: number | null;
  pageLastTimestampMs: number | null;
  fightEndMs: number | null;
  seenPageCursors: ReadonlySet<number>;
  highWaterTimestamp: number | null;
  datasetLabel: string;
}): PaginationPageDecision {
  const {
    pageEventsRawCount,
    pageLimit,
    nextPageTimestamp,
    pageLastTimestampMs,
    fightEndMs,
    seenPageCursors,
    highWaterTimestamp,
    datasetLabel,
  } = input;

  if (pageEventsRawCount === 0) {
    const complete =
      fightEndMs == null ||
      highWaterTimestamp == null ||
      highWaterTimestamp >= fightEndMs;
    return {
      continue: false,
      stopReason: "EMPTY_PAGE",
      complete,
      truncated: !complete,
    };
  }

  if (
    highWaterTimestamp != null &&
    pageLastTimestampMs != null &&
    pageLastTimestampMs <= highWaterTimestamp &&
    nextPageTimestamp == null
  ) {
    return {
      continue: false,
      stopReason: "NON_PROGRESSING_CURSOR",
      complete: false,
      truncated: true,
      fail: true,
    };
  }

  if (nextPageTimestamp != null && fightEndMs != null && nextPageTimestamp >= fightEndMs) {
    return {
      continue: false,
      stopReason: "CURSOR_REACHED_FIGHT_END",
      complete: true,
      truncated: false,
    };
  }

  if (nextPageTimestamp == null) {
    if (
      pageEventsRawCount >= pageLimit &&
      pageLastTimestampMs != null &&
      (fightEndMs == null || pageLastTimestampMs < fightEndMs)
    ) {
      if (seenPageCursors.has(pageLastTimestampMs)) {
        return {
          continue: false,
          stopReason: "NON_PROGRESSING_CURSOR",
          complete: false,
          truncated: true,
          fail: true,
        };
      }
      return {
        continue: true,
        nextStartTime: pageLastTimestampMs,
      };
    }

    const complete =
      fightEndMs == null ||
      pageLastTimestampMs == null ||
      pageLastTimestampMs >= fightEndMs ||
      pageEventsRawCount < pageLimit;
    return {
      continue: false,
      stopReason: "NEXT_PAGE_NULL",
      complete,
      truncated: !complete,
    };
  }

  if (seenPageCursors.has(nextPageTimestamp)) {
    return {
      continue: false,
      stopReason: "NON_PROGRESSING_CURSOR",
      complete: false,
      truncated: true,
      fail: true,
    };
  }

  void datasetLabel;
  return {
    continue: true,
    nextStartTime: nextPageTimestamp,
  };
}
