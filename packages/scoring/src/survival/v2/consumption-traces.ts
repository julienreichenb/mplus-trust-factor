/**
 * Emit Survival feature consumption traces from scored runs + season aggregate.
 * Traces reflect actual calculator use — not mere feature presence.
 */

import type { SurvivalV2RelativeDamageMode } from "./constants.js";
import type { SurvivalV2RunScore } from "./types.js";
import {
  FeatureConsumptionCollector,
  type FeatureConsumptionTrace,
} from "../../audit/consumption-trace.js";

export function emitSurvivalConsumptionTraces(input: {
  scoredRuns: SurvivalV2RunScore[];
  relativeDamageMode: SurvivalV2RelativeDamageMode;
  hasScore: boolean;
}): FeatureConsumptionTrace[] {
  const c = new FeatureConsumptionCollector();
  if (input.scoredRuns.length === 0) {
    c.availability("survival.healthEvidence.mode", "availabilityState=UNAVAILABLE", "no_scored_runs");
    return c.snapshot();
  }

  c.score("survival.deaths", "observations.survival.outcome");
  c.score("survival.activeCombat", "defensive/recovery per-combat-hour denominators");

  const anyDefensiveScored = input.scoredRuns.some((r) => r.defensive.state === "SCORED");
  const anyDefensiveNa = input.scoredRuns.some((r) => r.defensive.state === "NOT_APPLICABLE");
  if (anyDefensiveScored) {
    c.score("survival.defensiveActivations.byCategory", "observations.survival.defensive_response");
  } else if (anyDefensiveNa) {
    c.availability(
      "survival.defensiveActivations.byCategory",
      "defensive.state=NOT_APPLICABLE",
      "toolkit_not_applicable",
    );
  }

  c.availability("survival.defensiveActivations.toolkit", "defensive component applicability");
  c.confidence(
    "survival.defensiveActivations.catalogCoverage",
    "confidence.catalogCoverageMean",
  );

  const anyRecoveryScored = input.scoredRuns.some((r) => r.recovery.state === "SCORED");
  const anyRecoveryNa = input.scoredRuns.some((r) => r.recovery.state === "NOT_APPLICABLE");
  if (anyRecoveryScored) {
    c.score("survival.dangerWindows", "observations.survival.emergency_recovery");
    c.score("survival.dangerWindows.recoveryUseful", "observations.survival.emergency_recovery");
  } else if (anyRecoveryNa) {
    c.availability(
      "survival.dangerWindows",
      "recovery.state=NOT_APPLICABLE",
      "no_danger_windows",
    );
    c.availability(
      "survival.dangerWindows.recoveryUseful",
      "recovery.state=NOT_APPLICABLE",
      "no_eligible_windows",
    );
  }

  c.confidence("survival.dangerWindows.hpEvidenceQuality", "confidence via healthModes");
  c.confidence("survival.healthEvidence.mode", "confidence / explanation.healthModes");

  const mode = input.relativeDamageMode;
  if (mode === "off") {
    c.explain(
      "survival.relativeDamage",
      "relativeDamageShadow",
      "relativeDamageMode=off",
    );
  } else if (mode === "shadow") {
    c.explain(
      "survival.relativeDamage",
      "relativeDamageShadow (publicContribution=0)",
      null,
    );
  } else if (input.hasScore) {
    c.score("survival.relativeDamage", "observations.survival.relative_avoidable_damage");
  } else {
    c.explain(
      "survival.relativeDamage",
      "relativeDamageShadow",
      "active_mode_but_no_weight_contribution",
    );
  }

  return c.snapshot();
}
