import { describe, expect, it } from "vitest";
import {
  isCapabilityPackageAcceptableForScoring,
  type CapabilityCoverageV1,
  type EvidenceCapability,
} from "./capability-evidence-v1.js";
import { refineWclDataState } from "./warcraftlogs.js";

function coverage(
  capability: EvidenceCapability,
  opts: Partial<CapabilityCoverageV1> & { requiredDatasets: string[] },
): CapabilityCoverageV1 {
  return {
    capability,
    filterIdentity: "test",
    pageCount: 1,
    eventCount: opts.complete === false ? 0 : 1,
    firstTimestampMs: 0,
    lastTimestampMs: 1000,
    nextPageTimestamp: null,
    stopReason: opts.stopReason ?? "NEXT_PAGE_NULL",
    complete: opts.complete ?? true,
    limitations: opts.limitations ?? [],
    sourceArtifactIds: [],
    ...opts,
  };
}

function utilityCompleteRows(): CapabilityCoverageV1[] {
  return [
    coverage("UTILITY_INTERRUPTS", { requiredDatasets: ["Interrupts"] }),
    coverage("UTILITY_DISPELS", { requiredDatasets: ["Dispels"] }),
    coverage("UTILITY_CROWD_CONTROL", { requiredDatasets: ["Casts", "Debuffs"] }),
    coverage("UTILITY_EXTERNAL_CASTS", { requiredDatasets: ["Casts"] }),
    coverage("UTILITY_EXTERNAL_TARGET_CONTEXT", { requiredDatasets: ["Buffs"] }),
    coverage("UTILITY_HOSTILE_CASTS", { requiredDatasets: ["HostileCasts"] }),
    coverage("PARTICIPANT_METADATA", { requiredDatasets: ["masterData"] }),
    coverage("ACTOR_OWNERSHIP", { requiredDatasets: ["masterData"] }),
  ];
}

describe("isCapabilityPackageAcceptableForScoring", () => {
  it("accepts fully complete packages", () => {
    expect(
      isCapabilityPackageAcceptableForScoring({
        complete: true,
        coverage: utilityCompleteRows(),
      }),
    ).toBe(true);
  });

  it("accepts Survival-incomplete packages when Utility capabilities are complete", () => {
    const coverageRows = [
      ...utilityCompleteRows(),
      coverage("SURVIVAL_DAMAGE_TAKEN", {
        requiredDatasets: ["DamageTaken"],
        complete: false,
        stopReason: "MISSING_REQUIRED_BATCH",
      }),
      coverage("SURVIVAL_DEATHS", { requiredDatasets: ["Deaths"] }),
      coverage("SURVIVAL_DEFENSIVE_ACTIVATIONS", {
        requiredDatasets: ["Casts", "Buffs"],
      }),
      coverage("SURVIVAL_RECOVERY_ACTIVATIONS", {
        requiredDatasets: ["Casts", "Buffs"],
      }),
    ];
    expect(
      isCapabilityPackageAcceptableForScoring({
        complete: false,
        coverage: coverageRows,
      }),
    ).toBe(true);
  });

  it("rejects packages with failed shared prerequisites", () => {
    const coverageRows = [
      ...utilityCompleteRows().filter((r) => r.capability !== "ACTOR_OWNERSHIP"),
      coverage("ACTOR_OWNERSHIP", {
        requiredDatasets: ["masterData"],
        complete: false,
        stopReason: "MISSING_REQUIRED_BATCH",
      }),
    ];
    expect(
      isCapabilityPackageAcceptableForScoring({
        complete: false,
        coverage: coverageRows,
      }),
    ).toBe(false);
  });
});

describe("refineWclDataState detailed evidence", () => {
  it("promotes RANKINGS_ONLY to MATCHED_COMBAT_LOGS when digests exist", () => {
    expect(
      refineWclDataState({
        visibility: "PUBLIC",
        baseDataState: "RANKINGS_ONLY",
        combatFactsCount: 0,
        dungeonAggregateCount: 8,
        detailedEvidenceCount: 8,
      }),
    ).toBe("MATCHED_COMBAT_LOGS");
  });
});
