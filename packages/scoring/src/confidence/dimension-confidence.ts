/**
 * Shared dimension confidence provenance helpers.
 *
 * Causes are stable snake_case machine keys for later explainability.
 * Do not invent confidence penalties here — callers compute numeric confidence.
 */

import { clamp01 } from "../math.js";
import {
  confidenceBandFromScore,
  type ScoringConfidenceBand,
} from "./scoring-confidence-v1.js";

export const DIMENSION_CONFIDENCE_BREAKDOWN_VERSION =
  "dimension-confidence-breakdown-v1" as const;

export const PARTIAL_COMPOSITE_CONFIDENCE_FORMULA_VERSION =
  "partial-composite-weakest-link-v1" as const;

export type DimensionConfidenceBand = ScoringConfidenceBand;

export interface DimensionConfidenceBreakdown {
  schemaVersion: typeof DIMENSION_CONFIDENCE_BREAKDOWN_VERSION;
  value: number;
  band: DimensionConfidenceBand;
  /** Machine-readable reasons for confidence < 1 and/or unavailability. */
  causes: string[];
  /** Evidence coverage / component inputs used to derive confidence. */
  components: Record<string, number>;
}

export function confidenceBandFromUnit(value: number): DimensionConfidenceBand {
  if (!Number.isFinite(value) || value <= 0) return "NONE";
  return confidenceBandFromScore(Math.round(clamp01(value) * 100));
}

export function buildDimensionConfidenceBreakdown(input: {
  value: number;
  causes?: readonly string[] | null;
  components?: Record<string, number> | null;
}): DimensionConfidenceBreakdown {
  const value = clamp01(input.value);
  const causes = uniqueCauses(input.causes);
  return {
    schemaVersion: DIMENSION_CONFIDENCE_BREAKDOWN_VERSION,
    value,
    band: confidenceBandFromUnit(value),
    // Persist causes only when confidence is imperfect, or for hard
    // unavailability keys (value already 0).
    causes: value < 1 ? causes : [],
    components: input.components ?? {},
  };
}

export function uniqueCauses(
  causes: readonly string[] | null | undefined,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of causes ?? []) {
    if (typeof raw !== "string") continue;
    const key = raw.trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

/** Push a cause only when the predicate is true. */
export function pushCause(
  causes: string[],
  predicate: boolean,
  cause: string,
): void {
  if (predicate) causes.push(cause);
}
