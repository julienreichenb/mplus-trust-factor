/**
 * Scorer-owned feature consumption traces.
 * A feature is "consumed" only when a calculator emits a trace at the point of use.
 */

import type { FeatureScoringRole } from "@mplus/contracts";

export type FeatureConsumptionKind =
  | "SCORE"
  | "CONFIDENCE"
  | "AVAILABILITY"
  | "EXPLAINABILITY";

export interface FeatureConsumptionTrace {
  featurePath: string;
  kind: FeatureConsumptionKind;
  /** Output component, confidence field, or explanation path affected. */
  outputField: string;
  /** Optional exclusion when present but not numerically applied. */
  exclusionReason?: string | null;
}

export class FeatureConsumptionCollector {
  private readonly traces: FeatureConsumptionTrace[] = [];

  consume(trace: FeatureConsumptionTrace): void {
    this.traces.push(trace);
  }

  /** Mark a SCORE-path consumption. */
  score(featurePath: string, outputField: string): void {
    this.consume({ featurePath, kind: "SCORE", outputField });
  }

  confidence(featurePath: string, outputField: string): void {
    this.consume({ featurePath, kind: "CONFIDENCE", outputField });
  }

  availability(
    featurePath: string,
    outputField: string,
    exclusionReason?: string | null,
  ): void {
    this.consume({
      featurePath,
      kind: "AVAILABILITY",
      outputField,
      exclusionReason: exclusionReason ?? null,
    });
  }

  explain(
    featurePath: string,
    outputField: string,
    exclusionReason?: string | null,
  ): void {
    this.consume({
      featurePath,
      kind: "EXPLAINABILITY",
      outputField,
      exclusionReason: exclusionReason ?? null,
    });
  }

  snapshot(): FeatureConsumptionTrace[] {
    return [...this.traces];
  }
}

export function scoringRoleFromTraceKind(
  kind: FeatureConsumptionKind,
): FeatureScoringRole {
  switch (kind) {
    case "SCORE":
      return "SCORE";
    case "CONFIDENCE":
      return "CONFIDENCE";
    case "AVAILABILITY":
      return "AVAILABILITY";
    case "EXPLAINABILITY":
      return "EXPLAINABILITY_ONLY";
  }
}

/** Aggregate first consumption per feature path (stable). */
export function indexTracesByFeature(
  traces: readonly FeatureConsumptionTrace[],
): Map<string, FeatureConsumptionTrace> {
  const map = new Map<string, FeatureConsumptionTrace>();
  for (const t of traces) {
    if (!map.has(t.featurePath)) map.set(t.featurePath, t);
  }
  return map;
}
