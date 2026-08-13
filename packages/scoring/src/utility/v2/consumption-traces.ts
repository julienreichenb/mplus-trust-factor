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

  const castStops = input.result.domainBreakdown.find((d) => d.domain === "interrupt");
  if (castStops?.applicable) {
    c.score("utility.interruptAttempts.CONFIRMED_SUCCESS", "domainBreakdown.interrupt");
    c.score("utility.interruptAttempts.VALID_OVERLAP", "domainBreakdown.interrupt");
    c.score("utility.interruptAttempts.MATCHED_FAILED", "domainBreakdown.interrupt");
    c.score("utility.interruptAttempts.UNMATCHED_ATTEMPT", "domainBreakdown.interrupt (capped)");
  } else {
    c.availability(
      "utility.interruptAttempts.CONFIRMED_SUCCESS",
      "interrupt.applicable=false",
      "toolkit_interrupt_absent_or_excluded",
    );
  }

  c.confidence("utility.hostileObservability", "interrupt family / confidence");

  const support = input.result.domainBreakdown.find((d) => d.domain === "groupSupport");
  const dispel = input.result.domainBreakdown.find((d) => d.domain === "dispelPurge");
  if (support?.applicable || dispel?.applicable) {
    c.score("utility.supportActions", "domainBreakdown.groupSupport");
    c.score("utility.dispelPurgeSuccessCount", "domainBreakdown.dispelPurge");
  } else {
    c.availability(
      "utility.supportActions",
      "groupSupport.applicable=false",
      "no_support_toolkit_or_excluded",
    );
  }

  const cc = input.result.domainBreakdown.find((d) => d.domain === "crowdControl");
  if (cc?.applicable) {
    c.score("utility.ccActions", "domainBreakdown.crowdControl");
  } else {
    c.availability(
      "utility.ccActions",
      "crowdControl.applicable=false",
      "toolkit_cc_absent_or_excluded",
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
