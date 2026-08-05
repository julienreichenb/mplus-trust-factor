/**
 * Canary Midnight Season 1 catalog + operator repository safety.
 */
import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CURRENT_MPLUS_ZONE_DUNGEON_SLUGS,
} from "@mplus/provider-warcraftlogs";
import {
  MIDNIGHT_SEASON_1_DUNGEON_SLUGS,
  MIDNIGHT_SEASON_1_WCL_ZONE_ID,
  OBSOLETE_TWW_DUNGEON_SLUGS,
  assertMidnightSeason1PoolForZone47,
  containsObsoleteDungeonSlug,
  dungeonPoolEqualsExpected,
  expectedDungeonSlugsForWclZone,
} from "./canary/canary-catalog.js";
import {
  CANARY_SENTINEL_CHARACTER_ID,
  assertNotSentinelCharacterId,
  assertOperatorRepositoryMode,
  createMemoryCanaryDependencies,
} from "./canary/canary-deps.js";
import { createMemoryOrchestrationPorts } from "./run-orchestration/memory-ports.js";
import {
  isManifestCompatibleWithSeasonPool,
  runScoringV2CanaryPreflight,
} from "./run-orchestration/canary-preflight.js";
import { EVIDENCE_SELECTOR_VERSION } from "@mplus/contracts";
import {
  parseCanaryCliArgs,
  runCanaryPreflightCommand,
} from "./canary/cli.js";
import { SeasonCatalogMismatchError } from "./canary/canary-season.js";

describe("zone 47 Midnight Season 1 dungeon catalog", () => {
  it("resolves to the Midnight Season 1 pool", () => {
    const expected = expectedDungeonSlugsForWclZone(47);
    expect(expected).toEqual([...MIDNIGHT_SEASON_1_DUNGEON_SLUGS]);
    expect(MIDNIGHT_SEASON_1_WCL_ZONE_ID).toBe(47);
    expect(
      dungeonPoolEqualsExpected(
        CURRENT_MPLUS_ZONE_DUNGEON_SLUGS,
        MIDNIGHT_SEASON_1_DUNGEON_SLUGS,
      ),
    ).toBe(true);
  });

  it("contains exactly the expected eight dungeons", () => {
    expect(MIDNIGHT_SEASON_1_DUNGEON_SLUGS).toEqual([
      "algethar-academy",
      "magisters-terrace",
      "maisara-caverns",
      "nexus-point-xenas",
      "pit-of-saron",
      "seat-of-the-triumvirate",
      "skyreach",
      "windrunner-spire",
    ]);
    expect(MIDNIGHT_SEASON_1_DUNGEON_SLUGS).toHaveLength(8);
  });

  it("rejects obsolete TWW dungeon slugs for zone 47", () => {
    const check = assertMidnightSeason1PoolForZone47({
      zoneId: 47,
      dungeonSlugs: [...OBSOLETE_TWW_DUNGEON_SLUGS],
    });
    expect(check.ok).toBe(false);
    if (!check.ok) {
      expect(check.code).toBe("SEASON_CATALOG_MISMATCH");
      expect(check.reasons.some((r) => r.includes("obsolete_dungeon_slugs"))).toBe(
        true,
      );
    }
    expect(
      containsObsoleteDungeonSlug(["ara-kara-city-of-echoes", "skyreach"]),
    ).toEqual(["ara-kara-city-of-echoes"]);
  });
});

describe("canary operator repository mode", () => {
  it("production CLI cannot use memory/fixture repositories", () => {
    expect(() => assertOperatorRepositoryMode("MEMORY")).toThrow(
      /non_production_repositories/,
    );
    expect(() => assertOperatorRepositoryMode("FIXTURE")).toThrow(
      /non_production_repositories/,
    );
    expect(() => assertOperatorRepositoryMode("PRODUCTION")).not.toThrow();
  });

  it("never emits the sentinel character UUID from operator guards", () => {
    expect(() =>
      assertNotSentinelCharacterId(CANARY_SENTINEL_CHARACTER_ID),
    ).toThrow(/sentinel_character/);
    expect(() =>
      assertNotSentinelCharacterId("11111111-1111-4111-8111-111111111111"),
    ).not.toThrow();
  });

  it("test commands may still inject memory ports explicitly", async () => {
    const ports = createMemoryOrchestrationPorts({ autoSeedRanking: false });
    const mem = createMemoryCanaryDependencies({
      ports,
      characterId: "11111111-1111-4111-8111-111111111111",
      identity: {
        region: "EU",
        realmSlug: "archimonde",
        name: "Wallidrixe",
      },
    });
    expect(mem.repositoryMode).toBe("MEMORY");

    const args = parseCanaryCliArgs([
      "preflight",
      "--region",
      "EU",
      "--realm",
      "archimonde",
      "--character",
      "Wallidrixe",
    ]);
    const outDir = mkdtempSync(join(tmpdir(), "canary-preflight-"));
    const { report } = await runCanaryPreflightCommand(args, {
      repositoryMode: "MEMORY",
      allowNonProductionRepositories: true,
      ports,
      characterId: "11111111-1111-4111-8111-111111111111",
      seasonId: "blizzard-season-17",
      activeDungeonSlugs: [...MIDNIGHT_SEASON_1_DUNGEON_SLUGS],
      seasonResolution: {
        configuredZoneId: 47,
        resolutionMode: "AUTO",
        seasonId: "season-row",
        seasonSlug: "blizzard-season-17",
        seasonName: "Midnight Season 1",
        blizzardSeasonId: 17,
        expansion: "Midnight",
        productSeasonSlug: "midnight-season-1",
        catalogSource: "season_dungeon_bindings",
        catalogVersion: "test",
        dungeonCount: 8,
        dungeons: MIDNIGHT_SEASON_1_DUNGEON_SLUGS.map((slug, i) => ({
          slug,
          dungeonId: `d-${i}`,
          journalInstanceId: null,
          wclZoneOrEncounterId: null,
          sortOrder: i,
        })),
        activeDungeonSlugs: [...MIDNIGHT_SEASON_1_DUNGEON_SLUGS],
        dungeonPoolHash: "abc",
        expectedSlotCount: 16,
        validationStatus: "OK",
        validationReasons: [],
        isCurrent: true,
        startsAt: null,
        endsAt: null,
        authority: null,
        warnings: [],
      },
      existingManifest: null,
      allowSyntheticManifest: false,
      env: { WCL_MPLUS_ZONE_ID: "47" },
      outputDir: outDir,
      rateBudgetConfig: { warnPercent: 70, deferPercent: 80, stopPercent: 90 },
    });

    expect(report.repositoryMode).toBe("MEMORY");
    expect(report.providerCalls).toBe(0);
    expect(report.manifestStatus).toBe("MANIFEST_NOT_FOUND");
    expect(report.characterId).not.toBe(CANARY_SENTINEL_CHARACTER_ID);
    expect(report.slots).toHaveLength(16);
    expect(
      report.slots.every((s) =>
        MIDNIGHT_SEASON_1_DUNGEON_SLUGS.includes(s.dungeonSlug),
      ),
    ).toBe(true);
    expect(
      report.slots.some((s) => s.dungeonSlug === "ara-kara-city-of-echoes"),
    ).toBe(false);
  });

  it("unknown character fails with CHARACTER_NOT_FOUND in memory path without id", async () => {
    const args = parseCanaryCliArgs([
      "preflight",
      "--region",
      "EU",
      "--realm",
      "archimonde",
      "--character",
      "NobodyHere",
    ]);
    await expect(
      runCanaryPreflightCommand(args, {
        repositoryMode: "MEMORY",
        allowNonProductionRepositories: true,
        env: { WCL_MPLUS_ZONE_ID: "47" },
      }),
    ).rejects.toMatchObject({ code: "CHARACTER_NOT_FOUND" });
  });

  it("season/catalog mismatch fails before manifest creation", () => {
    const bad = assertMidnightSeason1PoolForZone47({
      zoneId: 47,
      dungeonSlugs: ["ara-kara-city-of-echoes", "the-rookery"],
    });
    expect(bad.ok).toBe(false);
    expect(
      () =>
        new SeasonCatalogMismatchError({
          configuredZoneId: 47,
          resolutionMode: "AUTO",
          seasonId: "x",
          seasonSlug: "stale",
          seasonName: "stale",
          blizzardSeasonId: null,
          expansion: null,
          productSeasonSlug: "midnight-season-1",
          catalogSource: "season_db",
          catalogVersion: "x",
          dungeonCount: 2,
          dungeons: [],
          activeDungeonSlugs: ["ara-kara-city-of-echoes", "the-rookery"],
          dungeonPoolHash: null,
          expectedSlotCount: 4,
          validationStatus: "SEASON_CATALOG_MISMATCH",
          validationReasons: ["obsolete_dungeon_slugs"],
          isCurrent: true,
          startsAt: null,
          endsAt: null,
          authority: null,
          warnings: [],
        }),
    ).not.toThrow();
  });

  it("stale manifests from another dungeon pool are not reused", async () => {
    const ports = createMemoryOrchestrationPorts({ autoSeedRanking: false });
    const staleManifest = {
      schemaVersion: "character-season-evidence-manifest-v2",
      characterId: "11111111-1111-4111-8111-111111111111",
      seasonId: "stale",
      seasonSlug: "stale",
      specializationId: null,
      classSlug: null,
      specSlug: null,
      role: "DPS",
      refreshContractHash: "h",
      selectorVersion: EVIDENCE_SELECTOR_VERSION,
      evidenceCutoffAt: "2099-01-01T00:00:00.000Z",
      highKeyPolicyId: "high-key-v1",
      expectedSlotCount: 2,
      selectedSlotCount: 2,
      coverageState: "PARTIAL",
      contentHash: "a".repeat(64),
      selectedAt: "2026-01-01T00:00:00.000Z",
      slots: [
        {
          slotId: "ara-kara-city-of-echoes:0",
          dungeonSlug: "ara-kara-city-of-echoes",
          slotIndex: 0 as const,
          state: "SELECTED" as const,
          identity: null,
          keyLevel: null,
          timed: null,
          runScore: null,
          completedAt: null,
          actorId: null,
          evidenceCompleteness: null,
          selectionReason: null,
          rejectionReason: null,
          dimensionValidity: {
            performance: "VALID" as const,
            survival: "VALID" as const,
            utility: "VALID" as const,
            reasons: [],
          },
        },
        {
          slotId: "the-rookery:0",
          dungeonSlug: "the-rookery",
          slotIndex: 0 as const,
          state: "SELECTED" as const,
          identity: null,
          keyLevel: null,
          timed: null,
          runScore: null,
          completedAt: null,
          actorId: null,
          evidenceCompleteness: null,
          selectionReason: null,
          rejectionReason: null,
          dimensionValidity: {
            performance: "VALID" as const,
            survival: "VALID" as const,
            utility: "VALID" as const,
            reasons: [],
          },
        },
      ],
    };

    expect(
      isManifestCompatibleWithSeasonPool(
        staleManifest as never,
        MIDNIGHT_SEASON_1_DUNGEON_SLUGS,
      ),
    ).toBe(false);

    const report = await runScoringV2CanaryPreflight({
      characterId: "11111111-1111-4111-8111-111111111111",
      characterName: "Wallidrixe",
      region: "eu",
      realm: "archimonde",
      zoneId: 47,
      seasonId: "blizzard-season-17",
      scoringModelId: "m",
      scope: {
        characterId: "11111111-1111-4111-8111-111111111111",
        seasonId: "blizzard-season-17",
        seasonSlug: "blizzard-season-17",
        specializationId: null,
        classSlug: null,
        specSlug: null,
        role: "DPS",
        refreshContractHash: "h",
        selectorVersion: EVIDENCE_SELECTOR_VERSION,
        evidenceCutoffAt: "2099-01-01T00:00:00.000Z",
        highKeyPolicyId: "high-key-v1",
        activeDungeonSlugs: [...MIDNIGHT_SEASON_1_DUNGEON_SLUGS],
      },
      candidates: [],
      ports,
      existingManifest: staleManifest as never,
      allowSyntheticManifest: false,
      repositoryMode: "MEMORY",
      rateBudgetConfig: { warnPercent: 70, deferPercent: 80, stopPercent: 90 },
    });

    expect(report.manifestStatus).toBe("STALE_POOL_REJECTED");
    expect(report.providerCalls).toBe(0);
    expect(report.selectedSlotCount).toBe(0);
    expect(
      report.slots.every((s) => s.dungeonSlug !== "ara-kara-city-of-echoes"),
    ).toBe(true);
  });
});
