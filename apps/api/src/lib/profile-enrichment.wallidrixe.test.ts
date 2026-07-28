import { describe, expect, it } from "vitest";
import {
  applyProfileWarnings,
  buildProfileEnrichments,
} from "./profile-enrichment.js";
import type { AppEnv } from "@mplus/config";
import type { Character, CharacterSnapshot, EquipmentSnapshot, GameClass, GameSpecialization, TalentSnapshot } from "@mplus/database";
import type { MythicRunWithRelations } from "@mplus/worker";
import type { ScoreSnapshotDTO } from "@mplus/contracts";

const env = { PUBLIC_DETAILS_ALL: true } as AppEnv;

function characterStub(overrides: Partial<Character> = {}): Character & {
  gameClass: GameClass;
  activeSpec: GameSpecialization;
} {
  return {
    id: "char-1",
    regionId: "reg-1",
    realmId: "realm-1",
    normalizedName: "wallidrixe",
    displayName: "Wallidrixe",
    classId: "class-1",
    activeSpecId: "spec-1",
    role: "DPS",
    blizzardCharacterId: null,
    raiderioProfileUrl: "https://raider.io/characters/eu/kazzak/Wallidrixe",
    lastSeenAt: new Date(),
    lastPublicRefreshAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    gameClass: { id: "class-1", slug: "mage", name: "Mage" } as GameClass,
    activeSpec: { id: "spec-1", slug: "fire", name: "Fire", role: "DPS" } as GameSpecialization,
    ...overrides,
  } as Character & { gameClass: GameClass; activeSpec: GameSpecialization };
}

function runStub(id: string): MythicRunWithRelations {
  return {
    id,
    dungeon: { id: "d1", slug: "ara-kara", name: "Ara-Kara" },
    season: { id: "s1", slug: "blizzard-season-13" },
    sources: [],
    keyLevel: 12,
    completedAt: new Date("2026-07-20T18:00:00.000Z"),
    timed: true,
    durationMs: 1_500_000,
    timerMs: 1_800_000,
    scoreValue: 100,
  } as unknown as MythicRunWithRelations;
}

describe("Wallidrixe-shaped profile enrichment", () => {
  it("does not expose coverageRatio=1 when no WCL combat facts were analyzed", () => {
    const enrichments = buildProfileEnrichments({
      character: characterStub(),
      latestRun: runStub("run-latest"),
      highestRun: runStub("run-highest"),
      runCount: 14,
      seasonSlug: "blizzard-season-13",
      wclVisibility: "PUBLIC",
      selectedRunCoverage: 0,
      runCoverageById: {},
      env,
    });

    expect(enrichments.lastAnalyzedRun?.coverageRatio).toBe(0);
    expect(enrichments.highestAnalyzedRun?.coverageRatio).toBe(0);
    expect(enrichments.seasonSummary?.runCount).toBe(14);
    expect(enrichments.seasonSummary?.seasonSlug).toBe("blizzard-season-13");
    expect(enrichments.specSlug).toBe("fire");
    expect(enrichments.role).toBe("DPS");
  });

  it("preserves null item level instead of fabricating zero", () => {
    const snapshot = {
      itemLevelEquipped: null,
      mythicRating: 2845,
      equipment: {
        averageItemLevel: null,
        equippedItemLevel: null,
        keyItems: [],
      },
    } as unknown as CharacterSnapshot & { equipment: EquipmentSnapshot };

    const enrichments = buildProfileEnrichments({
      character: characterStub(),
      latestSnapshot: snapshot,
      latestRun: null,
      highestRun: null,
      runCount: 0,
      seasonSlug: "blizzard-season-13",
      wclVisibility: "PUBLIC",
      wclDataState: "NO_PUBLIC_LOGS",
      selectedRunCoverage: 0,
      env,
    });

    expect(enrichments.itemLevel).toBeNull();
    expect(enrichments.equipment?.equippedItemLevel).toBeNull();
  });

  it("emits LOGS_HIDDEN only for HIDDEN, and distinguishes NO_PUBLIC_LOGS", () => {
    const score = {
      confidence: 0.5,
      grade: "C",
      redFlags: [{ key: "no_public_logs" }],
    } as unknown as ScoreSnapshotDTO;

    const noLogs = applyProfileWarnings(
      buildProfileEnrichments({
        character: characterStub(),
        latestRun: null,
        highestRun: null,
        runCount: 14,
        seasonSlug: "blizzard-season-13",
        wclVisibility: "PUBLIC",
        wclDataState: "NO_PUBLIC_LOGS",
        selectedRunCoverage: 0,
        env,
      }),
      score,
    );
    expect(noLogs.warnings.some((w) => w.code === "LOGS_HIDDEN")).toBe(false);
    expect(noLogs.warnings.some((w) => w.code === "NO_PUBLIC_LOGS")).toBe(true);

    const hidden = applyProfileWarnings(
      buildProfileEnrichments({
        character: characterStub(),
        latestRun: null,
        highestRun: null,
        runCount: 14,
        seasonSlug: "blizzard-season-13",
        wclVisibility: "HIDDEN",
        wclDataState: "NO_PUBLIC_LOGS",
        selectedRunCoverage: 0,
        env,
      }),
      {
        ...score,
        redFlags: [{ key: "logs_hidden" }],
      } as unknown as ScoreSnapshotDTO,
    );
    expect(hidden.warnings.some((w) => w.code === "LOGS_HIDDEN")).toBe(true);

    const unrated = applyProfileWarnings(
      buildProfileEnrichments({
        character: characterStub(),
        latestRun: null,
        highestRun: null,
        runCount: 2,
        seasonSlug: "blizzard-season-13",
        wclVisibility: "PUBLIC",
        selectedRunCoverage: 0,
        env,
      }),
      { confidence: 0.2, grade: "U", redFlags: [{ key: "insufficient_data" }] } as unknown as ScoreSnapshotDTO,
    );
    expect(unrated.warnings.some((w) => w.code === "INSUFFICIENT_DATA")).toBe(true);
  });

  it("maps full equipment DTO and rejects unsafe icon URLs / zero item levels", () => {
    const snapshot = {
      itemLevelEquipped: 680,
      mythicRating: 3000,
      equipment: {
        averageItemLevel: 678,
        equippedItemLevel: 680,
        items: [
          {
            slot: "Head",
            itemId: 1,
            name: "Helm",
            itemLevel: 0,
            quality: "Epic",
            iconUrl: "http://insecure.example/icon.png",
            enchantments: ["+50 Crit"],
            gems: [{ name: "Crit Gem", itemId: 9 }],
          },
          {
            slot: "Trinket",
            itemId: 2,
            name: "Safe Trinket",
            itemLevel: 684,
            quality: "Epic",
            iconUrl: "https://render.worldofwarcraft.com/icons/56/inv.png",
            enchantments: [],
            gems: [],
          },
        ],
        keyItems: [
          {
            slot: "Trinket",
            itemId: 2,
            name: "Safe Trinket",
            itemLevel: 684,
            quality: "Epic",
            iconUrl: "https://render.worldofwarcraft.com/icons/56/inv.png",
            enchantments: [],
            gems: [],
          },
        ],
      },
      rawSummary: {
        media: {
          avatarUrl: "https://render.worldofwarcraft.com/eu/avatar.jpg",
          insetUrl: null,
          mainRawUrl: "javascript:alert(1)",
        },
      },
      talents: [
        {
          loadoutCode: "FIRE-LOADOUT",
          talents: { activeSpecialization: { name: "fire" } },
        },
      ],
      capturedAt: new Date("2026-07-20T12:00:00.000Z"),
    } as unknown as CharacterSnapshot & { equipment: EquipmentSnapshot; talents: TalentSnapshot[] };

    const enrichments = buildProfileEnrichments({
      character: characterStub(),
      latestSnapshot: snapshot,
      latestRun: runStub("run-a"),
      highestRun: runStub("run-a"),
      runCount: 8,
      seasonSlug: "blizzard-season-13",
      wclVisibility: "PUBLIC",
      selectedRunCoverage: 0.9,
      providerStates: [
        {
          provider: "warcraftlogs",
          state: "OK",
          detail: null,
          lastAttemptAt: "2026-07-20T12:00:00.000Z",
          lastSuccessAt: "2026-07-20T12:00:00.000Z",
          fetchedAt: "2026-07-20T12:00:00.000Z",
          expiresAt: null,
          wclVisibility: "PUBLIC",
          warnings: [],
        },
      ],
      scoreObservationProviders: ["warcraftlogs", "blizzard"],
      performanceSummary: {
        currentSeason: {
          peakScore: 80,
          consistencyScore: 70,
          score: 76.5,
          confidence: 0.9,
          dungeonCount: 8,
          expectedDungeonCount: 8,
          latestObservedAt: "2026-07-20T12:00:00.000Z",
          dungeons: [],
        },
        historical: null,
      },
      env,
    });

    expect(enrichments.lastAnalyzedRun?.kind).toBe("BOTH");
    expect(enrichments.highestAnalyzedRun?.kind).toBe("BOTH");
    expect(enrichments.equipment?.items).toHaveLength(2);
    expect(enrichments.equipment?.items[0]?.itemLevel).toBeNull();
    expect(enrichments.equipment?.items[0]?.iconUrl).toBeNull();
    expect(enrichments.equipment?.items[1]?.iconUrl).toContain("https://");
    expect(enrichments.equipment?.items[0]?.enchantments).toEqual(["+50 Crit"]);
    expect(enrichments.media?.avatarUrl).toContain("https://");
    expect(enrichments.media?.mainRawUrl).toBeNull();
    expect(enrichments.talents?.loadoutCode).toBe("FIRE-LOADOUT");
    expect(enrichments.providerStates?.[0]?.contributedToScore).toBe(true);
    expect(enrichments.performanceSummary?.currentSeason.dungeonCount).toBe(8);
  });

  it("returns distinct BEST/LATEST kinds when runs differ", () => {
    const enrichments = buildProfileEnrichments({
      character: characterStub(),
      latestRun: runStub("run-latest"),
      highestRun: runStub("run-best"),
      runCount: 4,
      seasonSlug: "blizzard-season-13",
      wclVisibility: "PUBLIC",
      wclDataState: "NO_MATCHED_RUN",
      selectedRunCoverage: 0,
      env,
    });
    expect(enrichments.lastAnalyzedRun?.kind).toBe("LATEST");
    expect(enrichments.highestAnalyzedRun?.kind).toBe("HIGHEST");
    const warned = applyProfileWarnings(enrichments, {
      confidence: 0.5,
      grade: "B",
      redFlags: [],
    } as unknown as ScoreSnapshotDTO);
    expect(warned.warnings.some((w) => w.code === "NO_MATCHED_RUN")).toBe(true);
  });

  it("keeps talent loadout null when provider snapshot has no talent row", () => {
    const enrichments = buildProfileEnrichments({
      character: characterStub(),
      latestSnapshot: {
        itemLevelEquipped: null,
        mythicRating: null,
        equipment: null,
        talents: [],
        rawSummary: {},
        capturedAt: new Date(),
      } as unknown as CharacterSnapshot,
      latestRun: null,
      highestRun: null,
      runCount: 0,
      seasonSlug: "blizzard-season-13",
      wclVisibility: "HIDDEN",
      selectedRunCoverage: 0,
      env,
    });
    expect(enrichments.talents?.specializationSlug).toBe("fire");
    expect(enrichments.talents?.loadoutCode).toBeNull();
    expect(enrichments.talents?.selectedTalents).toBeNull();
  });

  it("uses persisted canonical scoringRunSelection without global WCL coverage fallback", () => {
    const ACTIVE_EIGHT = [
      "algethar-academy",
      "magisters-terrace",
      "maisara-caverns",
      "nexus-point-xenas",
      "pit-of-saron",
      "seat-of-the-triumvirate",
      "skyreach",
      "windrunner-spire",
    ];
    const canonicalSelection = {
      seasonSlug: "blizzard-season-13",
      expectedDungeonCount: 8,
      selectedRuns: ACTIVE_EIGHT.map((dungeonSlug, index) => ({
        dungeonSlug,
        dungeonName: dungeonSlug,
        canonicalRunId: `run-${index}`,
        keyLevel: 12 + index,
        timed: true,
        completedAt: "2026-07-20T18:00:00.000Z",
        wclReportMatched: index < 3,
        selectionReason: "HIGHEST_KEY" as const,
        coverageRatio: index < 2 ? 0.75 : null,
      })),
    };

    const enrichments = buildProfileEnrichments({
      character: characterStub(),
      latestRun: runStub("run-0"),
      highestRun: runStub("run-7"),
      runCount: 14,
      seasonSlug: "blizzard-season-13",
      wclVisibility: "PUBLIC",
      selectedRunCoverage: 0.9,
      runCoverageById: { "run-0": 0.75, "run-1": 0.5 },
      scoringRunSelection: canonicalSelection,
      selectedRunCount: 8,
      detailedRunCount: 2,
      env,
    });

    expect(enrichments.scoringRunSelection?.selectedRuns).toHaveLength(8);
    expect(enrichments.selectedRunCount).toBe(8);
    expect(enrichments.selectedRuns).toHaveLength(8);
    expect(enrichments.selectedRuns.some((r) => r.dungeonSlug === "icecrown")).toBe(false);
    expect(enrichments.selectedRuns.filter((r) => r.hasDetailedAnalysis)).toHaveLength(2);
    expect(enrichments.detailedRunCount).toBe(2);
    expect(enrichments.selectedRuns.find((r) => r.runId === "run-3")?.wclCoverageRatio).toBeNull();
  });
});
