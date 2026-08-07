import { describe, expect, it, vi } from "vitest";
import { ExternalApiError } from "@mplus/contracts";
import {
  characterLacksBootstrapEvidence,
  resolveOrDiscoverPublicCharacter,
} from "../character-public-bootstrap.js";
import type { VerifiedSeasonAuthority } from "../season-authority.js";
import { prepareSmokeCharacterForRefresh } from "./smoke-character-prepare.js";
import {
  buildSmokeRunsTable,
  formatSmokeRunsTableText,
} from "./smoke-runs-table.js";

const authority: VerifiedSeasonAuthority = {
  regionCode: "EU",
  regionId: "reg-eu",
  seasonRowId: "season-row-1",
  blizzardSeasonId: 13,
  slug: "blizzard-season-13",
  authoritySource: "season_index.current_season",
  authorityVerifiedAt: new Date("2026-07-31T00:00:00.000Z"),
  resolution: "memory",
};

const identity = { region: "EU" as const, realmSlug: "archimonde", name: "Wallidrixe" };

const completeCharacter = {
  id: "char-1",
  level: 90,
  blizzardCharacterId: 12345n,
  classId: "class-1",
  activeSpecId: "spec-1",
  role: "DPS" as const,
};

const incompleteCharacter = {
  id: "char-shell",
  level: null,
  blizzardCharacterId: null,
  classId: null,
  activeSpecId: null,
  role: null,
};

const profile = {
  region: "EU" as const,
  realmSlug: "archimonde",
  name: "Wallidrixe",
  displayName: "Wallidrixe",
  classSlug: "mage",
  specSlug: "fire",
  role: "DPS" as const,
  level: 90,
  faction: "HORDE" as const,
  blizzardCharacterId: "12345",
};

function mockRepo(overrides: Record<string, unknown> = {}) {
  return {
    findByIdentity: vi.fn(async () => null),
    upsertCharacter: vi.fn(async () => ({ ...completeCharacter })),
    applyProviderProfile: vi.fn(async () => ({ ...completeCharacter })),
    findById: vi.fn(async () => ({ ...completeCharacter })),
    deleteUnreferencedBootstrapShell: vi.fn(async () => true),
    ...overrides,
  };
}

function mockBlizzard(overrides: Record<string, unknown> = {}) {
  return {
    getCharacterProfile: vi.fn(async () => ({
      data: profile,
      freshness: { fetchedAt: new Date().toISOString(), expiresAt: null },
    })),
    getMythicKeystoneProfile: vi.fn(async () => ({
      data: { currentMythicRating: 2500, seasons: [] },
      freshness: { fetchedAt: new Date().toISOString(), expiresAt: null },
    })),
    ...overrides,
  };
}

function mockPrisma() {
  return {
    character: {
      update: vi.fn(async () => ({})),
    },
    characterSnapshot: {
      create: vi.fn(async () => ({})),
    },
  };
}

describe("smoke runs table", () => {
  it("lists all expected slots and separates missing ones", () => {
    const table = buildSmokeRunsTable({
      expectedSlots: [
        { dungeonName: "Skyreach", dungeonSlug: "skyreach", slotIndex: 0 },
        { dungeonName: "Skyreach", dungeonSlug: "skyreach", slotIndex: 1 },
        {
          dungeonName: "Pit Of Saron",
          dungeonSlug: "pit-of-saron",
          slotIndex: 0,
        },
        {
          dungeonName: "Pit Of Saron",
          dungeonSlug: "pit-of-saron",
          slotIndex: 1,
        },
      ],
      selectedRuns: [
        {
          dungeonSlug: "skyreach",
          slotIndex: 0,
          reportCode: "abc",
          fightId: 1,
          reportRevision: 2,
        },
        {
          dungeonSlug: "pit-of-saron",
          slotIndex: 0,
          reportCode: "def",
          fightId: 9,
          reportRevision: 10,
        },
      ],
      keyByFight: new Map([
        ["abc:1", 22],
        ["def:9", 22],
      ]),
      manifestSlotsByKey: new Map([
        [
          "skyreach:0",
          {
            state: "SELECTED",
            selectionReason: "SELECTED",
            invalidReasons: [],
            keyLevel: 22,
            reportCode: "abc",
            fightId: 1,
            reportRevision: 2,
          },
        ],
        [
          "skyreach:1",
          {
            state: "MISSING_NO_CANDIDATE",
            selectionReason: null,
            invalidReasons: ["NO_ELIGIBLE_CANDIDATE"],
            keyLevel: null,
            reportCode: null,
            fightId: null,
            reportRevision: null,
          },
        ],
      ]),
    });

    expect(table.expectedCount).toBe(4);
    expect(table.selectedCount).toBe(2);
    expect(table.missingCount).toBe(2);
    expect(table.rows.map((r) => `${r.dungeon}:${r.slot}:${r.state}`)).toEqual([
      "Pit Of Saron:0:SELECTED",
      "Pit Of Saron:1:MISSING_NO_CANDIDATE",
      "Skyreach:0:SELECTED",
      "Skyreach:1:MISSING_NO_CANDIDATE",
    ]);
    expect(table.missingRows[0]?.reason).toBe("MISSING_NO_CANDIDATE");
    expect(table.rows.find((r) => r.dungeon === "Skyreach" && r.slot === 1)?.reason).toBe(
      "NO_ELIGIBLE_CANDIDATE",
    );

    const text = formatSmokeRunsTableText(table);
    expect(text).toContain("Selected runs: 2/4");
    expect(text).toContain("Missing slots: 2");
    expect(text).toContain("MISSING / REJECTED");
    expect(text).toContain("Skyreach");
  });

  it("prefers CharacterScore selection over mismatched SELECTED manifest slots", () => {
    const table = buildSmokeRunsTable({
      expectedSlots: [
        {
          dungeonName: "Windrunner Spire",
          dungeonSlug: "windrunner-spire",
          slotIndex: 1,
        },
      ],
      selectedRuns: [],
      keyByFight: new Map(),
      manifestSlotsByKey: new Map([
        [
          "windrunner-spire:1",
          {
            state: "SELECTED",
            selectionReason: "SELECTED",
            invalidReasons: [],
            keyLevel: 21,
            reportCode: "stale",
            fightId: 4,
            reportRevision: 1,
          },
        ],
      ]),
    });

    expect(table.rows[0]?.state).toBe("MISSING_NO_CANDIDATE");
  });
});

describe("characterLacksBootstrapEvidence", () => {
  it("detects incomplete shells", () => {
    expect(characterLacksBootstrapEvidence(incompleteCharacter)).toBe(true);
    expect(characterLacksBootstrapEvidence(completeCharacter)).toBe(false);
  });
});

describe("resolveOrDiscoverPublicCharacter", () => {
  it("DB miss → Blizzard discovery → persists complete Character", async () => {
    const characterRepository = mockRepo();
    const blizzard = mockBlizzard();
    const prisma = mockPrisma();

    const result = await resolveOrDiscoverPublicCharacter({
      prisma: prisma as never,
      characterRepository: characterRepository as never,
      blizzard: blizzard as never,
      identity,
      authority,
    });

    expect(blizzard.getCharacterProfile).toHaveBeenCalledTimes(1);
    expect(blizzard.getMythicKeystoneProfile).toHaveBeenCalledTimes(1);
    expect(characterRepository.upsertCharacter).toHaveBeenCalled();
    expect(characterRepository.applyProviderProfile).toHaveBeenCalled();
    expect(prisma.characterSnapshot.create).toHaveBeenCalled();
    expect(result.reason).toBe("created");
    expect(result.bootstrapPerformed).toBe(true);
    expect(result.character.id).toBe("char-1");
    expect(result.providerCalls).toBe(2);
  });

  it("DB hit complete → no Blizzard discovery", async () => {
    const characterRepository = mockRepo({
      findByIdentity: vi.fn(async () => completeCharacter),
    });
    const blizzard = mockBlizzard();

    const result = await resolveOrDiscoverPublicCharacter({
      prisma: mockPrisma() as never,
      characterRepository: characterRepository as never,
      blizzard: blizzard as never,
      identity,
      authority,
    });

    expect(blizzard.getCharacterProfile).not.toHaveBeenCalled();
    expect(blizzard.getMythicKeystoneProfile).not.toHaveBeenCalled();
    expect(result.reason).toBe("already_complete");
    expect(result.bootstrapPerformed).toBe(false);
    expect(result.providerCalls).toBe(0);
    expect(result.character.id).toBe("char-1");
  });

  it("DB hit incomplete → repair path reuses Blizzard bootstrap", async () => {
    const characterRepository = mockRepo({
      findByIdentity: vi.fn(async () => incompleteCharacter),
      applyProviderProfile: vi.fn(async () => ({ ...completeCharacter })),
    });
    const blizzard = mockBlizzard();

    const result = await resolveOrDiscoverPublicCharacter({
      prisma: mockPrisma() as never,
      characterRepository: characterRepository as never,
      blizzard: blizzard as never,
      identity,
      authority,
    });

    expect(blizzard.getCharacterProfile).toHaveBeenCalledTimes(1);
    expect(characterRepository.upsertCharacter).not.toHaveBeenCalled();
    expect(characterRepository.applyProviderProfile).toHaveBeenCalled();
    expect(result.reason).toBe("repaired");
    expect(result.bootstrapPerformed).toBe(true);
  });

  it("Blizzard discovery failure → no empty Character proceeds", async () => {
    const characterRepository = mockRepo();
    const blizzard = mockBlizzard({
      getCharacterProfile: vi.fn(async () => {
        throw new ExternalApiError({
          message: "not found",
          code: "NOT_FOUND",
          provider: "blizzard",
          retryable: false,
        });
      }),
    });

    await expect(
      resolveOrDiscoverPublicCharacter({
        prisma: mockPrisma() as never,
        characterRepository: characterRepository as never,
        blizzard: blizzard as never,
        identity,
        authority,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    expect(characterRepository.upsertCharacter).not.toHaveBeenCalled();
  });
});

describe("prepareSmokeCharacterForRefresh", () => {
  it("delegates to canonical resolveOrDiscover (replay/score-only never call this)", async () => {
    const characterRepository = mockRepo({
      findByIdentity: vi.fn(async () => completeCharacter),
    });
    const blizzard = mockBlizzard();
    const container = {
      prisma: mockPrisma(),
      repositories: { character: characterRepository },
      providers: { blizzard },
    };

    const result = await prepareSmokeCharacterForRefresh({
      container: container as never,
      identity,
      authority,
    });

    expect(result.reason).toBe("already_complete");
    expect(blizzard.getCharacterProfile).not.toHaveBeenCalled();
  });

  it("cold path returns persisted characterId for refresh", async () => {
    const characterRepository = mockRepo();
    const blizzard = mockBlizzard();
    const container = {
      prisma: mockPrisma(),
      repositories: { character: characterRepository },
      providers: { blizzard },
    };

    const result = await prepareSmokeCharacterForRefresh({
      container: container as never,
      identity,
      authority,
    });

    expect(result.character.id).toBe("char-1");
    expect(result.bootstrapPerformed).toBe(true);
    expect(blizzard.getCharacterProfile).toHaveBeenCalled();
  });
});
