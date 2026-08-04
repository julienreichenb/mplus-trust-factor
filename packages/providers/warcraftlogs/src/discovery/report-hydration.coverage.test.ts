/**
 * Coverage-aware fightUnknown hydration — progressive report opening until
 * 2 distinct eligible identities per active dungeon, budget exhaustion, or
 * no more public stubs. Never hydrates the same report twice.
 */
import { describe, expect, it, vi } from "vitest";
import {
  hydrateFightUnknownCandidates,
  type HydrationReportPayload,
  type HydrationHint,
} from "./report-hydration.js";
import type { WclRunCandidate } from "../types.js";

function fightUnknownStub(
  reportCode: string,
  startTimeMs: number,
): WclRunCandidate {
  return {
    reportCode,
    fightId: 0,
    encounterId: 0,
    zoneId: null,
    dungeonSlug: null,
    seasonSlug: null,
    keyLevel: null,
    score: null,
    startTimeMs,
    completedAt: new Date(startTimeMs + 1_800_000).toISOString(),
    durationMs: null,
    timed: null,
    selectionTags: [],
    source: "recentReports",
    matchConfidence: null,
    targetActorId: null,
    incompleteness: {
      dungeonUnknown: true,
      seasonUnknown: true,
      timedUnknown: true,
      keyLevelUnknown: true,
      rosterIncomplete: true,
      fightUnknown: true,
    },
    warnings: ["stub"],
  };
}

function publicReport(input: {
  code: string;
  dungeonSlug: string;
  fightId: number;
  encounterID?: number;
  includeTarget?: boolean;
}): HydrationReportPayload {
  const includeTarget = input.includeTarget !== false;
  return {
    code: input.code,
    startTime: 1_750_000_000_000,
    visibility: "public",
    zone: { id: 47, name: "Mythic+" },
    fights: [
      {
        id: input.fightId,
        encounterID: input.encounterID ?? 0,
        name: input.dungeonSlug,
        keystoneLevel: 12,
        keystoneBonus: 1,
        startTime: 0,
        endTime: 1_800_000,
        friendlyPlayers: includeTarget ? [1] : [99],
      },
    ],
    masterData: {
      actors: [
        { id: 1, name: "Wallidrixe", type: "Player", server: "Archimonde" },
        { id: 99, name: "Other", type: "Player", server: "Archimonde" },
      ],
    },
  };
}

const ACTIVE = [
  "magisters-terrace",
  "pit-of-saron",
  "maisara-caverns",
  "nexus-point-xenas",
  "algethar-academy",
  "seat-of-the-triumvirate",
  "skyreach",
  "windrunner-spire",
] as const;

describe("coverage-aware hydrateFightUnknownCandidates", () => {
  it("continues past newest N reports when later reports complete dungeon coverage", async () => {
    // Newest 4 reports only cover magisters-terrace + pit-of-saron.
    // Later reports fill the remaining six dungeons (2 each would need more;
    // here we prove hydration continues until full 2/dungeon or budget).
    const stubs = [
      fightUnknownStub("NEW1", 1_000_008),
      fightUnknownStub("NEW2", 1_000_007),
      fightUnknownStub("NEW3", 1_000_006),
      fightUnknownStub("NEW4", 1_000_005),
      fightUnknownStub("OLD1", 1_000_004),
      fightUnknownStub("OLD2", 1_000_003),
      fightUnknownStub("OLD3", 1_000_002),
      fightUnknownStub("OLD4", 1_000_001),
      fightUnknownStub("OLD5", 1_000_000),
      fightUnknownStub("OLD6", 999_999),
      fightUnknownStub("OLD7", 999_998),
      fightUnknownStub("OLD8", 999_997),
      fightUnknownStub("OLD9", 999_996),
      fightUnknownStub("OLD10", 999_995),
      fightUnknownStub("OLD11", 999_994),
      fightUnknownStub("OLD12", 999_993),
    ];

    const byCode: Record<string, HydrationReportPayload> = {
      NEW1: publicReport({ code: "NEW1", dungeonSlug: "magisters-terrace", fightId: 1 }),
      NEW2: publicReport({ code: "NEW2", dungeonSlug: "magisters-terrace", fightId: 2 }),
      NEW3: publicReport({ code: "NEW3", dungeonSlug: "pit-of-saron", fightId: 1 }),
      NEW4: publicReport({ code: "NEW4", dungeonSlug: "pit-of-saron", fightId: 2 }),
      OLD1: publicReport({ code: "OLD1", dungeonSlug: "maisara-caverns", fightId: 1 }),
      OLD2: publicReport({ code: "OLD2", dungeonSlug: "maisara-caverns", fightId: 2 }),
      OLD3: publicReport({ code: "OLD3", dungeonSlug: "nexus-point-xenas", fightId: 1 }),
      OLD4: publicReport({ code: "OLD4", dungeonSlug: "nexus-point-xenas", fightId: 2 }),
      OLD5: publicReport({ code: "OLD5", dungeonSlug: "algethar-academy", fightId: 1 }),
      OLD6: publicReport({ code: "OLD6", dungeonSlug: "algethar-academy", fightId: 2 }),
      OLD7: publicReport({
        code: "OLD7",
        dungeonSlug: "seat-of-the-triumvirate",
        fightId: 1,
      }),
      OLD8: publicReport({
        code: "OLD8",
        dungeonSlug: "seat-of-the-triumvirate",
        fightId: 2,
      }),
      OLD9: publicReport({ code: "OLD9", dungeonSlug: "skyreach", fightId: 1 }),
      OLD10: publicReport({ code: "OLD10", dungeonSlug: "skyreach", fightId: 2 }),
      OLD11: publicReport({ code: "OLD11", dungeonSlug: "windrunner-spire", fightId: 1 }),
      OLD12: publicReport({ code: "OLD12", dungeonSlug: "windrunner-spire", fightId: 2 }),
    };

    const fetchReport = vi.fn(async (code: string) => byCode[code] ?? null);

    const result = await hydrateFightUnknownCandidates({
      candidates: stubs,
      characterName: "Wallidrixe",
      realmSlug: "archimonde",
      activeDungeonSlugs: ACTIVE,
      maxReports: 24,
      fetchReport,
    });

    expect(result.diagnostics.targetCoverageReached).toBe(true);
    expect(result.diagnostics.stopReason).toBe("full_coverage");
    expect(result.hydratedReportCount).toBe(16);
    expect(fetchReport).toHaveBeenCalledTimes(16);
    for (const slug of ACTIVE) {
      expect(result.diagnostics.distinctCandidatesPerDungeon[slug]).toBe(2);
    }
    // Proves later reports were opened (not just newest 4 / 8).
    expect(fetchReport).toHaveBeenCalledWith("OLD12");
  });

  it("stops immediately once every dungeon has 2 distinct eligible candidates", async () => {
    const stubs = [
      fightUnknownStub("A1", 100),
      fightUnknownStub("A2", 99),
      fightUnknownStub("B1", 98),
      fightUnknownStub("B2", 97),
      fightUnknownStub("EXTRA", 96),
      fightUnknownStub("EXTRA2", 95),
    ];
    const byCode: Record<string, HydrationReportPayload> = {
      A1: publicReport({ code: "A1", dungeonSlug: "skyreach", fightId: 1 }),
      A2: publicReport({ code: "A2", dungeonSlug: "skyreach", fightId: 2 }),
      B1: publicReport({ code: "B1", dungeonSlug: "windrunner-spire", fightId: 1 }),
      B2: publicReport({ code: "B2", dungeonSlug: "windrunner-spire", fightId: 2 }),
      EXTRA: publicReport({ code: "EXTRA", dungeonSlug: "skyreach", fightId: 9 }),
      EXTRA2: publicReport({ code: "EXTRA2", dungeonSlug: "windrunner-spire", fightId: 9 }),
    };
    const fetchReport = vi.fn(async (code: string) => byCode[code] ?? null);

    const result = await hydrateFightUnknownCandidates({
      candidates: stubs,
      characterName: "Wallidrixe",
      realmSlug: "archimonde",
      activeDungeonSlugs: ["skyreach", "windrunner-spire"],
      maxReports: 24,
      fetchReport,
    });

    expect(result.diagnostics.stopReason).toBe("full_coverage");
    expect(result.hydratedReportCount).toBe(4);
    expect(fetchReport).toHaveBeenCalledTimes(4);
    expect(fetchReport).not.toHaveBeenCalledWith("EXTRA");
    expect(result.diagnostics.reportsLeftUnhydratedBudget).toBeGreaterThan(0);
  });

  it("remains bounded when full coverage cannot be achieved", async () => {
    const stubs = Array.from({ length: 40 }, (_, i) =>
      fightUnknownStub(`R${i}`, 1_000_000 - i),
    );
    // Every report only yields magisters-terrace — other dungeons stay empty.
    const fetchReport = vi.fn(async (code: string) =>
      publicReport({
        code,
        dungeonSlug: "magisters-terrace",
        fightId: 1,
      }),
    );

    const result = await hydrateFightUnknownCandidates({
      candidates: stubs,
      characterName: "Wallidrixe",
      realmSlug: "archimonde",
      activeDungeonSlugs: ACTIVE,
      maxReports: 10,
      fetchReport,
    });

    expect(result.hydratedReportCount).toBe(10);
    expect(fetchReport).toHaveBeenCalledTimes(10);
    expect(result.diagnostics.stopReason).toBe("budget_exhausted");
    expect(result.diagnostics.targetCoverageReached).toBe(false);
    expect(result.diagnostics.reportsLeftUnhydratedBudget).toBeGreaterThan(0);
    expect(result.diagnostics.distinctCandidatesPerDungeon["magisters-terrace"]).toBe(10);
    expect(result.diagnostics.distinctCandidatesPerDungeon["skyreach"] ?? 0).toBe(0);
  });

  it("does not hydrate the same report code twice", async () => {
    const stubs = [
      fightUnknownStub("SAME", 100),
      // Duplicate stub for same report (deduped before fetch).
      { ...fightUnknownStub("SAME", 100), fightId: 0 },
      fightUnknownStub("OTHER", 90),
    ];
    const fetchReport = vi.fn(async (code: string) =>
      publicReport({
        code,
        dungeonSlug: code === "SAME" ? "skyreach" : "windrunner-spire",
        fightId: 1,
      }),
    );

    await hydrateFightUnknownCandidates({
      candidates: stubs,
      characterName: "Wallidrixe",
      realmSlug: "archimonde",
      activeDungeonSlugs: ["skyreach", "windrunner-spire"],
      maxReports: 8,
      fetchReport,
    });

    const sameCalls = fetchReport.mock.calls.filter(([c]) => c === "SAME");
    expect(sameCalls).toHaveLength(1);
  });

  it("does not count ownership-rejected fights toward coverage", async () => {
    const stubs = [
      fightUnknownStub("OWNED", 100),
      fightUnknownStub("REJECT", 90),
      fightUnknownStub("OWNED2", 80),
    ];
    const fetchReport = vi.fn(async (code: string) => {
      if (code === "REJECT") {
        return publicReport({
          code,
          dungeonSlug: "skyreach",
          fightId: 1,
          includeTarget: false,
        });
      }
      return publicReport({
        code,
        dungeonSlug: "skyreach",
        fightId: code === "OWNED" ? 1 : 2,
      });
    });

    const result = await hydrateFightUnknownCandidates({
      candidates: stubs,
      characterName: "Wallidrixe",
      realmSlug: "archimonde",
      activeDungeonSlugs: ["skyreach"],
      maxReports: 8,
      fetchReport,
    });

    expect(result.diagnostics.distinctCandidatesPerDungeon["skyreach"]).toBe(2);
    expect(result.diagnostics.rejectionCountsByReason.ownership_target_not_in_fight).toBe(1);
    const known = result.candidates.filter((c) => !c.incompleteness.fightUnknown);
    expect(known.every((c) => c.reportCode !== "REJECT" || c.fightId !== 1)).toBe(true);
    // REJECT report was fetched but produced no eligible candidate — coverage came from OWNED/OWNED2.
    expect(known.map((c) => c.reportCode).sort()).toEqual(["OWNED", "OWNED2"]);
  });

  it("prioritizes under-covered dungeon hints over pure recency", async () => {
    const stubs = [
      fightUnknownStub("RECENT_COVERED", 1_000_100),
      fightUnknownStub("OLDER_MISSING", 1_000_000),
    ];
    const hints: HydrationHint[] = [
      {
        completedAt: new Date(1_000_100).toISOString(),
        dungeonSlug: "skyreach",
        keyLevel: 12,
      },
      {
        completedAt: new Date(1_000_000).toISOString(),
        dungeonSlug: "windrunner-spire",
        keyLevel: 12,
      },
    ];
    // Seed one skyreach candidate so skyreach is covered; windrunner still missing.
    const seed: WclRunCandidate = {
      ...fightUnknownStub("SEED", 1_000_200),
      fightId: 7,
      dungeonSlug: "skyreach",
      keyLevel: 12,
      incompleteness: {
        dungeonUnknown: false,
        seasonUnknown: true,
        timedUnknown: false,
        keyLevelUnknown: false,
        rosterIncomplete: true,
        fightUnknown: false,
      },
    };
    // Need a second skyreach + two windrunner for full coverage of 2 dungeons.
    // With one skyreach already, under-covered is skyreach (needs 1 more) and windrunner (needs 2).
    // Hint on OLDER_MISSING points at windrunner — should be preferred when skyreach hits 2.
    const order: string[] = [];
    const fetchReport = vi.fn(async (code: string) => {
      order.push(code);
      return publicReport({
        code,
        dungeonSlug: code === "RECENT_COVERED" ? "skyreach" : "windrunner-spire",
        fightId: 1,
      });
    });

    await hydrateFightUnknownCandidates({
      candidates: [seed, ...stubs, fightUnknownStub("W2", 999_000)],
      characterName: "Wallidrixe",
      realmSlug: "archimonde",
      hints,
      activeDungeonSlugs: ["skyreach", "windrunner-spire"],
      maxReports: 8,
      fetchReport,
    });

    // After seeding 1 skyreach, first fetch should prefer filling coverage.
    // RECENT_COVERED fills skyreach to 2; then windrunner stubs.
    expect(order[0]).toBe("RECENT_COVERED");
    expect(order).toContain("OLDER_MISSING");
  });
});
