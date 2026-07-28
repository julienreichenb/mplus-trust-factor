import { describe, expect, it } from "vitest";
import {
  hashRefreshContract,
  isRefreshContractCompatible,
  isScoreSnapshotModelStale,
  OBSERVATION_SCHEMA_VERSION,
  parseRefreshContract,
  refreshContractStaleReasons,
  RUN_SELECTION_VERSION,
  type RefreshContractVersions,
} from "./refresh-contract.js";

const base: RefreshContractVersions = {
  scoringModelKey: "default",
  scoringModelVersion: 3,
  observationSchemaVersion: OBSERVATION_SCHEMA_VERSION,
  wclAdapterVersion: "points-and-damage-v1",
  blizzardAdapterVersion: "blizzard-wow-profile-2026-07",
  raiderIoAdapterVersion: "0.62.5",
  runSelectionVersion: RUN_SELECTION_VERSION,
  abilityCatalogVersion: "12.0.0/midnight-season-1",
  mechanicCatalogVersion: "0.1.0-seed",
  activeSeasonId: "midnight-season-1",
  zoneId: 47,
  partition: null,
};

describe("refresh contract", () => {
  it("hashes stably and detects field bumps", () => {
    const a = hashRefreshContract(base);
    const b = hashRefreshContract({ ...base });
    expect(a).toBe(b);
    expect(hashRefreshContract({ ...base, scoringModelVersion: 4 })).not.toBe(a);
    expect(hashRefreshContract({ ...base, observationSchemaVersion: "observations-v2" })).not.toBe(
      a,
    );
    expect(hashRefreshContract({ ...base, wclAdapterVersion: "points-and-damage-v2" })).not.toBe(a);
    expect(hashRefreshContract({ ...base, runSelectionVersion: "active-season-eight-v2" })).not.toBe(
      a,
    );
  });

  it("reports stale reasons for model / observation / adapter / selection bumps", () => {
    expect(refreshContractStaleReasons(base, { ...base, scoringModelVersion: 4 })).toEqual([
      "SCORING_MODEL_CHANGED",
    ]);
    expect(
      refreshContractStaleReasons(base, {
        ...base,
        observationSchemaVersion: "observations-v2",
      }),
    ).toEqual(["OBSERVATION_SCHEMA_CHANGED"]);
    expect(
      refreshContractStaleReasons(base, { ...base, wclAdapterVersion: "points-and-damage-v2" }),
    ).toEqual(["WCL_ADAPTER_CHANGED"]);
    expect(
      refreshContractStaleReasons(base, {
        ...base,
        runSelectionVersion: "active-season-eight-v2",
      }),
    ).toEqual(["RUN_SELECTION_CHANGED"]);
  });

  it("treats missing stored contract as incompatible", () => {
    expect(isRefreshContractCompatible(null, base)).toBe(false);
    expect(parseRefreshContract({ scoringModelKey: "default" })).toBeNull();
    expect(isScoreSnapshotModelStale({ modelKey: "default", modelVersion: 3 }, { key: "default", version: 4 })).toBe(
      true,
    );
    expect(isScoreSnapshotModelStale({ modelKey: "default", modelVersion: 3 }, { key: "default", version: 3 })).toBe(
      false,
    );
  });
});
