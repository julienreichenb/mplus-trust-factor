import { describe, expect, it } from "vitest";
import {
  classifyDatasetStatus,
  classifyDimensionExecutable,
  classifyOverallVerdict,
  summarizeMissingDungeonSlots,
} from "./classify.js";

describe("scoring-v2 live character probe classify", () => {
  it("classifies empty-but-valid datasets", () => {
    expect(
      classifyDatasetStatus({
        required: true,
        requested: true,
        available: true,
        eventCount: 0,
        pageCount: 1,
      }),
    ).toBe("EMPTY_VALID");
  });

  it("classifies truncated datasets as PARTIAL", () => {
    expect(
      classifyDatasetStatus({
        required: true,
        requested: true,
        available: true,
        eventCount: 100,
        pageCount: 12,
        truncated: true,
      }),
    ).toBe("PARTIAL");
  });

  it("classifies dimension executable from calculator availability", () => {
    expect(
      classifyDimensionExecutable({
        calculated: true,
        availability: "PARTIAL",
        missingFields: [],
        failureReasons: [],
      }),
    ).toBe("PARTIAL");
    expect(
      classifyDimensionExecutable({
        calculated: false,
        availability: null,
        missingFields: ["ranking_parse"],
        failureReasons: ["missing_ranking_parse_evidence"],
      }),
    ).toBe("PARTIAL");
  });

  it("returns READY when all dimensions executable with full hydration", () => {
    const ready = {
      executable: "YES" as const,
      calculated: true,
      availability: "AVAILABLE",
      missingFields: [],
      failureReasons: [],
    };
    expect(
      classifyOverallVerdict({
        dungeonCount: 8,
        selectedSlotCount: 16,
        expectedSlotCount: 16,
        fullyHydratedSlots: 16,
        discoveryFailed: false,
        datasetFailedSlots: 0,
        factExtractionFailedSlots: 0,
        performance: ready,
        survival: ready,
        utility: ready,
        experience: ready,
      }),
    ).toBe("READY_FOR_SINGLE_CHARACTER_SHADOW");
  });

  it("blocks on discovery when no slots selected", () => {
    const no = {
      executable: "NO" as const,
      calculated: false,
      availability: null,
      missingFields: [],
      failureReasons: [],
    };
    expect(
      classifyOverallVerdict({
        dungeonCount: 8,
        selectedSlotCount: 0,
        expectedSlotCount: 16,
        fullyHydratedSlots: 0,
        discoveryFailed: false,
        datasetFailedSlots: 0,
        factExtractionFailedSlots: 0,
        performance: no,
        survival: no,
        utility: no,
        experience: no,
      }),
    ).toBe("BLOCKED_BY_DISCOVERY");
  });

  it("summarizes missing dungeon slots without inventing eligibility", () => {
    expect(
      summarizeMissingDungeonSlots({
        activeDungeonSlugs: ["skyreach", "pit-of-saron"],
        slots: [
          { dungeonSlug: "skyreach", slotIndex: 0, state: "SELECTED" },
          { dungeonSlug: "skyreach", slotIndex: 1, state: "MISSING" },
        ],
      }),
    ).toEqual([
      {
        dungeonSlug: "skyreach",
        missingSlotIndexes: [1],
        reason: "insufficient_eligible_logged_runs",
      },
      {
        dungeonSlug: "pit-of-saron",
        missingSlotIndexes: [0, 1],
        reason: "character_has_no_eligible_logged_run",
      },
    ]);
  });

  it("treats non-selected manifest placeholders as no eligible run", () => {
    expect(
      summarizeMissingDungeonSlots({
        activeDungeonSlugs: ["algethar-academy"],
        slots: [
          { dungeonSlug: "algethar-academy", slotIndex: 0, state: "MISSING_NO_CANDIDATE" },
          { dungeonSlug: "algethar-academy", slotIndex: 1, state: "MISSING_NO_CANDIDATE" },
        ],
      }),
    ).toEqual([
      {
        dungeonSlug: "algethar-academy",
        missingSlotIndexes: [0, 1],
        reason: "character_has_no_eligible_logged_run",
      },
    ]);
  });
});
