/**
 * Emit Performance feature consumption traces from Phase 1 compute inputs/outputs.
 */

import type { PerformanceRunParseFactV2 } from "./types.js";
import {
  FeatureConsumptionCollector,
  type FeatureConsumptionTrace,
} from "../../audit/consumption-trace.js";

export function emitPerformanceConsumptionTraces(input: {
  runParseFacts: PerformanceRunParseFactV2[];
  hasProfileAggregate: boolean;
  hasScore: boolean;
  unavailableProvenance: string[];
}): FeatureConsumptionTrace[] {
  const c = new FeatureConsumptionCollector();
  const available = input.runParseFacts.filter((f) => f.semantic !== "UNAVAILABLE");

  if (available.length > 0 && input.hasScore) {
    c.score("performance.parsePercentile", "detailed dungeon blend");
    c.score("performance.keyLevel", "difficulty-adjusted detailed performance");
  } else if (available.length > 0) {
    c.availability(
      "performance.parsePercentile",
      "availabilityState",
      "parse_present_but_score_withheld",
    );
  }

  c.availability("performance.semantic", "availabilityState / run parse binding");

  if (available.some((f) => f.partition != null)) {
    c.confidence("performance.partition", "confidence / partition alignment");
  } else {
    c.explain(
      "performance.partition",
      "confidence",
      "partition_absent",
    );
  }

  if (input.hasProfileAggregate && input.hasScore) {
    c.score("performance.profileAggregate", "profile blend weight");
  } else {
    c.explain(
      "performance.profileAggregate",
      "profile blend",
      "profile_aggregate_absent_detailed_only",
    );
  }

  if (input.unavailableProvenance.length > 0 || available.length === 0) {
    c.explain(
      "performance.unavailableProvenance",
      "explanation.limitations / metrics.provenance",
      available.length === 0 ? null : "partial_unavailable_slots",
    );
  }

  return c.snapshot();
}
