import { describe, expect, it } from "vitest";
import {
  collectUnavailableEncounters,
  isEligibleMplusFight,
  parseJsonScalar,
  selectHighestRatedRunPerEncounter,
  zoneEncounterIdSet,
} from "./performance-probe-logic.js";
import type { EligibleLoggedRun, ProbeFightRow, ProbeZoneEncounter } from "./types.js";

const ENCOUNTERS: ProbeZoneEncounter[] = [
  { id: 1201, name: "Ara-Kara", dungeonSlug: "ara-kara-city-of-echoes" },
  { id: 1202, name: "Eco-Dome", dungeonSlug: "eco-dome-al'dani" },
];

function fight(overrides: Partial<ProbeFightRow> = {}): ProbeFightRow {
  return {
    id: 1,
    encounterID: 1201,
    name: "Ara-Kara",
    difficulty: 10,
    kill: true,
    inProgress: false,
    startTime: 1000,
    endTime: 2000,
    keystoneLevel: 12,
    keystoneTime: 1800000,
    rating: 310,
    startTimeAbsolute: "2026-01-01T00:00:01.000Z",
    endTimeAbsolute: "2026-01-01T00:00:02.000Z",
    ...overrides,
  };
}

function run(overrides: Partial<EligibleLoggedRun> = {}): EligibleLoggedRun {
  return {
    reportCode: "AbCdEf12XyZ3",
    fightID: 1,
    encounterID: 1201,
    encounterName: "Ara-Kara",
    dungeonSlug: "ara-kara-city-of-echoes",
    rating: 310,
    keystoneLevel: 12,
    keystoneTime: 1800000,
    kill: true,
    startTimeMs: 1000,
    endTimeMs: 2000,
    startTimeAbsolute: "2026-01-01T00:00:01.000Z",
    endTimeAbsolute: "2026-01-01T00:00:02.000Z",
    reportStartTimeMs: 0,
    ...overrides,
  };
}

describe("performance-probe-logic", () => {
  it("parses JSON scalar strings permissively", () => {
    expect(parseJsonScalar('{"rankings":[]}')).toEqual({ rankings: [] });
    expect(parseJsonScalar("not-json")).toBe("not-json");
    expect(parseJsonScalar({ ok: true })).toEqual({ ok: true });
  });

  it("filters eligible mythic+ fights", () => {
    const zoneIds = zoneEncounterIdSet(ENCOUNTERS);
    expect(isEligibleMplusFight(fight(), zoneIds)).toBe(true);
    expect(isEligibleMplusFight(fight({ encounterID: 9999 }), zoneIds)).toBe(false);
    expect(isEligibleMplusFight(fight({ kill: false }), zoneIds)).toBe(false);
    expect(isEligibleMplusFight(fight({ inProgress: true }), zoneIds)).toBe(false);
    expect(isEligibleMplusFight(fight({ rating: null }), zoneIds)).toBe(false);
    expect(isEligibleMplusFight(fight({ keystoneLevel: null }), zoneIds)).toBe(false);
  });

  it("selects highest rating per encounter without failing on missing dungeons", () => {
    const selected = selectHighestRatedRunPerEncounter([
      run({ rating: 280, fightID: 1 }),
      run({ rating: 320, fightID: 2 }),
      run({ encounterID: 1202, rating: 250, fightID: 3, dungeonSlug: "eco-dome-al'dani" }),
      run({ encounterID: 1202, rating: 290, fightID: 4, dungeonSlug: "eco-dome-al'dani" }),
    ]);
    expect(selected).toHaveLength(2);
    expect(selected.find((s) => s.encounterID === 1201)?.rating).toBe(320);
    expect(selected.find((s) => s.encounterID === 1202)?.rating).toBe(290);

    const unavailable = collectUnavailableEncounters(
      [
        ...ENCOUNTERS,
        { id: 1203, name: "Halls", dungeonSlug: "halls-of-atonement" },
      ],
      selected,
    );
    expect(unavailable).toEqual([
      {
        encounterID: 1203,
        encounterName: "Halls",
        dungeonSlug: "halls-of-atonement",
        reason: "no_eligible_logged_run",
      },
    ]);
  });
});
