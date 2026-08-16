import { describe, expect, it } from "vitest";
import { reportFightSchema } from "./graphql-client.js";

describe("reportFightSchema rankings optionality", () => {
  const baseReport = {
    reportData: {
      report: {
        code: "AbCdEf12",
        title: "t",
        revision: 2,
        startTime: 1,
        endTime: 2,
        visibility: "public",
        fights: [
          {
            id: 5,
            encounterID: 1,
            name: "Algeth'ar Academy",
            difficulty: 10,
            kill: true,
            startTime: 1,
            endTime: 2,
            keystoneLevel: 23,
            friendlyPlayers: [4],
          },
        ],
        masterData: {
          actors: [{ id: 4, name: "Own", type: "Player", server: "Ravencrest" }],
          abilities: [],
        },
      },
    },
  };

  it("parses when rankings is absent", () => {
    const parsed = reportFightSchema.parse(baseReport);
    expect(parsed.reportData.report?.code).toBe("AbCdEf12");
    expect(parsed.reportData.report?.rankings).toBeUndefined();
  });

  it("parses when rankings is null", () => {
    const parsed = reportFightSchema.parse({
      reportData: { report: { ...baseReport.reportData.report, rankings: null } },
    });
    expect(parsed.reportData.report?.rankings).toBeNull();
  });

  it("keeps malformed rankings as opaque JSON without failing the report", () => {
    const parsed = reportFightSchema.parse({
      reportData: { report: { ...baseReport.reportData.report, rankings: "not-json{{" } },
    });
    expect(parsed.reportData.report?.rankings).toBe("not-json{{");
    expect(parsed.reportData.report?.fights[0]?.id).toBe(5);
  });
});
