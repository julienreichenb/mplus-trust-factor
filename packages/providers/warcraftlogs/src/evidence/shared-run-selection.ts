/**
 * Shared canonical Mythic+ run selection — one sample per dungeon for Performance / Survival / Utility.
 * Dimensions must not independently replace runs for the same character/season/contract scope.
 */
export const SHARED_RUN_SELECTION_SCHEMA_VERSION = "1.0.0";
export const SHARED_RUN_SELECTION_ANALYSIS_VERSION = "wcl-shared-run-selection-v1";

export interface SharedSelectedRun {
  dungeonSlug: string;
  reportCode: string;
  reportRevision: number | null;
  fightId: number;
  playerActorId: number | null;
  ownedPetActorIds: number[];
  startTime: number | null;
  endTime: number | null;
  selectionReason: string;
  providerDataAsOf: string | null;
  /** Canonical run id when fused into MythicRun. */
  canonicalRunId?: string | null;
}

export interface SharedRunSelection {
  schemaVersion: typeof SHARED_RUN_SELECTION_SCHEMA_VERSION;
  analysisVersion: typeof SHARED_RUN_SELECTION_ANALYSIS_VERSION;
  characterKey: string;
  seasonSlug: string;
  refreshContractHash: string | null;
  /** Scoring-model compatibility scope — model changes do not invalidate provider evidence. */
  scoringModelScope: string;
  selectedAt: string;
  runs: SharedSelectedRun[];
}

export function buildSharedRunSelectionKey(input: {
  characterKey: string;
  seasonSlug: string;
  refreshContractHash: string | null;
  scoringModelScope: string;
}): string {
  return [
    "shared-run-selection",
    input.characterKey,
    input.seasonSlug,
    input.refreshContractHash ?? "no-contract",
    input.scoringModelScope,
  ].join("|");
}

/** Assert two dimensions share the same report/fight per dungeon. */
export function assertSharedRunSelectionParity(
  a: SharedSelectedRun[],
  b: SharedSelectedRun[],
): { ok: boolean; mismatches: string[] } {
  const byDungeon = new Map(a.map((r) => [r.dungeonSlug, r]));
  const mismatches: string[] = [];
  for (const run of b) {
    const other = byDungeon.get(run.dungeonSlug);
    if (!other) {
      mismatches.push(`missing_in_a:${run.dungeonSlug}`);
      continue;
    }
    if (other.reportCode !== run.reportCode || other.fightId !== run.fightId) {
      mismatches.push(
        `dungeon=${run.dungeonSlug} a=${other.reportCode}:${other.fightId} b=${run.reportCode}:${run.fightId}`,
      );
    }
  }
  for (const run of a) {
    if (!b.some((r) => r.dungeonSlug === run.dungeonSlug)) {
      mismatches.push(`missing_in_b:${run.dungeonSlug}`);
    }
  }
  return { ok: mismatches.length === 0, mismatches };
}

export function sharedSelectionFromUtilityNormalizedRuns(
  characterKey: string,
  seasonSlug: string,
  runs: Array<{
    dungeonSlug: string;
    reportCode: string;
    fightId: number;
    playerActorId: number | null;
    petActorIds?: number[];
    durationMs?: number;
    selectionReason?: string;
  }>,
  opts: {
    refreshContractHash?: string | null;
    scoringModelScope?: string;
    reportRevisionByCode?: Record<string, number | null>;
    providerDataAsOf?: string | null;
  } = {},
): SharedRunSelection {
  const byDungeon = new Map<string, SharedSelectedRun>();
  for (const run of runs) {
    if (byDungeon.has(run.dungeonSlug)) continue;
    byDungeon.set(run.dungeonSlug, {
      dungeonSlug: run.dungeonSlug,
      reportCode: run.reportCode,
      reportRevision: opts.reportRevisionByCode?.[run.reportCode] ?? null,
      fightId: run.fightId,
      playerActorId: run.playerActorId,
      ownedPetActorIds: run.petActorIds ?? [],
      startTime: null,
      endTime: run.durationMs != null ? run.durationMs : null,
      selectionReason: run.selectionReason ?? "utility_probe_normalized_first_per_dungeon",
      providerDataAsOf: opts.providerDataAsOf ?? null,
    });
  }
  return {
    schemaVersion: SHARED_RUN_SELECTION_SCHEMA_VERSION,
    analysisVersion: SHARED_RUN_SELECTION_ANALYSIS_VERSION,
    characterKey,
    seasonSlug,
    refreshContractHash: opts.refreshContractHash ?? null,
    scoringModelScope: opts.scoringModelScope ?? "utility-offline-v3_2",
    selectedAt: new Date().toISOString(),
    runs: [...byDungeon.values()],
  };
}
