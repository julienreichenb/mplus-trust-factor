import { describe, expect, it } from "vitest";
import {
  isEnrichmentSoftSkip,
  mapErrorToProviderState,
  reconcileSources,
} from "./reconcile.js";
import { ExternalApiError } from "@mplus/contracts";
import { collectRaiderIoRuns, mergeRunSources } from "./run-fusion.js";
import type { MythicRunDTO, RaiderIoRunCandidate } from "@mplus/contracts";

describe("enrichment soft-skip", () => {
  it("soft-skips Raider.IO / WCL rate limits and timeouts", () => {
    expect(
      isEnrichmentSoftSkip(
        new ExternalApiError({
          message: "429",
          code: "RATE_LIMITED",
          provider: "raiderio",
          retryable: true,
        }),
      ),
    ).toBe(true);
    expect(
      isEnrichmentSoftSkip(
        new ExternalApiError({
          message: "timeout",
          code: "TIMEOUT",
          provider: "warcraftlogs",
          retryable: true,
        }),
      ),
    ).toBe(true);
  });

  it("maps errors to provider lifecycle states", () => {
    expect(
      mapErrorToProviderState(
        new ExternalApiError({ message: "429", code: "RATE_LIMITED", provider: "raiderio" }),
      ),
    ).toBe("RATE_LIMITED");
    expect(
      mapErrorToProviderState(
        new ExternalApiError({ message: "hidden", code: "UNAUTHORIZED", provider: "warcraftlogs" }),
      ),
    ).toBe("PRIVATE_OR_HIDDEN");
  });
});

describe("reconcileSources", () => {
  it("keeps Blizzard Mythic rating and Raider.IO score separate", () => {
    const result = reconcileSources({
      blizzard: {
        id: "char-1",
        region: "EU",
        realmSlug: "tarren-mill",
        normalizedName: "test",
        displayName: "Test",
        classSlug: "mage",
        specSlug: "frost",
        role: "DPS",
        blizzardCharacterId: "1",
        wclCanonicalId: null,
        raiderioProfileUrl: null,
        lastSeenAt: null,
        lastPublicRefreshAt: null,
      },
      blizzardItemLevel: 630,
      raiderIo: {
        region: "EU",
        realmSlug: "tarren-mill",
        normalizedName: "test",
        displayName: "Test",
        classSlug: "warrior",
        specSlug: "arms",
        role: "DPS",
        profileUrl: "https://raider.io/characters/eu/tarren-mill/Test",
        lastCrawledAt: null,
        crawlStale: false,
        gear: { itemLevelEquipped: 640, itemLevelTotal: 640, items: [] },
        talents: { present: false, shape: "absent" },
        currentSeason: {
          seasonSlug: "season-tww-3",
          scores: { all: 2100, dps: 2100, healer: null, tank: null },
          isCurrentSeason: true,
          isPreviousSeason: false,
        },
        previousSeason: null,
        ranks: null,
        recentRuns: [],
        bestRuns: [],
        highestLevelRuns: [],
        raidProgression: [],
        runHistoryIncomplete: false,
        representedRunCount: 0,
        attribution: {
          provider: "raiderio",
          displayText: "Data from Raider.IO",
          homepageUrl: "https://raider.io",
          profileUrl: "https://raider.io/characters/eu/tarren-mill/Test",
          sourceUrl: null,
        },
      },
      blizzardMythicRating: 2000,
    });

    expect(result.disagreements.some((d) => d.field === "classSlug")).toBe(true);
    expect(result.disagreements.some((d) => d.field === "itemLevelEquipped")).toBe(true);
    expect(
      result.disagreements.some(
        (d) => d.field === "mythicRating_vs_raiderIoScore" && d.resolution === "KEEP_BOTH",
      ),
    ).toBe(true);
  });
});

describe("run fusion", () => {
  it("merges overlapping provider runs into multi-source links", () => {
    const completedAt = "2026-07-20T18:00:00.000Z";
    const rio: MythicRunDTO = {
      id: "rio:1",
      region: "EU",
      seasonSlug: "season-tww-3",
      dungeonSlug: "ara-kara",
      keyLevel: 12,
      completedAt,
      durationMs: 1_800_000,
      timerMs: 2_000_000,
      timed: true,
      scoreValue: 120,
      canonicalFingerprint: "a",
      affixes: {},
      participants: [],
      sources: [
        {
          provider: "RAIDER_IO",
          externalRunId: "1",
          externalUrl: null,
          reportCode: null,
          fightId: null,
          revision: null,
        },
      ],
    };
    const wcl: MythicRunDTO = {
      ...rio,
      id: "wcl:1",
      canonicalFingerprint: "b",
      sources: [
        {
          provider: "WARCRAFT_LOGS",
          externalRunId: "CODE:1",
          externalUrl: null,
          reportCode: "CODE",
          fightId: 1,
          revision: 1,
        },
      ],
    };

    const merged = mergeRunSources([rio, wcl]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.sources.map((s) => s.provider).sort()).toEqual([
      "RAIDER_IO",
      "WARCRAFT_LOGS",
    ]);
  });

  it("collects unique Raider.IO recent/best runs", () => {
    const candidate: RaiderIoRunCandidate = {
      externalRunId: "run-1",
      seasonSlug: "season-tww-3",
      dungeonSlug: "ara-kara",
      dungeonName: "Ara-Kara",
      keyLevel: 10,
      completedAt: "2026-07-20T18:00:00.000Z",
      durationMs: 1_500_000,
      timerMs: 1_800_000,
      timed: true,
      scoreValue: 100,
      source: "recent",
      roster: [],
      rosterComplete: false,
      profileUrl: null,
    };
    const runs = collectRaiderIoRuns(
      [candidate],
      [{ ...candidate, source: "best" }],
      { region: "EU", realmSlug: "tarren-mill", name: "Test" },
    );
    expect(runs).toHaveLength(1);
    expect(runs[0]!.sources[0]!.provider).toBe("RAIDER_IO");
  });
});
