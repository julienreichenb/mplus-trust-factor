import { describe, expect, it } from "vitest";
import { OPERATIONS } from "../operations/queries.js";
import { REPORT_FIGHT_RANKINGS_FIELD } from "./report-fight-rankings-field.js";

describe("production fight rankings field", () => {
  it("requests UI Key % rankings exactly once on ReportWithFightAndMasterData", () => {
    expect(REPORT_FIGHT_RANKINGS_FIELD).toBe(
      "rankings(fightIDs: $fightIDs, compare: Rankings, playerMetric: dps, timeframe: Today)",
    );
    const q = OPERATIONS.ReportWithFightAndMasterData.query;
    expect([...q.matchAll(/\brankings\s*\(/g)]).toHaveLength(1);
    expect(q).toContain(REPORT_FIGHT_RANKINGS_FIELD);
    expect(q).not.toMatch(/compare:\s*Parses/);
    expect(OPERATIONS.ReportEvents.query).not.toMatch(/\brankings\s*\(/);
  });
});
