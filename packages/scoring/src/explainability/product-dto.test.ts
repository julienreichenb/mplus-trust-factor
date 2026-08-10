import { describe, expect, it } from "vitest";
import {
  buildScoreExplainabilityV1,
  contributorsFromLegacyConfidenceContext,
  contributorsFromPublicScoreDrivers,
  projectScoreExplainabilityPublic,
  productDimensionExplainabilityFields,
  tryParsePersistedScoreExplainability,
} from "./index.js";

describe("explainability product DTO helpers", () => {
  it("maps POSITIVE/NEGATIVE drivers and omits NEUTRAL from weaknesses", () => {
    const contributors = contributorsFromPublicScoreDrivers([
      {
        code: "a",
        labelKey: "a",
        label: "A",
        direction: "POSITIVE",
        value: 80,
      },
      {
        code: "b",
        labelKey: "b",
        label: "B",
        direction: "NEGATIVE",
        value: 20,
      },
      {
        code: "c",
        labelKey: "c",
        label: "C",
        direction: "NEUTRAL",
        value: 50,
      },
    ]);
    expect(contributors.positive).toEqual([{ metricKey: "a", label: "A" }]);
    expect(contributors.negative).toEqual([{ metricKey: "b", label: "B" }]);
    expect(contributors.limitations).toEqual([]);
  });

  it("legacy confidence context never fabricates weaknesses", () => {
    const contributors = contributorsFromLegacyConfidenceContext([
      "incomplete_dungeon_coverage",
    ]);
    expect(contributors.limitations).toEqual(["incomplete_dungeon_coverage"]);
    expect(contributors.negative).toEqual([]);
    expect(contributors.positive).toEqual([]);
  });

  it("serialize → parse → public projection is stable", () => {
    const canonical = buildScoreExplainabilityV1({
      performance: null,
      survival: null,
      utility: null,
      experience: {
        score: 0,
        available: true,
        previousStandingScore: 0,
        classRankFloor: null,
        classRankFloorApplied: false,
        eliteFloorApplied: false,
        confirmedEliteTitleCount: 0,
        confidence: 1,
        confidenceCauses: [],
        reason: null,
      },
      composite: null,
    });

    const roundTripped = tryParsePersistedScoreExplainability(
      JSON.parse(JSON.stringify(canonical)),
    );
    expect(roundTripped).not.toBeNull();
    expect(projectScoreExplainabilityPublic(roundTripped!)).toEqual(
      projectScoreExplainabilityPublic(canonical),
    );
    expect(
      productDimensionExplainabilityFields(roundTripped!, "EXPERIENCE"),
    ).toEqual(productDimensionExplainabilityFields(canonical, "EXPERIENCE"));
  });

  it("soft-fails unknown persisted payloads", () => {
    expect(tryParsePersistedScoreExplainability(null)).toBeNull();
    expect(tryParsePersistedScoreExplainability({ schemaVersion: "x" })).toBeNull();
  });
});
