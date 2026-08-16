import { describe, expect, it } from "vitest";
import {
  projectCanonicalDungeonEvidence,
  parsePersistedCanonicalEvidenceSlots,
  projectScoreCalculationPublic,
} from "./project-public-profile-extras.js";

describe("projectScoreCalculationPublic", () => {
  it("projects persisted weights and scores without inventing a formula", () => {
    const dto = projectScoreCalculationPublic({
      overallFormula: "WEIGHTED_DIMENSIONS",
      role: "HEALER",
      effectiveWeights: { performance: 0.4, survival: 0.3, utility: 0.2, experience: 0.1 },
      dimensionScores: { performance: 80, survival: 70, utility: 60, experience: 50 },
      performanceMix: { damageParse: 0.45, healingParse: 0.55, cooldown: 0 },
    });
    expect(dto.role).toBe("HEALER");
    expect(dto.components[0]?.contribution).toBe(32);
    expect(dto.performanceMix?.healingParse).toBe(0.55);
  });
});

describe("projectCanonicalDungeonEvidence", () => {
  it("uses scoring-run selection as PRIMARY when V2 slots are absent", () => {
    const rows = projectCanonicalDungeonEvidence({
      scoringRunSelection: {
        seasonSlug: "s",
        expectedDungeonCount: 8,
        selectedRuns: [
          {
            dungeonSlug: "ara-kara",
            dungeonName: "Ara-Kara",
            canonicalRunId: "run-1",
            keyLevel: 23,
            timed: true,
            completedAt: "2026-07-31T00:00:00.000Z",
            wclReportMatched: true,
            selectionReason: "HIGHEST_KEY",
            coverageRatio: 1,
          },
        ],
      },
      wclUrlByRunId: { "run-1": "https://www.warcraftlogs.com/reports/ABC" },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.reports[0]?.identity).toBe("PRIMARY");
    expect(rows[0]?.reports[0]?.wclUrl).toContain("warcraftlogs.com");
  });

  it("projects PRIMARY and SECONDARY URLs from persisted digest slots, not MythicRun.id", () => {
    const rows = projectCanonicalDungeonEvidence({
      persistedEvidenceSlots: parsePersistedCanonicalEvidenceSlots([
        {
          dungeonSlug: "ara-kara",
          dungeonName: "Ara-Kara",
          slotIndex: 0,
          reportCode: "PrimaryCode",
          fightId: 11,
          keyLevel: 23,
          completedAt: "2026-07-31T00:00:00.000Z",
        },
        {
          dungeonSlug: "ara-kara",
          slotIndex: 1,
          reportCode: "SecondaryCode",
          fightId: 7,
          keyLevel: 22,
          completedAt: "2026-07-27T00:00:00.000Z",
        },
      ]),
      scoringRunSelection: {
        seasonSlug: "s",
        expectedDungeonCount: 8,
        selectedRuns: [
          {
            dungeonSlug: "ara-kara",
            dungeonName: "Ara-Kara",
            canonicalRunId: "mythic-primary-only",
            keyLevel: 23,
            timed: true,
            completedAt: "2026-07-31T00:00:00.000Z",
            wclReportMatched: true,
            selectionReason: "HIGHEST_KEY",
            coverageRatio: 1,
          },
        ],
      },
      wclUrlByRunId: { "mythic-primary-only": "https://www.warcraftlogs.com/reports/SHOULD_NOT_WIN" },
    });
    expect(rows[0]?.reports).toHaveLength(2);
    expect(rows[0]?.reports[0]).toMatchObject({
      identity: "PRIMARY",
      keyLevel: 23,
      wclUrl: "https://www.warcraftlogs.com/reports/PrimaryCode?fight=11&type=damage-done",
    });
    expect(rows[0]?.reports[1]).toMatchObject({
      identity: "SECONDARY",
      keyLevel: 22,
      wclUrl: "https://www.warcraftlogs.com/reports/SecondaryCode?fight=7&type=damage-done",
    });
    expect(JSON.stringify(rows)).not.toContain("reportCode");
    expect(JSON.stringify(rows)).not.toContain("fightId");
    expect(JSON.stringify(rows)).not.toContain("SHOULD_NOT_WIN");
  });

  it("coerces string keyLevel/fightId and fills missing labels from V2 + PRIMARY selection", () => {
    const rows = projectCanonicalDungeonEvidence({
      persistedEvidenceSlots: parsePersistedCanonicalEvidenceSlots([
        {
          dungeonSlug: "ara-kara",
          slotIndex: "0",
          reportCode: "PrimaryCode",
          fightId: "11",
        },
        {
          dungeonSlug: "ara-kara",
          slotIndex: 1,
          reportCode: "SecondaryCode",
          fightId: 7,
          keyLevel: "22",
        },
      ]),
      explainabilityV2: {
        selectedRuns: [
          { dungeonSlug: "ara-kara", slotIndex: 0, keyLevel: 23, timed: true, state: "SELECTED", hasWclSource: true },
          { dungeonSlug: "ara-kara", slotIndex: 1, keyLevel: 21, timed: true, state: "SELECTED", hasWclSource: true },
        ],
      } as never,
      scoringRunSelection: {
        seasonSlug: "s",
        expectedDungeonCount: 8,
        selectedRuns: [
          {
            dungeonSlug: "ara-kara",
            dungeonName: "Ara-Kara",
            canonicalRunId: "run-1",
            keyLevel: 23,
            timed: true,
            completedAt: "2026-07-31T00:00:00.000Z",
            wclReportMatched: true,
            selectionReason: "HIGHEST_KEY",
            coverageRatio: 1,
          },
        ],
      },
    });
    expect(rows[0]?.reports[0]).toMatchObject({
      identity: "PRIMARY",
      keyLevel: 23,
      completedAt: "2026-07-31T00:00:00.000Z",
      wclUrl: "https://www.warcraftlogs.com/reports/PrimaryCode?fight=11&type=damage-done",
    });
    expect(rows[0]?.reports[1]).toMatchObject({
      identity: "SECONDARY",
      keyLevel: 22,
      wclUrl: "https://www.warcraftlogs.com/reports/SecondaryCode?fight=7&type=damage-done",
    });
  });

  it("fills labels when WCL and canonical dungeon slugs differ only by hyphens", () => {
    const rows = projectCanonicalDungeonEvidence({
      persistedEvidenceSlots: parsePersistedCanonicalEvidenceSlots([
        {
          dungeonSlug: "pitofsaron",
          slotIndex: 0,
          reportCode: "PrimaryCode",
          fightId: 11,
        },
        {
          dungeonSlug: "pitofsaron",
          slotId: "pitofsaron:1",
          reportCode: "SecondaryCode",
          fightId: 7,
          digest: { keyLevel: 21, startTimeMs: Date.parse("2026-07-27T00:00:00.000Z") },
        },
      ]),
      explainabilityV2: {
        selectedRuns: [
          {
            dungeonSlug: "pit-of-saron",
            slotIndex: 1,
            keyLevel: 21,
            timed: true,
            state: "SELECTED",
            hasWclSource: true,
          },
        ],
      } as never,
      scoringRunSelection: {
        seasonSlug: "s",
        expectedDungeonCount: 8,
        selectedRuns: [
          {
            dungeonSlug: "pit-of-saron",
            dungeonName: "Pit of Saron",
            canonicalRunId: "run-1",
            keyLevel: 24,
            timed: true,
            completedAt: "2026-07-31T00:00:00.000Z",
            wclReportMatched: true,
            selectionReason: "HIGHEST_KEY",
            coverageRatio: 1,
          },
        ],
      },
      wclUrlByRunId: { "run-1": "https://www.warcraftlogs.com/reports/PrimaryCode" },
    });
    expect(rows[0]?.reports[0]).toMatchObject({
      identity: "PRIMARY",
      keyLevel: 24,
      completedAt: "2026-07-31T00:00:00.000Z",
    });
    expect(rows[0]?.reports[1]).toMatchObject({
      identity: "SECONDARY",
      keyLevel: 21,
    });
  });

  it("fills SECONDARY key from evidence-manifest slots when V2 is unpublished", () => {
    const rows = projectCanonicalDungeonEvidence({
      persistedEvidenceSlots: parsePersistedCanonicalEvidenceSlots([
        {
          dungeonSlug: "windrunnerspire",
          slotIndex: 0,
          reportCode: "PrimaryCode",
          fightId: 11,
        },
        {
          dungeonSlug: "windrunnerspire",
          slotIndex: 1,
          reportCode: "SecondaryCode",
          fightId: 7,
        },
      ]),
      manifestSlots: [
        { dungeonSlug: "windrunner-spire", slotIndex: 0, keyLevel: 22 },
        { dungeonSlug: "windrunner-spire", slotIndex: 1, keyLevel: 20 },
      ],
      scoringRunSelection: {
        seasonSlug: "s",
        expectedDungeonCount: 8,
        selectedRuns: [
          {
            dungeonSlug: "windrunner-spire",
            dungeonName: "Windrunner Spire",
            canonicalRunId: "run-1",
            keyLevel: 22,
            timed: true,
            completedAt: "2026-07-26T00:00:00.000Z",
            wclReportMatched: true,
            selectionReason: "HIGHEST_KEY",
            coverageRatio: 1,
          },
        ],
      },
    });
    expect(rows[0]?.reports[1]).toMatchObject({
      identity: "SECONDARY",
      keyLevel: 20,
      wclUrl: "https://www.warcraftlogs.com/reports/SecondaryCode?fight=7&type=damage-done",
    });
  });

  it("fills SECONDARY key by matching the same WCL fight as DPS digests, even when slugs differ", () => {
    const rows = projectCanonicalDungeonEvidence({
      persistedEvidenceSlots: parsePersistedCanonicalEvidenceSlots([
        {
          dungeonSlug: "wcl-windrunner",
          slotIndex: 0,
          reportCode: "PrimaryCode",
          fightId: 11,
        },
        {
          dungeonSlug: "wcl-windrunner",
          slotIndex: 1,
          reportCode: "SecondaryCode",
          fightId: 7,
        },
      ]),
      manifestSlots: [
        {
          dungeonSlug: "windrunner-spire",
          slotIndex: 0,
          keyLevel: 22,
          reportCode: "PrimaryCode",
          fightId: 11,
        },
        {
          dungeonSlug: "windrunner-spire",
          slotIndex: 1,
          keyLevel: 20,
          reportCode: "SecondaryCode",
          fightId: 7,
        },
      ],
    });
    expect(rows[0]?.reports[0]?.keyLevel).toBe(22);
    expect(rows[0]?.reports[1]).toMatchObject({
      identity: "SECONDARY",
      keyLevel: 20,
    });
    expect(JSON.stringify(rows)).not.toContain('"reportCode"');
  });

  it("gives SECONDARY its own key/date from digest facts, never PRIMARY copies", () => {
    const rows = projectCanonicalDungeonEvidence({
      persistedEvidenceSlots: parsePersistedCanonicalEvidenceSlots([
        { dungeonSlug: "ara-kara", slotIndex: 0, reportCode: "PrimaryCode", fightId: 11 },
        { dungeonSlug: "ara-kara", slotIndex: 1, reportCode: "SecondaryCode", fightId: 7 },
      ]),
      digestFacts: [
        {
          reportCode: "SecondaryCode",
          fightId: 7,
          keyLevel: 20,
          completedAt: "2026-06-27T00:00:00.000Z",
        },
        {
          reportCode: "PrimaryCode",
          fightId: 11,
          keyLevel: 22,
          completedAt: "2026-07-09T00:00:00.000Z",
        },
      ],
      scoringRunSelection: {
        seasonSlug: "s",
        expectedDungeonCount: 8,
        selectedRuns: [
          {
            dungeonSlug: "ara-kara",
            dungeonName: "Ara-Kara",
            canonicalRunId: "run-1",
            keyLevel: 99,
            timed: true,
            completedAt: "2026-01-01T00:00:00.000Z",
            wclReportMatched: true,
            selectionReason: "HIGHEST_KEY",
            coverageRatio: 1,
          },
        ],
      },
    });
    expect(rows[0]?.reports[0]).toMatchObject({
      identity: "PRIMARY",
      keyLevel: 22,
      completedAt: "2026-07-09T00:00:00.000Z",
    });
    expect(rows[0]?.reports[1]).toMatchObject({
      identity: "SECONDARY",
      keyLevel: 20,
      completedAt: "2026-06-27T00:00:00.000Z",
    });
    expect(rows[0]?.reports[1]?.keyLevel).not.toBe(99);
    expect(rows[0]?.reports[1]?.completedAt).not.toBe("2026-01-01T00:00:00.000Z");
  });

  it("embeds cooldown timeline on PRIMARY only and omits SECONDARY event arrays", () => {
    const primaryTimeline = {
      status: "AVAILABLE" as const,
      durationMs: 120_000,
      events: [
        {
          timestampMs: 1_000,
          kind: "COOLDOWN" as const,
          dimension: "PERFORMANCE" as const,
          type: "offensive cooldown",
          abilityId: 1,
          abilityName: "Avatar",
          iconUrl: null,
        },
      ],
      truncated: false,
      totalEventCount: 1,
    };
    const rows = projectCanonicalDungeonEvidence({
      persistedEvidenceSlots: parsePersistedCanonicalEvidenceSlots([
        { dungeonSlug: "ara-kara", slotIndex: 0, reportCode: "PrimaryCode", fightId: 11 },
        { dungeonSlug: "ara-kara", slotIndex: 1, reportCode: "SecondaryCode", fightId: 7 },
      ]),
      cooldownByFightKey: {
        "primarycode:11": primaryTimeline,
        "secondarycode:7": primaryTimeline,
      },
    });
    expect(rows[0]?.reports[0]?.cooldownTimeline).toEqual(primaryTimeline);
    expect(rows[0]?.reports[1]?.cooldownTimeline).toBeNull();
  });

  it("keeps historical SECONDARY nulls when no slot-owned metadata exists", () => {
    const rows = projectCanonicalDungeonEvidence({
      persistedEvidenceSlots: parsePersistedCanonicalEvidenceSlots([
        { dungeonSlug: "ara-kara", slotIndex: 1, reportCode: "SecondaryCode", fightId: 7 },
      ]),
      scoringRunSelection: {
        seasonSlug: "s",
        expectedDungeonCount: 8,
        selectedRuns: [
          {
            dungeonSlug: "ara-kara",
            dungeonName: "Ara-Kara",
            canonicalRunId: "run-1",
            keyLevel: 22,
            timed: true,
            completedAt: "2026-07-09T00:00:00.000Z",
            wclReportMatched: true,
            selectionReason: "HIGHEST_KEY",
            coverageRatio: 1,
          },
        ],
      },
    });
    expect(rows[0]?.reports[0]).toMatchObject({
      identity: "SECONDARY",
      keyLevel: null,
      completedAt: null,
      wclUrl: "https://www.warcraftlogs.com/reports/SecondaryCode?fight=7&type=damage-done",
    });
  });
});
