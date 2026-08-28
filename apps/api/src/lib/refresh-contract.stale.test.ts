import { describe, expect, it } from "vitest";
import {
  OBSERVATION_SCHEMA_VERSION,
  RUN_SELECTION_VERSION,
  type RefreshContractVersions,
} from "@mplus/contracts";
import {
  appendRefreshContractWarnings,
  isScoreStaleVersusProviders,
  scoreSnapshotContractStaleReasons,
} from "./profile-enrichment.js";

const baseContract: RefreshContractVersions = {
  scoringModelKey: "default",
  scoringModelVersion: 3,
  observationSchemaVersion: OBSERVATION_SCHEMA_VERSION,
  wclAdapterVersion: "points-and-damage-v1",
  blizzardAdapterVersion: "blizzard-wow-profile-2026-07",
  raiderIoAdapterVersion: "0.62.5",
  runSelectionVersion: RUN_SELECTION_VERSION,
  abilityCatalogVersion: "12.0.0/midnight-season-1",

  abilityCatalogExecutionKey: "static:12.0.0/midnight-season-1",
  mechanicCatalogVersion: "0.1.0-seed",
  activeSeasonId: "midnight-season-1",
  zoneId: 47,
  partition: null,
};

describe("refresh contract profile stale semantics", () => {
  it("existing character + new modelVersion marks snapshot stale", () => {
    const reasons = scoreSnapshotContractStaleReasons({
      score: {
        modelKey: "default",
        modelVersion: 3,
        explanation: { refreshContract: baseContract },
      },
      activeModel: { key: "default", version: 4 },
      activeContract: { ...baseContract, scoringModelVersion: 4 },
    });
    expect(reasons).toContain("SCORING_MODEL_CHANGED");
  });

  it("failed refresh retains old snapshot but marks it stale", () => {
    const warnings = appendRefreshContractWarnings([], ["REFRESH_FAILED"]);
    expect(warnings.some((w) => w.code === "REFRESH_FAILED")).toBe(true);
    expect(
      isScoreStaleVersusProviders("2026-07-28T16:04:46.000Z", [
        { fetchedAt: "2026-07-28T20:02:00.000Z" },
      ]),
    ).toBe(true);
  });

  it("successful refresh with matching contract is not contract-stale", () => {
    expect(
      scoreSnapshotContractStaleReasons({
        score: {
          modelKey: "default",
          modelVersion: 3,
          explanation: { refreshContract: baseContract },
        },
        activeModel: { key: "default", version: 3 },
        activeContract: baseContract,
      }),
    ).toEqual([]);
    expect(
      isScoreStaleVersusProviders("2026-07-28T20:10:00.000Z", [
        { fetchedAt: "2026-07-28T20:09:00.000Z" },
      ]),
    ).toBe(false);
  });
});
