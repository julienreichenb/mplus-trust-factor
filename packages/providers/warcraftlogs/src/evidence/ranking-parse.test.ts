import { describe, expect, it } from "vitest";
import { resolveRankingParseFromZoneRankings } from "./ranking-parse.js";
import type { ZoneRankingsPayload } from "../discovery/run-discovery.js";

describe("resolveRankingParseFromZoneRankings", () => {
  const payload: ZoneRankingsPayload = {
    metric: "playerscore",
    zone: 42,
    rankings: [
      {
        fightID: 7,
        encounterID: 100,
        report: { code: "AbCdEf12", startTime: 1 },
        bracket: 15,
        score: 200,
        amount: 1,
        bracketPercent: 88,
        rankPercent: 90,
        spec: "Demonology",
        role: "dps",
      },
    ],
  };

  it("binds the matching report/fight row to reportRevision", () => {
    const result = resolveRankingParseFromZoneRankings({
      payload,
      zoneId: 42,
      reportCode: "AbCdEf12",
      fightId: 7,
      reportRevision: 3,
      dungeonSlug: "skyreach",
      keyLevel: 15,
    });
    expect(result.unavailableReason).toBeNull();
    expect(result.evidence).toMatchObject({
      reportCode: "AbCdEf12",
      fightId: 7,
      reportRevision: 3,
      bracketPercent: 88,
      dungeonSlug: "skyreach",
    });
  });

  it("does not invent evidence from a different fight", () => {
    const result = resolveRankingParseFromZoneRankings({
      payload,
      zoneId: 42,
      reportCode: "AbCdEf12",
      fightId: 99,
      reportRevision: 3,
      dungeonSlug: "skyreach",
      keyLevel: 15,
    });
    expect(result.evidence).toBeNull();
    expect(result.unavailableReason).toBe("ranking_parse_row_absent");
  });

  it("reports empty payload precisely", () => {
    const result = resolveRankingParseFromZoneRankings({
      payload: { rankings: [] },
      zoneId: 42,
      reportCode: "AbCdEf12",
      fightId: 7,
      reportRevision: 1,
      dungeonSlug: "skyreach",
      keyLevel: 15,
    });
    expect(result.unavailableReason).toBe("ranking_parse_zone_payload_empty");
  });
});
