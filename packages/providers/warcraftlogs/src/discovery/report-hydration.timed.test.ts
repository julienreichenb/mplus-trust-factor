import { describe, expect, it } from "vitest";
import {
  timedFromKeystoneBonus,
  type HydrationFight,
  type HydrationReportPayload,
} from "./report-hydration.js";
import { candidatesFromHydratedReport } from "./report-hydration.js";

describe("timedFromKeystoneBonus", () => {
  it("maps +1/+2/+3 to timed true", () => {
    expect(timedFromKeystoneBonus(1)).toBe(true);
    expect(timedFromKeystoneBonus(2)).toBe(true);
    expect(timedFromKeystoneBonus(3)).toBe(true);
  });

  it("maps depleted bonus 0 to timed false", () => {
    expect(timedFromKeystoneBonus(0)).toBe(false);
  });

  it("keeps unknown when bonus absent", () => {
    expect(timedFromKeystoneBonus(null)).toBeNull();
    expect(timedFromKeystoneBonus(undefined)).toBeNull();
  });
});

describe("candidatesFromHydratedReport timed", () => {
  const report: HydrationReportPayload = {
    code: "AbCdEf",
    startTime: 1_000_000,
    visibility: "public",
    zone: { id: 1, name: "Maisara Caverns" },
    fights: [
      {
        id: 1,
        encounterID: 0,
        name: "Maisara Caverns",
        kill: true,
        startTime: 0,
        endTime: 600_000,
        keystoneLevel: 12,
        keystoneBonus: 2,
        friendlyPlayers: [10],
      } satisfies HydrationFight,
    ],
    masterData: {
      actors: [{ id: 10, name: "Wallidrixe", type: "Player", server: "Archimonde" }],
    },
  };

  it("sets timed from keystoneBonus on hydrated M+ fights", () => {
    const { candidates } = candidatesFromHydratedReport(report, "Wallidrixe", "archimonde");
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.timed).toBe(true);
    expect(candidates[0]!.incompleteness.timedUnknown).toBe(false);
  });
});
