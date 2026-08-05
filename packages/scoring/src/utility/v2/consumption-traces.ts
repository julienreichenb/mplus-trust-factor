/**
 * Emit Utility feature consumption traces from a compute result domain breakdown.
 */

import type { UtilityV2ComputeResult, UtilityV2RunFactSet } from "./types.js";
import {
  FeatureConsumptionCollector,
  type FeatureConsumptionTrace,
} from "../../audit/consumption-trace.js";

export function emitUtilityConsumptionTraces(input: {
  boundFactSets: UtilityV2RunFactSet[];
  result: UtilityV2ComputeResult;
}): FeatureConsumptionTrace[] {
  const c = new FeatureConsumptionCollector();
  if (input.boundFactSets.length === 0 || input.result.availabilityState === "UNAVAILABLE") {
    c.availability("utility.toolkit", "availabilityState=UNAVAILABLE", "missing_or_unbound_facts");
    return c.snapshot();
  }

  c.score("utility.activeCombatMs", "domainBreakdown.*.perCombatHour denominators");
  c.availability("utility.toolkit", "domainBreakdown.*.applicable");

  const castStops = input.result.domainBreakdown.find((d) => d.domain === "castStops");
  if (castStops?.applicable) {
    c.score("utility.interruptAttempts.CONFIRMED_SUCCESS", "domainBreakdown.castStops");
    c.score("utility.interruptAttempts.VALID_OVERLAP", "domainBreakdown.castStops");
    c.score("utility.interruptAttempts.MATCHED_FAILED", "domainBreakdown.castStops");
    c.score("utility.interruptAttempts.UNMATCHED_ATTEMPT", "domainBreakdown.castStops (capped)");
  } else {
    c.availability(
      "utility.interruptAttempts.CONFIRMED_SUCCESS",
      "castStops.applicable=false",
      "toolkit_interrupt_absent_or_domain_neutral",
    );
  }

  c.confidence("utility.hostileObservability", "castStops density factor / confidence");

  const support = input.result.domainBreakdown.find((d) => d.domain === "support");
  if (support?.applicable) {
    c.score("utility.supportActions", "domainBreakdown.support");
    c.score("utility.dispelPurgeSuccessCount", "domainBreakdown.support");
  } else {
    c.availability(
      "utility.supportActions",
      "support.applicable=false",
      "no_support_toolkit_and_no_observed_support_neutral",
    );
  }

  const cc = input.result.domainBreakdown.find((d) => d.domain === "strategicCc");
  if (cc?.applicable) {
    c.score("utility.ccActions", "domainBreakdown.strategicCc");
  } else {
    c.availability(
      "utility.ccActions",
      "strategicCc.applicable=false",
      "toolkit_cc_absent_or_domain_neutral",
    );
  }

  c.confidence(
    "utility.catalogCoverage.abilityCatalogCoverage",
    "confidenceComponents.abilityCatalogCoverage",
  );
  c.confidence(
    "utility.catalogCoverage.mechanicCatalogCoverage",
    "confidenceComponents.mechanicCatalogCoverage",
  );

  return c.snapshot();
}
