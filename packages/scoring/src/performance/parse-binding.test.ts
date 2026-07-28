import { describe, expect, it } from "vitest";
import { resolveSelectedRunParsePercentile } from "./parse-binding.js";

describe("selected-run parse binding", () => {
  const rankings = [
    {
      reportCode: "AAA",
      fightId: 1,
      bracket: 12,
      percentile: 70,
      rankPercent: 72,
    },
    {
      reportCode: "BBB",
      fightId: 2,
      bracket: 10,
      percentile: 95,
    },
    {
      reportCode: "CCC",
      fightId: 3,
      bracket: 8,
      percentile: 99,
    },
  ];

  it("ties parse to report+fight identity and prefers rankPercent", () => {
    const bound = resolveSelectedRunParsePercentile({
      rankings,
      reportCode: "AAA",
      fightId: 1,
      selectedKeyLevel: 12,
    });
    expect(bound.executionPercentile).toBe(72);
    expect(bound.usedRankPercent).toBe(true);
    expect(bound.bracketMatched).toBe(true);
    expect(bound.source).toBe("selected_fight_bracket_matched");
  });

  it("never substitutes character-wide best parses from another fight", () => {
    const bound = resolveSelectedRunParsePercentile({
      rankings,
      reportCode: "MISSING",
      fightId: 99,
      selectedKeyLevel: 12,
    });
    expect(bound.executionPercentile).toBeNull();
    expect(bound.source).toBe("unavailable");
    expect(bound.reason).toBe("parse_not_tied_to_selected_fight");
  });

  it("requires selected-run WCL identity", () => {
    const bound = resolveSelectedRunParsePercentile({
      rankings,
      reportCode: null,
      fightId: null,
      selectedKeyLevel: 12,
    });
    expect(bound.executionPercentile).toBeNull();
    expect(bound.reason).toBe("selected_run_missing_wcl_identity");
  });
});
