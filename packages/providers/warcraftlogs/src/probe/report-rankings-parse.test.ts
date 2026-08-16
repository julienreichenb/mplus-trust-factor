import { describe, expect, it } from "vitest";
import { OPERATIONS } from "../operations/queries.js";
import {
  alignRankingRowsToFightActors,
  friendlyActorsMissingRankings,
  parseReportRankingsJson,
  readFiniteNumber,
} from "./report-rankings-parse.js";

const OWN_STYLE_PAYLOAD = {
  data: [
    {
      fightID: 7,
      roles: {
        tanks: {
          characters: [
            {
              id: 1,
              name: "TankA",
              server: { name: "Ravencrest" },
              spec: "Protection",
              class: "Warrior",
              amount: 100,
              rankPercent: 99,
              bracketPercent: 96,
            },
          ],
        },
        healers: {
          characters: [
            {
              id: 2,
              name: "HealA",
              server: { name: "Ravencrest" },
              spec: "Restoration",
              class: "Shaman",
              amount: 200,
              rankPercent: 90,
              bracketPercent: 82,
            },
          ],
        },
        dps: {
          characters: [
            {
              id: 3,
              name: "Own",
              server: { name: "Ravencrest" },
              spec: "Frost",
              class: "Mage",
              amount: 1,
              rankPercent: 99,
              bracketPercent: 0,
            },
            {
              id: 4,
              name: "DpsB",
              server: { name: "Ravencrest" },
              spec: "Havoc",
              class: "DemonHunter",
              amount: 300,
              rankPercent: 99,
              bracketPercent: 99,
            },
            {
              id: 5,
              name: "DpsC",
              server: { name: "Ravencrest" },
              spec: "Fury",
              class: "Warrior",
              amount: 280,
              rankPercent: 98,
              bracketPercent: 95,
            },
          ],
        },
      },
    },
  ],
};

describe("report rankings parser (probe)", () => {
  it("treats bracketPercent 0 as a valid percentile", () => {
    expect(readFiniteNumber(0)).toBe(0);
    const parsed = parseReportRankingsJson({ rankings: OWN_STYLE_PAYLOAD, fightId: 7 });
    const own = parsed.rows.find((r) => r.name === "Own");
    expect(own?.bracketPercent).toBe(0);
    expect(own?.rankPercent).toBe(99);
    expect(own?.percentileDiagnostics.bracket).toBeUndefined();
  });

  it("aligns ranking rows to fight friendlyPlayers actor ids", () => {
    const parsed = parseReportRankingsJson({ rankings: OWN_STYLE_PAYLOAD, fightId: 7 });
    const actors = [
      { id: 1, name: "TankA", type: "Player", server: "Ravencrest" },
      { id: 2, name: "HealA", type: "Player", server: "Ravencrest" },
      { id: 3, name: "Own", type: "Player", server: "Ravencrest" },
      { id: 4, name: "DpsB", type: "Player", server: "Ravencrest" },
      { id: 5, name: "DpsC", type: "Player", server: "Ravencrest" },
      { id: 99, name: "NotInFight", type: "Player", server: "Ravencrest" },
    ];
    const aligned = alignRankingRowsToFightActors({
      rows: parsed.rows,
      actors,
      friendlyPlayers: [1, 2, 3, 4, 5],
    });
    expect(aligned.every((r) => r.alignment === "name_server")).toBe(true);
    expect(friendlyActorsMissingRankings({ rows: aligned, actors, friendlyPlayers: [1, 2, 3, 4, 5] })).toEqual(
      [],
    );
  });

  it("aligns ranking WCL character ids to report actor ids via name+server", () => {
    const parsed = parseReportRankingsJson({
      rankings: {
        data: [
          {
            fightID: 5,
            roles: {
              dps: {
                characters: [
                  {
                    id: 8693457,
                    name: "Own",
                    server: { name: "Ravencrest" },
                    spec: "Frost",
                    rankPercent: 99,
                    bracketPercent: 0,
                  },
                ],
              },
            },
          },
        ],
      },
      fightId: 5,
    });
    const aligned = alignRankingRowsToFightActors({
      rows: parsed.rows,
      actors: [{ id: 4, name: "Own", type: "Player", server: "Ravencrest" }],
      friendlyPlayers: [4],
    });
    expect(aligned[0]?.wclCharacterId).toBe(8693457);
    expect(aligned[0]?.actorId).toBe(4);
    expect(aligned[0]?.alignment).toBe("name_server");
    expect(aligned[0]?.bracketPercent).toBe(0);
  });

  it("preserves diagnostic percentile fields including 0", () => {
    const parsed = parseReportRankingsJson({
      rankings: {
        data: [
          {
            fightID: 5,
            roles: {
              dps: {
                characters: [
                  {
                    id: 1,
                    name: "Own",
                    server: { name: "Ravencrest" },
                    rankPercent: 99,
                    bracketPercent: 0,
                    bracket: 0,
                    bracketData: 23,
                    best: 0,
                    totalParses: 12,
                  },
                ],
              },
            },
          },
        ],
      },
      fightId: 5,
    });
    expect(parsed.rows[0]?.bracketPercent).toBe(0);
    expect(parsed.rows[0]?.percentileDiagnostics.bracket).toBe(0);
    expect(parsed.rows[0]?.percentileDiagnostics.best).toBe(0);
    expect(parsed.rows[0]?.percentileDiagnostics.totalParses).toBe(12);
  });

  it("keeps malformed ranking rows unavailable instead of fabricating percents", () => {
    const parsed = parseReportRankingsJson({
      rankings: { data: [{ fightID: 1, roles: { dps: { characters: [{ id: 8, name: "X" }] } } }] },
      fightId: 1,
    });
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]?.bracketPercent).toBeNull();
    expect(parsed.rows[0]?.rankPercent).toBeNull();
  });

  it("keeps peer rows separate from the subject", () => {
    const parsed = parseReportRankingsJson({ rankings: OWN_STYLE_PAYLOAD, fightId: 7 });
    const brackets = parsed.rows
      .map((r) => r.bracketPercent)
      .filter((v): v is number => v != null)
      .sort((a, b) => a - b);
    expect(brackets).toEqual([0, 82, 95, 96, 99]);
    expect(parsed.rows).toHaveLength(5);
  });

  it("never joins ranking global character id to report-local actor id", () => {
    const aligned = alignRankingRowsToFightActors({
      rows: [
        {
          fightId: 1,
          actorId: null,
          wclCharacterId: 4,
          name: "Other",
          server: "Ravencrest",
          spec: null,
          className: null,
          role: "dps",
          metric: null,
          amount: null,
          rankPercent: 50,
          bracketPercent: 50,
          genericPercentile: null,
          percentileDiagnostics: {},
          alignment: "unaligned",
          extraKeys: [],
        },
      ],
      actors: [{ id: 4, name: "Own", type: "Player", server: "Ravencrest" }],
      friendlyPlayers: [4],
    });
    expect(aligned[0]?.actorId).toBeNull();
    expect(aligned[0]?.alignment).toBe("unaligned");
  });

  it("marks duplicate name+server matches as ambiguous", () => {
    const aligned = alignRankingRowsToFightActors({
      rows: [
        {
          fightId: 1,
          actorId: null,
          wclCharacterId: 99,
          name: "Own",
          server: "Ravencrest",
          spec: null,
          className: null,
          role: "dps",
          metric: null,
          amount: null,
          rankPercent: 1,
          bracketPercent: 0,
          genericPercentile: null,
          percentileDiagnostics: {},
          alignment: "unaligned",
          extraKeys: [],
        },
      ],
      actors: [
        { id: 4, name: "Own", type: "Player", server: "Ravencrest" },
        { id: 8, name: "Own", type: "Player", server: "Ravencrest" },
      ],
      friendlyPlayers: [4, 8],
    });
    expect(aligned[0]?.alignment).toBe("ambiguous");
    expect(aligned[0]?.actorId).toBeNull();
  });

  it("extends production ReportWithFightAndMasterData with UI Key % rankings args without dropping existing fields", () => {
    const q = OPERATIONS.ReportWithFightAndMasterData.query;
    expect(q).toMatch(
      /\brankings\s*\(\s*fightIDs:\s*\$fightIDs\s*,\s*compare:\s*Rankings\s*,\s*playerMetric:\s*dps\s*,\s*timeframe:\s*Today\s*\)/,
    );
    expect(q).not.toMatch(/compare:\s*Parses/);
    for (const field of [
      "code",
      "title",
      "revision",
      "startTime",
      "endTime",
      "visibility",
      "encounterID",
      "keystoneLevel",
      "keystoneBonus",
      "friendlyPlayers",
      "masterData",
      "actors",
      "abilities",
      "petOwner",
    ]) {
      expect(q).toContain(field);
    }
    expect(OPERATIONS.ReportEvents.query).not.toMatch(/\brankings\s*\(/);
    expect(OPERATIONS.ReportFightRankingsProbe.query).toMatch(/playerMetric:\s*dps/);
  });
});
