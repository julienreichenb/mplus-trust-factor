/**
 * Provider-free helpers for the offensive one-fight probe persist path.
 * Pure functions only — no WCL / DB I/O.
 */

export type OffensiveProbeFightWindow = {
  fightStartMs: number;
  fightEndMs: number | null;
};

export type OffensiveProbeCandidateRef = {
  reportCode: string;
  fightId: number;
  reportRevision: number;
};

export type OffensiveProbeCandidateLoadFailure = {
  candidate: OffensiveProbeCandidateRef;
  error: string;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Resolve fight window from a masterData document that includes fights[]. */
export function fightTimesFromMasterData(
  masterData: unknown,
  fightId: number,
): OffensiveProbeFightWindow | null {
  const root = asRecord(masterData);
  const fights = Array.isArray(root?.fights) ? root!.fights : [];
  for (const fight of fights) {
    const row = asRecord(fight);
    if (!row || row.id !== fightId) continue;
    const start =
      typeof row.startTime === "number"
        ? row.startTime
        : typeof row.start_time === "number"
          ? row.start_time
          : null;
    const end =
      typeof row.endTime === "number"
        ? row.endTime
        : typeof row.end_time === "number"
          ? row.end_time
          : null;
    if (start == null || !Number.isFinite(start)) return null;
    return {
      fightStartMs: start,
      fightEndMs: end != null && Number.isFinite(end) ? end : null,
    };
  }
  return null;
}

function selectionHasCompleteFightWindow(selection: {
  fightStartMs: number;
  fightEndMs: number | null;
}): selection is { fightStartMs: number; fightEndMs: number } {
  return (
    typeof selection.fightStartMs === "number" &&
    Number.isFinite(selection.fightStartMs) &&
    typeof selection.fightEndMs === "number" &&
    Number.isFinite(selection.fightEndMs)
  );
}

/**
 * Prefer masterData.fights[]; otherwise use revision/candidate fight window.
 * Throws when neither source provides a complete window (start + end).
 */
export function resolvePersistedFightWindow(
  masterData: unknown,
  selection: {
    fightId: number;
    fightStartMs: number;
    fightEndMs: number | null;
  },
): OffensiveProbeFightWindow {
  const fromMaster = fightTimesFromMasterData(masterData, selection.fightId);
  if (fromMaster) return fromMaster;

  if (selectionHasCompleteFightWindow(selection)) {
    return {
      fightStartMs: selection.fightStartMs,
      fightEndMs: selection.fightEndMs,
    };
  }

  throw new Error(
    `Could not resolve fight start/end for fight ${selection.fightId}: masterData has no fights[] and selection lacks a complete fight window`,
  );
}

/** Prefer the configured spike fight so unrelated cas-only slots do not mask it. */
export function prioritizeOffensiveProbeCandidates<T extends OffensiveProbeCandidateRef>(
  candidates: readonly T[],
  spike: OffensiveProbeCandidateRef,
): T[] {
  const isSpike = (c: OffensiveProbeCandidateRef) =>
    c.reportCode === spike.reportCode &&
    c.fightId === spike.fightId &&
    c.reportRevision === spike.reportRevision;
  const preferred = candidates.filter(isSpike);
  const rest = candidates.filter((c) => !isSpike(c));
  return [...preferred, ...rest];
}

/** Report every candidate failure; first entry is the first attempted candidate. */
export function formatPersistedCandidateLoadFailures(
  failures: readonly OffensiveProbeCandidateLoadFailure[],
): string {
  if (failures.length === 0) {
    return "No persisted Casts/Buffs/CombatantInfo/masterData artifacts available";
  }
  const lines = failures.map(
    (f, index) =>
      `[${index}] ${f.candidate.reportCode}:${f.candidate.fightId}:r${f.candidate.reportRevision}: ${f.error}`,
  );
  return `No loadable persisted slot (${failures.length} candidate(s)). Failures:\n${lines.join("\n")}`;
}
