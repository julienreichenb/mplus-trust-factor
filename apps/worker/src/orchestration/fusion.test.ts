import { describe, expect, it } from "vitest";
import {
  isEnrichmentSoftSkip,
  mapErrorToProviderState,
  mapWclVisibilityToState,
  reconcileSources,
} from "./reconcile.js";
import { ExternalApiError } from "@mplus/contracts";
import {
  collectRaiderIoRuns,
  computeCrossProviderRunKey,
  ensureTargetParticipant,
  filterRunsToActiveWindow,
  fuseCrossProviderRuns,
  mergeRunSources,
} from "./run-fusion.js";
import type { MythicRunDTO, RaiderIoRunCandidate, RunSourceRefDTO } from "@mplus/contracts";

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
        seasons: [
          {
            seasonSlug: "season-tww-3",
            scores: { all: 2100, dps: 2100, healer: null, tank: null },
            isCurrentSeason: true,
            isPreviousSeason: false,
          },
        ],
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
    expect(merged[0]!.canonicalFingerprint).toBe(merged[0]!.canonicalFingerprint);
  });

  it("deduplicates Blizzard + Raider.IO + WCL via cross-provider fingerprints (Wallidrixe shape)", () => {
    const completedAt = "2026-07-18T21:10:00.000Z";
    const blizzard: MythicRunDTO = {
      id: "blizz:1",
      region: "EU",
      seasonSlug: "blizzard-season-13",
      dungeonSlug: "ara-kara",
      keyLevel: 14,
      completedAt,
      durationMs: 1_700_000,
      timerMs: 2_000_000,
      timed: true,
      scoreValue: 210,
      canonicalFingerprint: "provider-blizzard-unique",
      affixes: {},
      participants: [
        {
          providerCharacterKey: "eu|kazzak|wallidrixe",
          displayName: "Wallidrixe",
          realmSlug: "kazzak",
          region: "EU",
          classSlug: "mage",
          specSlug: "fire",
          role: "DPS",
          itemLevel: 684,
          mythicRatingAtRun: null,
          isTargetCharacter: true,
          characterId: null,
        },
      ],
      sources: [
        {
          provider: "BLIZZARD",
          externalRunId: "blizz-1",
          externalUrl: null,
          reportCode: null,
          fightId: null,
          revision: null,
        },
      ],
    };
    const rio: MythicRunDTO = {
      ...blizzard,
      id: "rio:99",
      seasonSlug: "season-tww-3",
      canonicalFingerprint: "provider-rio-unique",
      completedAt: "2026-07-18T21:10:45.000Z",
      participants: [],
      sources: [
        {
          provider: "RAIDER_IO",
          externalRunId: "99",
          externalUrl: null,
          reportCode: null,
          fightId: null,
          revision: null,
        },
      ],
    };
    const wcl: MythicRunDTO = {
      ...blizzard,
      id: "wcl:ABC:3",
      seasonSlug: "unknown",
      canonicalFingerprint: "provider-wcl-unique",
      completedAt: "2026-07-18T21:11:20.000Z",
      participants: [],
      sources: [
        {
          provider: "WARCRAFT_LOGS",
          externalRunId: "ABC:3",
          externalUrl: null,
          reportCode: "ABC",
          fightId: 3,
          revision: 1,
        },
      ],
    };

    const merged = mergeRunSources([blizzard, rio, wcl]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.sources).toHaveLength(3);
    expect(merged[0]!.participants.some((p) => p.isTargetCharacter)).toBe(true);
    expect(merged[0]!.canonicalFingerprint).not.toBe("provider-blizzard-unique");
    expect(merged[0]!.canonicalFingerprint).not.toBe("provider-rio-unique");
    expect(merged[0]!.canonicalFingerprint).not.toBe("provider-wcl-unique");

    const withTarget = ensureTargetParticipant(
      { ...wcl, participants: [] },
      { region: "EU", realmSlug: "kazzak", name: "Wallidrixe" },
    );
    expect(withTarget.participants.some((p) => p.isTargetCharacter)).toBe(true);
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

  it("excludes historical Blizzard runs from the active matching window", () => {
    const nowMs = Date.parse("2026-07-27T12:00:00.000Z");
    const filtered = filterRunsToActiveWindow(
      [
        { completedAt: "2019-08-15T21:09:04.000Z", id: "old" },
        { completedAt: "2026-07-26T20:10:23.000Z", id: "current" },
      ],
      { nowMs },
    );
    expect(filtered.map((r) => r.id)).toEqual(["current"]);
  });

  it("merges RIO short dungeon aliases with WCL full dungeon slugs", () => {
    const completedAt = "2026-07-26T20:10:23.000Z";
    const rio: MythicRunDTO = {
      id: "rio",
      region: "EU",
      seasonSlug: "season-mn-1",
      dungeonSlug: "pos",
      keyLevel: 22,
      completedAt,
      durationMs: 1_700_000,
      timerMs: null,
      timed: true,
      scoreValue: 200,
      canonicalFingerprint: "rio",
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
      id: "wcl",
      dungeonSlug: "priory-of-the-sacred-flame",
      canonicalFingerprint: "wcl",
      sources: [
        {
          provider: "WARCRAFT_LOGS",
          externalRunId: "code:3",
          externalUrl: null,
          reportCode: "AbCdEf12XyZ3",
          fightId: 3,
          revision: null,
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

  it("counts one canonical fingerprint when the same run exists in Raider.IO and WCL", () => {
    const completedAt = "2026-07-11T17:48:56.000Z";
    const rio: MythicRunDTO = {
      id: "rio:mt-22",
      region: "EU",
      seasonSlug: "blizzard-season-3",
      dungeonSlug: "magisters-terrace",
      keyLevel: 22,
      completedAt,
      durationMs: 2_037_359,
      timerMs: null,
      timed: true,
      scoreValue: 240,
      canonicalFingerprint: "provider-rio-mt",
      affixes: {},
      participants: [],
      sources: [
        {
          provider: "RAIDER_IO",
          externalRunId: "rio-mt-22",
          externalUrl: null,
          reportCode: null,
          fightId: null,
          revision: null,
        },
      ],
    };
    const wcl: MythicRunDTO = {
      ...rio,
      id: "wcl:rmd1:4",
      completedAt: "2026-07-11T17:48:57.579Z",
      durationMs: 1_970_407,
      canonicalFingerprint: "provider-wcl-mt",
      sources: [
        {
          provider: "WARCRAFT_LOGS",
          externalRunId: "rmd1****HVD3:4",
          externalUrl: null,
          reportCode: "rmd1MaskedCode",
          fightId: 4,
          revision: 1,
        },
      ],
    };

    const providerRecordCount = rio.sources.length + wcl.sources.length;
    expect(providerRecordCount).toBe(2);

    const merged = mergeRunSources([rio, wcl]);
    const uniqueCanonicalFingerprints = new Set(
      merged.map((run) => run.canonicalFingerprint),
    );
    const sharedKey = computeCrossProviderRunKey({
      region: "EU",
      dungeonSlug: "magisters-terrace",
      keyLevel: 22,
      completedAt,
    });

    // seasonSummary.runCount semantics: unique canonical runs, not provider records.
    expect(merged).toHaveLength(1);
    expect(uniqueCanonicalFingerprints.size).toBe(1);
    expect(merged[0]!.canonicalFingerprint).toBe(sharedKey);
    expect(merged[0]!.sources).toHaveLength(2);
    expect(merged[0]!.sources.map((s) => s.provider).sort()).toEqual([
      "RAIDER_IO",
      "WARCRAFT_LOGS",
    ]);
  });

  it("merges when completion clocks diverge but duration aligns (match identity > fingerprint)", () => {
    const rio: MythicRunDTO = {
      id: "rio:aa",
      region: "EU",
      seasonSlug: "blizzard-season-3",
      dungeonSlug: "algethar-academy",
      keyLevel: 22,
      completedAt: "2026-07-26T14:27:56.000Z",
      durationMs: 1_813_086,
      timerMs: null,
      timed: true,
      scoreValue: 250,
      canonicalFingerprint: "rio-aa",
      affixes: {},
      participants: [],
      sources: [
        {
          provider: "RAIDER_IO",
          externalRunId: "rio-aa",
          externalUrl: null,
          reportCode: null,
          fightId: null,
          revision: null,
        },
      ],
    };
    const wcl: MythicRunDTO = {
      ...rio,
      id: "wcl:aa",
      // ~30 minutes later on the clock, but same key duration (±6.5s)
      completedAt: "2026-07-26T14:57:56.255Z",
      durationMs: 1_806_582,
      canonicalFingerprint: "wcl-aa",
      sources: [
        {
          provider: "WARCRAFT_LOGS",
          externalRunId: "jCWx:1",
          externalUrl: null,
          reportCode: "jCWxCode",
          fightId: 1,
          revision: 1,
        },
      ],
    };

    const fusion = fuseCrossProviderRuns([rio, wcl]);
    expect(fusion.matchedPairCount).toBe(1);
    expect(fusion.mergedCanonicalRunCount).toBe(1);
    expect(fusion.runs[0]!.sources).toHaveLength(2);
    // Fingerprint follows RIO (higher priority) completion identity.
    expect(fusion.runs[0]!.canonicalFingerprint).toBe(
      computeCrossProviderRunKey({
        region: "EU",
        dungeonSlug: "algethar-academy",
        keyLevel: 22,
        completedAt: rio.completedAt,
      }),
    );
  });

  it("23 WCL + 10 RIO + 4 matched pairs => 29 unique fingerprints and 33 source refs", () => {
    const base = (overrides: Partial<MythicRunDTO> & { id: string; sources: RunSourceRefDTO[] }): MythicRunDTO => ({
      region: "EU",
      seasonSlug: "blizzard-season-3",
      dungeonSlug: "skyreach",
      keyLevel: 20,
      completedAt: "2026-07-20T12:00:00.000Z",
      durationMs: 1_800_000,
      timerMs: null,
      timed: true,
      scoreValue: 200,
      canonicalFingerprint: overrides.id,
      affixes: {},
      participants: [],
      ...overrides,
    });

    const matchedPairs: Array<{ rio: MythicRunDTO; wcl: MythicRunDTO }> = [
      {
        rio: base({
          id: "rio-m1",
          dungeonSlug: "magisters-terrace",
          keyLevel: 22,
          completedAt: "2026-07-11T17:48:56.000Z",
          durationMs: 2_037_359,
          sources: [
            {
              provider: "RAIDER_IO",
              externalRunId: "rio-m1",
              externalUrl: null,
              reportCode: null,
              fightId: null,
              revision: null,
            },
          ],
        }),
        wcl: base({
          id: "wcl-m1",
          dungeonSlug: "magisters-terrace",
          keyLevel: 22,
          completedAt: "2026-07-11T17:48:57.579Z",
          durationMs: 1_970_407,
          sources: [
            {
              provider: "WARCRAFT_LOGS",
              externalRunId: "wcl-m1",
              externalUrl: null,
              reportCode: "code1",
              fightId: 4,
              revision: 1,
            },
          ],
        }),
      },
      {
        rio: base({
          id: "rio-m2",
          dungeonSlug: "skyreach",
          keyLevel: 22,
          completedAt: "2026-07-11T16:39:43.000Z",
          durationMs: 1_557_871,
          sources: [
            {
              provider: "RAIDER_IO",
              externalRunId: "rio-m2",
              externalUrl: null,
              reportCode: null,
              fightId: null,
              revision: null,
            },
          ],
        }),
        wcl: base({
          id: "wcl-m2",
          dungeonSlug: "skyreach",
          keyLevel: 22,
          completedAt: "2026-07-11T16:39:44.544Z",
          durationMs: 1_551_218,
          sources: [
            {
              provider: "WARCRAFT_LOGS",
              externalRunId: "wcl-m2",
              externalUrl: null,
              reportCode: "code2",
              fightId: 1,
              revision: 1,
            },
          ],
        }),
      },
      {
        rio: base({
          id: "rio-m3",
          dungeonSlug: "algethar-academy",
          keyLevel: 22,
          completedAt: "2026-07-26T14:27:56.000Z",
          durationMs: 1_813_086,
          sources: [
            {
              provider: "RAIDER_IO",
              externalRunId: "rio-m3",
              externalUrl: null,
              reportCode: null,
              fightId: null,
              revision: null,
            },
          ],
        }),
        wcl: base({
          id: "wcl-m3",
          dungeonSlug: "algethar-academy",
          keyLevel: 22,
          // Clock skew; duration still aligns within 15s.
          completedAt: "2026-07-26T14:57:56.255Z",
          durationMs: 1_806_582,
          sources: [
            {
              provider: "WARCRAFT_LOGS",
              externalRunId: "wcl-m3",
              externalUrl: null,
              reportCode: "code3",
              fightId: 1,
              revision: 1,
            },
          ],
        }),
      },
      {
        rio: base({
          id: "rio-m4",
          dungeonSlug: "nexus-point-xenas",
          keyLevel: 21,
          completedAt: "2026-07-19T11:35:51.000Z",
          durationMs: 1_664_008,
          sources: [
            {
              provider: "RAIDER_IO",
              externalRunId: "rio-m4",
              externalUrl: null,
              reportCode: null,
              fightId: null,
              revision: null,
            },
          ],
        }),
        wcl: base({
          id: "wcl-m4",
          dungeonSlug: "nexus-point-xenas",
          keyLevel: 21,
          completedAt: "2026-07-19T11:35:52.100Z",
          durationMs: 1_664_500,
          sources: [
            {
              provider: "WARCRAFT_LOGS",
              externalRunId: "wcl-m4",
              externalUrl: null,
              reportCode: "code4",
              fightId: 2,
              revision: 1,
            },
          ],
        }),
      },
    ];

    const rioOnly = Array.from({ length: 6 }, (_, i) =>
      base({
        id: `rio-only-${i}`,
        dungeonSlug: `rio-only-dungeon-${i}`,
        keyLevel: 18 + (i % 3),
        completedAt: new Date(Date.parse("2026-07-01T10:00:00.000Z") + i * 3_600_000).toISOString(),
        durationMs: 1_700_000 + i * 1000,
        sources: [
          {
            provider: "RAIDER_IO",
            externalRunId: `rio-only-${i}`,
            externalUrl: null,
            reportCode: null,
            fightId: null,
            revision: null,
          },
        ],
      }),
    );

    const wclOnly = Array.from({ length: 19 }, (_, i) =>
      base({
        id: `wcl-only-${i}`,
        dungeonSlug: `wcl-only-dungeon-${i}`,
        keyLevel: 19 + (i % 4),
        completedAt: new Date(Date.parse("2026-07-02T10:00:00.000Z") + i * 3_600_000).toISOString(),
        durationMs: 1_650_000 + i * 1000,
        sources: [
          {
            provider: "WARCRAFT_LOGS",
            externalRunId: `wcl-only-${i}`,
            externalUrl: null,
            reportCode: `wclcode${i}`,
            fightId: i + 1,
            revision: 1,
          },
        ],
      }),
    );

    const rioRuns = [...matchedPairs.map((p) => p.rio), ...rioOnly];
    const wclRuns = [...matchedPairs.map((p) => p.wcl), ...wclOnly];
    expect(rioRuns).toHaveLength(10);
    expect(wclRuns).toHaveLength(23);

    const fusion = fuseCrossProviderRuns([...rioRuns, ...wclRuns]);
    const sourceRefCount = fusion.runs.reduce((n, run) => n + run.sources.length, 0);

    expect(fusion.matchedPairCount).toBe(4);
    expect(fusion.mergedCanonicalRunCount).toBe(29);
    expect(fusion.runs).toHaveLength(29);
    expect(new Set(fusion.runs.map((r) => r.canonicalFingerprint)).size).toBe(29);
    expect(sourceRefCount).toBe(33);
    expect(fusion.unresolvedCrossProviderMatches).toBe(0);
  });

  it("attaches WCL with unknown dungeon onto RIO when key + timing align", () => {
    const rio: MythicRunDTO = {
      id: "rio-known",
      region: "EU",
      seasonSlug: "blizzard-season-3",
      dungeonSlug: "skyreach",
      keyLevel: 22,
      completedAt: "2026-07-11T16:39:43.000Z",
      durationMs: 1_557_871,
      timerMs: null,
      timed: true,
      scoreValue: 240,
      canonicalFingerprint: "rio",
      affixes: {},
      participants: [],
      sources: [
        {
          provider: "RAIDER_IO",
          externalRunId: "rio-known",
          externalUrl: null,
          reportCode: null,
          fightId: null,
          revision: null,
        },
      ],
    };
    const wcl: MythicRunDTO = {
      ...rio,
      id: "wcl-unknown",
      dungeonSlug: "unknown",
      completedAt: "2026-07-11T16:39:44.544Z",
      durationMs: 1_551_218,
      canonicalFingerprint: "wcl",
      sources: [
        {
          provider: "WARCRAFT_LOGS",
          externalRunId: "wcl-unknown",
          externalUrl: null,
          reportCode: "code",
          fightId: 1,
          revision: 1,
        },
      ],
    };
    const fusion = fuseCrossProviderRuns([rio, wcl]);
    expect(fusion.matchedPairCount).toBe(1);
    expect(fusion.mergedCanonicalRunCount).toBe(1);
    expect(fusion.runs[0]!.dungeonSlug).toBe("skyreach");
    expect(fusion.runs[0]!.sources).toHaveLength(2);
  });

  it("maps NO_MATCHED_RUN visibility to OK provider state", () => {
    expect(mapWclVisibilityToState("PUBLIC", "NO_MATCHED_RUN")).toBe("OK");
    expect(mapWclVisibilityToState(null, "UNAVAILABLE")).toBe("UNAVAILABLE");
    expect(mapWclVisibilityToState("HIDDEN")).toBe("PRIVATE_OR_HIDDEN");
    expect(mapWclVisibilityToState("PUBLIC", "RANKINGS_ONLY")).toBe("OK");
  });
});
