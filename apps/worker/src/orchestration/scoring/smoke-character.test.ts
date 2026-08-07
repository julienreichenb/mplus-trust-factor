import { describe, expect, it } from "vitest";
import {
  buildSmokeRunsTable,
  formatSmokeRunsTableText,
} from "./smoke-runs-table.js";

describe("smoke runs table", () => {
  it("lists all expected slots and separates missing ones", () => {
    const table = buildSmokeRunsTable({
      expectedSlots: [
        { dungeonName: "Skyreach", dungeonSlug: "skyreach", slotIndex: 0 },
        { dungeonName: "Skyreach", dungeonSlug: "skyreach", slotIndex: 1 },
        {
          dungeonName: "Pit Of Saron",
          dungeonSlug: "pit-of-saron",
          slotIndex: 0,
        },
        {
          dungeonName: "Pit Of Saron",
          dungeonSlug: "pit-of-saron",
          slotIndex: 1,
        },
      ],
      selectedRuns: [
        {
          dungeonSlug: "skyreach",
          slotIndex: 0,
          reportCode: "abc",
          fightId: 1,
          reportRevision: 2,
        },
        {
          dungeonSlug: "pit-of-saron",
          slotIndex: 0,
          reportCode: "def",
          fightId: 9,
          reportRevision: 10,
        },
      ],
      keyByFight: new Map([
        ["abc:1", 22],
        ["def:9", 22],
      ]),
      manifestSlotsByKey: new Map([
        [
          "skyreach:0",
          {
            state: "SELECTED",
            selectionReason: "SELECTED",
            invalidReasons: [],
            keyLevel: 22,
            reportCode: "abc",
            fightId: 1,
            reportRevision: 2,
          },
        ],
        [
          "skyreach:1",
          {
            state: "MISSING_NO_CANDIDATE",
            selectionReason: null,
            invalidReasons: ["NO_ELIGIBLE_CANDIDATE"],
            keyLevel: null,
            reportCode: null,
            fightId: null,
            reportRevision: null,
          },
        ],
      ]),
    });

    expect(table.expectedCount).toBe(4);
    expect(table.selectedCount).toBe(2);
    expect(table.missingCount).toBe(2);
    expect(table.rows.map((r) => `${r.dungeon}:${r.slot}:${r.state}`)).toEqual([
      "Pit Of Saron:0:SELECTED",
      "Pit Of Saron:1:MISSING_NO_CANDIDATE",
      "Skyreach:0:SELECTED",
      "Skyreach:1:MISSING_NO_CANDIDATE",
    ]);
    expect(table.missingRows[0]?.reason).toBe("MISSING_NO_CANDIDATE");
    expect(table.rows.find((r) => r.dungeon === "Skyreach" && r.slot === 1)?.reason).toBe(
      "NO_ELIGIBLE_CANDIDATE",
    );

    const text = formatSmokeRunsTableText(table);
    expect(text).toContain("Selected runs: 2/4");
    expect(text).toContain("Missing slots: 2");
    expect(text).toContain("MISSING / REJECTED");
    expect(text).toContain("Skyreach");
  });

  it("prefers CharacterScore selection over mismatched SELECTED manifest slots", () => {
    const table = buildSmokeRunsTable({
      expectedSlots: [
        {
          dungeonName: "Windrunner Spire",
          dungeonSlug: "windrunner-spire",
          slotIndex: 1,
        },
      ],
      selectedRuns: [],
      keyByFight: new Map(),
      manifestSlotsByKey: new Map([
        [
          "windrunner-spire:1",
          {
            state: "SELECTED",
            selectionReason: "SELECTED",
            invalidReasons: [],
            keyLevel: 21,
            reportCode: "stale",
            fightId: 4,
            reportRevision: 1,
          },
        ],
      ]),
    });

    expect(table.rows[0]?.state).toBe("MISSING_NO_CANDIDATE");
    expect(table.rows[0]?.report).toBeNull();
  });
});
