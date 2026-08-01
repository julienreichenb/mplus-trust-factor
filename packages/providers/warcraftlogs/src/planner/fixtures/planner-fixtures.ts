import type { DiscoverySourceRow } from "../discovery-plan.js";
import type { EvidenceFrozenSlotInput } from "../planner-types.js";

export const FIXTURE_ACTIVE_DUNGEONS = [
  "algethar-academy",
  "magisters-terrace",
  "maisara-caverns",
  "nexus-point-xenas",
] as const;

export function fixtureDiscoveryRows(): {
  zoneRankingCandidates: DiscoverySourceRow[];
  parseRows: DiscoverySourceRow[];
  recentReportCandidates: DiscoverySourceRow[];
  persistedWclSources: DiscoverySourceRow[];
} {
  return {
    zoneRankingCandidates: [
      {
        reportCode: "AbcDefGh",
        fightId: 1,
        dungeonSlug: "algethar-academy",
        keyLevel: 12,
        timed: true,
        runScore: 2400,
        completedAt: "2026-07-01T12:00:00.000Z",
        fightDurationMs: 1_800_000,
        actorId: null,
        reportRevision: null,
        source: "zone_rankings",
        visibility: "public",
        parsePercentile: 95,
      },
      {
        reportCode: "AbcDefGh",
        fightId: 2,
        dungeonSlug: "algethar-academy",
        keyLevel: 11,
        timed: true,
        runScore: 2300,
        completedAt: "2026-07-01T11:00:00.000Z",
        fightDurationMs: 1_900_000,
        actorId: null,
        reportRevision: null,
        source: "zone_rankings",
        visibility: "public",
      },
      {
        reportCode: "Private01",
        fightId: 1,
        dungeonSlug: "algethar-academy",
        keyLevel: 15,
        timed: true,
        runScore: 2800,
        completedAt: "2026-07-02T12:00:00.000Z",
        fightDurationMs: 1_700_000,
        actorId: null,
        reportRevision: null,
        source: "zone_rankings",
        visibility: "private",
      },
    ],
    parseRows: [
      {
        reportCode: "ParseRow1",
        fightId: 9,
        dungeonSlug: "magisters-terrace",
        keyLevel: 10,
        timed: null,
        runScore: 2100,
        completedAt: "2026-06-15T10:00:00.000Z",
        fightDurationMs: 2_000_000,
        actorId: 42,
        reportRevision: null,
        source: "parse_row",
        visibility: "public",
        parsePercentile: 88,
      },
    ],
    recentReportCandidates: [
      {
        reportCode: "Recent001",
        fightId: 3,
        dungeonSlug: "maisara-caverns",
        keyLevel: 8,
        timed: false,
        runScore: null,
        completedAt: "2026-07-10T08:00:00.000Z",
        fightDurationMs: 2_100_000,
        actorId: null,
        reportRevision: null,
        source: "recent_reports",
        visibility: "public",
      },
      // Duplicate of zone ranking row — should merge, prefer zone_rankings.
      {
        reportCode: "AbcDefGh",
        fightId: 1,
        dungeonSlug: "algethar-academy",
        keyLevel: 12,
        timed: true,
        runScore: 2400,
        completedAt: "2026-07-01T12:00:00.000Z",
        fightDurationMs: 1_800_000,
        actorId: 7,
        reportRevision: 2,
        source: "recent_reports",
        visibility: "public",
      },
    ],
    persistedWclSources: [
      {
        reportCode: "Persist1",
        fightId: 5,
        dungeonSlug: "nexus-point-xenas",
        keyLevel: 9,
        timed: true,
        runScore: 2000,
        completedAt: "2026-05-01T09:00:00.000Z",
        fightDurationMs: 1_950_000,
        actorId: 11,
        reportRevision: 4,
        source: "persisted_wcl",
        visibility: "public",
        identityResolution: "RESOLVED",
        fightAccessible: true,
      },
    ],
  };
}

export function fixtureFrozenSlots(): EvidenceFrozenSlotInput[] {
  return [
    {
      slotId: "slot-aa-0",
      dungeonSlug: "algethar-academy",
      identity: { reportCode: "AbcDefGh", fightId: 1, reportRevision: 2 },
      actorId: 7,
      startTime: 0,
      endTime: 1_800_000,
    },
    {
      slotId: "slot-aa-1",
      dungeonSlug: "algethar-academy",
      identity: { reportCode: "AbcDefGh", fightId: 2, reportRevision: 2 },
      actorId: 7,
      startTime: 0,
      endTime: 1_900_000,
    },
    {
      slotId: "slot-mt-0",
      dungeonSlug: "magisters-terrace",
      identity: { reportCode: "ParseRow1", fightId: 9, reportRevision: 1 },
      actorId: 42,
      startTime: 100,
      endTime: 2_000_100,
    },
  ];
}
