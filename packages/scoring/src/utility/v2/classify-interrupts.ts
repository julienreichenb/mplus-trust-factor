/**
 * Interrupt attempt classification for Utility V2 Phase 1.
 *
 * Attempts = casts of cataloged interrupt abilities by the player or owned pets.
 * Classes: CONFIRMED_SUCCESS | VALID_OVERLAP | MATCHED_FAILED |
 *          UNMATCHED_ATTEMPT | NOT_OBSERVABLE.
 */

import {
  UTILITY_V2_INTERRUPT_CREDITS,
  UTILITY_V2_INTERRUPT_MATCH_TOLERANCE_MS,
} from "./constants.js";
import type {
  ClassifiedInterruptAttempt,
  InterruptAttemptClass,
  UtilityV2ActorKind,
  UtilityV2ConfirmedInterruptEvent,
  UtilityV2HostileCastWindow,
  UtilityV2InterruptAttemptSeed,
} from "./types.js";

function isAttributed(kind: UtilityV2ActorKind): boolean {
  return kind === "PLAYER" || kind === "OWNED_PET";
}

function overlapsWindow(
  ts: number,
  start: number,
  end: number,
  toleranceMs: number,
): boolean {
  return ts >= start - toleranceMs && ts <= end + toleranceMs;
}

function nearTimestamp(a: number, b: number, toleranceMs: number): boolean {
  return Math.abs(a - b) <= toleranceMs;
}

export interface ClassifyInterruptAttemptsInput {
  attempts: UtilityV2InterruptAttemptSeed[];
  confirmedInterrupts: UtilityV2ConfirmedInterruptEvent[];
  hostileWindows: UtilityV2HostileCastWindow[];
  /** When true, unmatched kicks can be UNMATCHED_ATTEMPT rather than NOT_OBSERVABLE. */
  hostileObservabilityPresent: boolean;
  toleranceMs?: number;
  interruptCredits?: typeof UTILITY_V2_INTERRUPT_CREDITS;
}

/**
 * Classify each attributed interrupt attempt. Non-player/pet seeds are skipped.
 * Deterministic: stable sort by (timestampMs, id).
 */
export function classifyInterruptAttempts(
  input: ClassifyInterruptAttemptsInput,
): ClassifiedInterruptAttempt[] {
  const tolerance = input.toleranceMs ?? UTILITY_V2_INTERRUPT_MATCH_TOLERANCE_MS;
  const seeds = input.attempts
    .filter((a) => isAttributed(a.sourceKind))
    .slice()
    .sort((a, b) => a.timestampMs - b.timestampMs || a.id.localeCompare(b.id));

  const usedConfirmIds = new Set<number>();
  const usedWindowIds = new Set<number>();

  const out: ClassifiedInterruptAttempt[] = [];

  for (const attempt of seeds) {
    let classification: InterruptAttemptClass = "NOT_OBSERVABLE";
    let note = "insufficient_evidence";

    // 1) Confirmed success — matching WCL interrupt by attributed source.
    const confirmIdx = input.confirmedInterrupts.findIndex(
      (ev, idx) =>
        !usedConfirmIds.has(idx) &&
        isAttributed(ev.sourceKind) &&
        ev.sourceActorId === attempt.sourceActorId &&
        nearTimestamp(ev.timestampMs, attempt.timestampMs, tolerance) &&
        (attempt.abilityGameId === 0 ||
          ev.abilityGameId == null ||
          ev.abilityGameId === attempt.abilityGameId),
    );
    if (confirmIdx >= 0) {
      usedConfirmIds.add(confirmIdx);
      classification = "CONFIRMED_SUCCESS";
      note = "matched_confirmed_interrupt_event";
    } else {
      // 2/3) Match overlapping hostile cast window.
      const windowIdx = input.hostileWindows.findIndex(
        (w, idx) =>
          !usedWindowIds.has(idx) &&
          overlapsWindow(attempt.timestampMs, w.startMs, w.endMs, tolerance) &&
          (attempt.targetActorId == null ||
            attempt.targetActorId === w.sourceActorId),
      );

      if (windowIdx >= 0) {
        usedWindowIds.add(windowIdx);
        const w = input.hostileWindows[windowIdx]!;
        const stoppedBySelf =
          w.interrupted &&
          w.interruptedByActorId === attempt.sourceActorId &&
          w.interruptedByKind != null &&
          isAttributed(w.interruptedByKind);
        const stoppedByOther =
          w.interrupted &&
          w.interruptedByActorId != null &&
          w.interruptedByKind != null &&
          !isAttributed(w.interruptedByKind);
        const stoppedWithoutAttribution =
          w.interrupted &&
          (w.interruptedByActorId == null || w.interruptedByKind == null);

        if (stoppedBySelf) {
          classification = "CONFIRMED_SUCCESS";
          note = "hostile_window_interrupted_by_attributed_source";
        } else if (stoppedByOther || (stoppedWithoutAttribution && !w.completed)) {
          classification = "VALID_OVERLAP";
          note = "hostile_cast_stopped_by_other_or_overlap";
        } else if (w.completed) {
          classification = "MATCHED_FAILED";
          note = "hostile_cast_completed_after_attempt";
        } else if (w.interrupted) {
          classification = "VALID_OVERLAP";
          note = "hostile_cast_interrupted_without_confirmed_own_kick";
        } else {
          classification = input.hostileObservabilityPresent
            ? "UNMATCHED_ATTEMPT"
            : "NOT_OBSERVABLE";
          note = input.hostileObservabilityPresent
            ? "window_open_no_clear_outcome"
            : "window_outcome_not_observable";
        }
      } else if (input.hostileObservabilityPresent) {
        classification = "UNMATCHED_ATTEMPT";
        note = "no_matching_hostile_window";
      } else {
        classification = "NOT_OBSERVABLE";
        note = "hostile_cast_stream_absent";
      }
    }

    out.push({
      id: attempt.id,
      timestampMs: attempt.timestampMs,
      abilityGameId: attempt.abilityGameId,
      sourceActorId: attempt.sourceActorId,
      sourceKind: attempt.sourceKind,
      targetActorId: attempt.targetActorId,
      classification,
      credit: (input.interruptCredits ?? UTILITY_V2_INTERRUPT_CREDITS)[classification],
      note,
    });
  }

  return out;
}

/** Aggregate raw credits before unmatched spam capping. */
export function sumInterruptCredits(attempts: ClassifiedInterruptAttempt[]): {
  byClass: Record<InterruptAttemptClass, number>;
  counts: Record<InterruptAttemptClass, number>;
  totalCredit: number;
  unmatchedCredit: number;
} {
  const byClass: Record<InterruptAttemptClass, number> = {
    CONFIRMED_SUCCESS: 0,
    VALID_OVERLAP: 0,
    MATCHED_FAILED: 0,
    UNMATCHED_ATTEMPT: 0,
    NOT_OBSERVABLE: 0,
  };
  const counts: Record<InterruptAttemptClass, number> = {
    CONFIRMED_SUCCESS: 0,
    VALID_OVERLAP: 0,
    MATCHED_FAILED: 0,
    UNMATCHED_ATTEMPT: 0,
    NOT_OBSERVABLE: 0,
  };
  for (const a of attempts) {
    counts[a.classification] += 1;
    byClass[a.classification] += a.credit;
  }
  const totalCredit =
    byClass.CONFIRMED_SUCCESS +
    byClass.VALID_OVERLAP +
    byClass.MATCHED_FAILED +
    byClass.UNMATCHED_ATTEMPT;
  return {
    byClass,
    counts,
    totalCredit,
    unmatchedCredit: byClass.UNMATCHED_ATTEMPT,
  };
}
