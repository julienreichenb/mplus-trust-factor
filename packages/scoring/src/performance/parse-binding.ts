/**
 * Bind WCL parse percentiles to a selected canonical run.
 * Never substitutes character-wide best parses for a different fight.
 */

export interface RankingParseCandidate {
  reportCode: string;
  fightId: number;
  bracket?: number | null;
  keyLevel?: number | null;
  /** Prefer WCL rankPercent when present. */
  rankPercent?: number | null;
  /** Alias for bracket-aware rank percent on some WCL payloads. */
  bracketPercent?: number | null;
  percentile?: number | null;
}

export type ParseBindingSource =
  | "selected_fight_bracket_matched"
  | "selected_fight"
  | "unavailable";

export interface SelectedRunParseBinding {
  executionPercentile: number | null;
  source: ParseBindingSource;
  bracketMatched: boolean;
  /** True when rankPercent (bracket-aware WCL field) was preferred over amount/total heuristic. */
  usedRankPercent: boolean;
  reason: string | null;
}

function asPercentile(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  if (value < 0 || value > 100) return null;
  return value;
}

function rowPercentile(row: RankingParseCandidate): {
  value: number | null;
  usedRankPercent: boolean;
} {
  const fromRank = asPercentile(row.rankPercent ?? row.bracketPercent ?? null);
  if (fromRank != null) return { value: fromRank, usedRankPercent: true };
  return { value: asPercentile(row.percentile ?? null), usedRankPercent: false };
}

/**
 * Resolve execution percentile for one selected canonical run.
 * Requires reportCode + fightId identity match — never falls back to best-in-dungeon.
 */
export function resolveSelectedRunParsePercentile(input: {
  rankings: readonly RankingParseCandidate[];
  reportCode: string | null | undefined;
  fightId: number | null | undefined;
  selectedKeyLevel: number;
}): SelectedRunParseBinding {
  const reportCode = input.reportCode?.trim() || null;
  const fightId = input.fightId;
  if (!reportCode || fightId == null || !Number.isFinite(fightId) || fightId <= 0) {
    return {
      executionPercentile: null,
      source: "unavailable",
      bracketMatched: false,
      usedRankPercent: false,
      reason: "selected_run_missing_wcl_identity",
    };
  }

  const matches = input.rankings.filter(
    (r) => r.reportCode === reportCode && r.fightId === fightId,
  );
  if (matches.length === 0) {
    return {
      executionPercentile: null,
      source: "unavailable",
      bracketMatched: false,
      usedRankPercent: false,
      reason: "parse_not_tied_to_selected_fight",
    };
  }

  const bracketMatched = matches.filter((r) => {
    const bracket = r.bracket ?? r.keyLevel ?? null;
    return bracket != null && bracket === input.selectedKeyLevel;
  });

  const preferred = (bracketMatched.length > 0 ? bracketMatched : matches)
    .map((row) => ({ row, ...rowPercentile(row) }))
    .filter((x) => x.value != null)
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0))[0];

  if (!preferred || preferred.value == null) {
    return {
      executionPercentile: null,
      source: "unavailable",
      bracketMatched: bracketMatched.length > 0,
      usedRankPercent: false,
      reason: "parse_percentile_missing_on_matched_fight",
    };
  }

  return {
    executionPercentile: preferred.value,
    source: bracketMatched.length > 0 ? "selected_fight_bracket_matched" : "selected_fight",
    bracketMatched: bracketMatched.length > 0,
    usedRankPercent: preferred.usedRankPercent,
    reason: null,
  };
}
