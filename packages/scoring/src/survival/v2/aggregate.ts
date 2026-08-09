import { clamp01 } from "../../math.js";
import type {
  SurvivalV2DungeonAggregate,
  SurvivalV2HealthEvidenceMode,
  SurvivalV2RunScore,
} from "./types.js";

export function medianOf(values: number[]): number | null {
  const valid = values.filter((v) => Number.isFinite(v));
  if (valid.length === 0) return null;
  const sorted = [...valid].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1]! + sorted[mid]!) / 2;
  }
  return sorted[mid]!;
}

export function meanOf(values: Array<number | null>): number | null {
  const valid = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (valid.length === 0) return null;
  return valid.reduce((s, v) => s + v, 0) / valid.length;
}

/**
 * Per dungeon: median of valid selected-run behavioral scores.
 * With two runs, median === mean. Missing slots omitted (never zero-filled).
 */
export function aggregateSurvivalV2Dungeon(
  dungeonSlug: string,
  runs: SurvivalV2RunScore[],
): SurvivalV2DungeonAggregate {
  const valid = runs.filter((r) => r.valid && r.behavioralScore != null);
  return {
    dungeonSlug,
    runCount: valid.length,
    medianBehavioralScore: medianOf(valid.map((r) => r.behavioralScore!)),
    medianOutcome: medianOf(
      valid.filter((r) => r.outcome.score != null).map((r) => r.outcome.score!),
    ),
    medianDefensive: medianOf(
      valid.filter((r) => r.defensive.score != null).map((r) => r.defensive.score!),
    ),
    medianRecovery: medianOf(
      valid.filter((r) => r.recovery.score != null).map((r) => r.recovery.score!),
    ),
    runs,
  };
}

/** Equal-weight mean of per-dungeon medians. */
export function aggregateSurvivalV2Season(
  dungeons: SurvivalV2DungeonAggregate[],
): number | null {
  return meanOf(dungeons.map((d) => d.medianBehavioralScore));
}

export function computeSurvivalV2Confidence(input: {
  dungeonCount: number;
  expectedDungeonCount: number;
  scoredRunCount: number;
  expectedSlotCount: number;
  healthModes: Record<string, number>;
  catalogCoverageMean: number;
  relativeUnreliableCount: number;
  /** When true, drop inventing catalog coverage from the confidence mix. */
  catalogCoverageUnmeasured?: boolean;
}): {
  confidence: number;
  causes: string[];
  components: Record<string, number>;
} {
  if (input.dungeonCount === 0) {
    return {
      confidence: 0,
      causes: ["no_survival_evidence"],
      components: {
        dungeonCoverage: 0,
        slotFill: 0,
        healthFactor: 0,
        catalogFactor: 0,
      },
    };
  }
  const expected = Math.max(1, input.expectedDungeonCount);
  const coverage = clamp01(input.dungeonCount / expected);
  const slotFill = clamp01(
    input.scoredRunCount / Math.max(1, input.expectedSlotCount),
  );

  const full = input.healthModes["FULL"] ?? 0;
  const partial =
    (input.healthModes["PARTIAL"] ?? 0) + (input.healthModes["TRUNCATED"] ?? 0);
  const outcomeOnly =
    (input.healthModes["OUTCOME_ONLY"] ?? 0) + (input.healthModes["MISSING"] ?? 0);
  const healthTotal = full + partial + outcomeOnly;
  const healthFactor =
    healthTotal === 0
      ? 0.45
      : clamp01((full * 1 + partial * 0.75 + outcomeOnly * 0.45) / healthTotal);

  const relativePenalty =
    input.relativeUnreliableCount > 0
      ? clamp01(1 - 0.05 * input.relativeUnreliableCount)
      : 1;

  // When catalog coverage is unmeasured, drop that weight and renormalize so a
  // stand-in constant cannot masquerade as observed evidence quality.
  const weights = input.catalogCoverageUnmeasured
    ? { coverage: 0.4 / 0.85, slotFill: 0.25 / 0.85, health: 0.2 / 0.85, catalog: 0 }
    : { coverage: 0.4, slotFill: 0.25, health: 0.2, catalog: 0.15 };
  const catalogFactor = clamp01(input.catalogCoverageMean);
  const base =
    weights.coverage * coverage +
    weights.slotFill * slotFill +
    weights.health * healthFactor +
    weights.catalog * catalogFactor;
  const confidence = clamp01(
    base * relativePenalty * (outcomeOnly > full ? 0.7 : 1),
  );

  const causes: string[] = [];
  if (coverage < 1) causes.push("incomplete_dungeon_coverage");
  if (slotFill < 1) causes.push("incomplete_slot_coverage");
  if (partial > 0) causes.push("health_evidence_partial");
  if (outcomeOnly > 0) causes.push("max_hp_unavailable");
  if (outcomeOnly > full) causes.push("health_evidence_outcome_dominated");
  // catalogCoverageUnmeasured drops weight rather than inventing coverage — not a
  // confidence penalty by itself. Measured-but-incomplete catalog does emit a cause.
  if (!input.catalogCoverageUnmeasured && catalogFactor < 1) {
    causes.push("incomplete_catalog_coverage");
  }
  if (input.relativeUnreliableCount > 0) {
    causes.push("relative_damage_unreliable");
  }

  return {
    confidence,
    causes,
    components: {
      dungeonCoverage: coverage,
      slotFill,
      healthFactor,
      catalogFactor: input.catalogCoverageUnmeasured ? 0 : catalogFactor,
      relativePenalty,
      fullHealthRuns: full,
      partialHealthRuns: partial,
      outcomeOnlyHealthRuns: outcomeOnly,
    },
  };
}

export function tallyHealthModes(
  runs: SurvivalV2RunScore[],
): Record<SurvivalV2HealthEvidenceMode, number> {
  const out: Record<string, number> = {
    FULL: 0,
    PARTIAL: 0,
    OUTCOME_ONLY: 0,
    TRUNCATED: 0,
    MISSING: 0,
  };
  for (const run of runs) {
    out[run.healthEvidenceMode] = (out[run.healthEvidenceMode] ?? 0) + 1;
  }
  return out as Record<SurvivalV2HealthEvidenceMode, number>;
}
