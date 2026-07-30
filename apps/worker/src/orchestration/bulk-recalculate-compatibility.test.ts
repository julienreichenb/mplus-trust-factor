import { describe, expect, it } from "vitest";
import {
  OBSERVATION_SCHEMA_VERSION,
  RUN_SELECTION_VERSION,
  type RefreshContractVersions,
} from "@mplus/contracts";
import { evaluateRecalculateCompatibility } from "./bulk-recalculate-compatibility.js";

function contract(overrides: Partial<RefreshContractVersions> = {}): RefreshContractVersions {
  return {
    scoringModelKey: "default",
    scoringModelVersion: 6,
    observationSchemaVersion: OBSERVATION_SCHEMA_VERSION,
    wclAdapterVersion: "wcl-v1",
    blizzardAdapterVersion: "blizz-v1",
    raiderIoAdapterVersion: "rio-v1",
    runSelectionVersion: RUN_SELECTION_VERSION,
    abilityCatalogVersion: "abilities-v1",
    mechanicCatalogVersion: "mechanics-v1",
    activeSeasonId: "blizzard-season-13",
    zoneId: 42,
    partition: null,
    ...overrides,
  };
}

describe("evaluateRecalculateCompatibility", () => {
  it("rejects missing season observations", () => {
    const result = evaluateRecalculateCompatibility({
      hasSeasonObservations: false,
      storedRefreshContract: contract(),
      currentRefreshContract: contract({ scoringModelVersion: 7 }),
    });
    expect(result.compatible).toBe(false);
    expect(result.reason).toBe("MISSING_SEASON_EVIDENCE");
  });

  it("allows scoring-model-only drift for Agent 08 recalculate", () => {
    const result = evaluateRecalculateCompatibility({
      hasSeasonObservations: true,
      storedRefreshContract: contract({ scoringModelVersion: 6 }),
      currentRefreshContract: contract({ scoringModelVersion: 7 }),
    });
    expect(result.compatible).toBe(true);
    expect(result.reason).toBeNull();
  });

  it("rejects adapter / run-selection / schema drift with explicit reason", () => {
    const result = evaluateRecalculateCompatibility({
      hasSeasonObservations: true,
      storedRefreshContract: contract({
        wclAdapterVersion: "old",
        runSelectionVersion: "legacy-selection",
      }),
      currentRefreshContract: contract(),
    });
    expect(result.compatible).toBe(false);
    expect(result.reason).toContain("INCOMPATIBLE_REFRESH_CONTRACT");
    expect(result.reason).toContain("WCL_ADAPTER_CHANGED");
    expect(result.reason).toContain("RUN_SELECTION_CHANGED");
  });

  it("rejects unknown evidence without stored contract or schema versions", () => {
    const result = evaluateRecalculateCompatibility({
      hasSeasonObservations: true,
      storedRefreshContract: null,
      currentRefreshContract: contract(),
      observationSchemaVersions: [null],
    });
    expect(result.compatible).toBe(false);
    expect(result.reason).toBe("MISSING_REFRESH_CONTRACT_AND_SCHEMA_VERSION");
  });
});
