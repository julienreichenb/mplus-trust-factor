import { describe, expect, it } from "vitest";
import {
  applyProfileWarnings,
  buildProfileEnrichments,
} from "./profile-enrichment.js";
import type { AppEnv } from "@mplus/config";
import type { Character, CharacterSnapshot, EquipmentSnapshot, GameClass, GameSpecialization } from "@mplus/database";
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
      wclVisibility: "NO_PUBLIC_LOGS",
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
        wclVisibility: "NO_PUBLIC_LOGS",
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
});
