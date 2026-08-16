import { describe, expect, it } from "vitest";
import type { CanonicalDungeonEvidencePublicDTO } from "@mplus/contracts";
import {
  canonicalReportsForDungeon,
  canonicalRunSlotHeadline,
} from "./canonicalSelectedRuns";

const evidence: CanonicalDungeonEvidencePublicDTO[] = [
  {
    dungeonSlug: "the-rookery",
    dungeonName: "The Rookery",
    reports: [
      {
        identity: "PRIMARY",
        keyLevel: 22,
        completedAt: "2026-07-09T12:00:00.000Z",
        wclUrl: "https://www.warcraftlogs.com/reports/AAA?fight=1",
      },
      {
        identity: "SECONDARY",
        keyLevel: 20,
        completedAt: "2026-06-27T12:00:00.000Z",
        wclUrl: "https://www.warcraftlogs.com/reports/BBB?fight=2",
      },
    ],
  },
];

describe("canonical selected-run source", () => {
  it("looks up PRIMARY and SECONDARY from canonicalDungeonEvidence only", () => {
    const reports = canonicalReportsForDungeon(evidence, "rookery");
    expect(reports.map((row) => row.identity)).toEqual(["PRIMARY", "SECONDARY"]);
    expect(canonicalRunSlotHeadline(reports[0]!)).toMatch(/\+22/);
    expect(canonicalRunSlotHeadline(reports[1]!)).toMatch(/\+20/);
    expect(canonicalRunSlotHeadline(reports[0]!)).not.toContain("Log");
  });

  it("never uses a generic Log headline when key or date exist", () => {
    expect(
      canonicalRunSlotHeadline({
        identity: "SECONDARY",
        keyLevel: 21,
        completedAt: "2026-07-16T00:00:00.000Z",
        wclUrl: "https://www.warcraftlogs.com/reports/CCC?fight=3",
      }),
    ).toMatch(/\+21/);
    expect(
      canonicalRunSlotHeadline({
        identity: "SECONDARY",
        keyLevel: null,
        completedAt: null,
        wclUrl: "https://www.warcraftlogs.com/reports/CCC?fight=3",
      }),
    ).toBe("Secondary");
  });
});
