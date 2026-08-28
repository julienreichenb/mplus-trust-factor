/**
 * Shared Prisma stubs so CharacterService unit tests resolve AUTO fixture season 13.
 */
import { vi } from "vitest";
import { mockActiveBootstrapCatalogReleasePrisma } from "@mplus/test-utils";
import { computeDungeonPoolHash } from "@mplus/worker";

const FIXTURE_DUNGEON_SLUGS = [
  "algethar-academy",
  "magisters-terrace",
  "maisara-caverns",
  "nexus-point-xenas",
  "pit-of-saron",
  "seat-of-the-triumvirate",
  "skyreach",
  "windrunner-spire",
] as const;

const FIXTURE_POOL_HASH = computeDungeonPoolHash(FIXTURE_DUNGEON_SLUGS);

export function fixtureReadySeasonRow(overrides: Record<string, unknown> = {}) {
  const blizzardSeasonId =
    typeof overrides.blizzardSeasonId === "number" ? overrides.blizzardSeasonId : 13;
  const slug =
    typeof overrides.slug === "string" ? overrides.slug : `blizzard-season-${blizzardSeasonId}`;
  const regionId = typeof overrides.regionId === "string" ? overrides.regionId : "reg-1";
  const metadata = {
    blizzardSeasonId,
    source: "blizzard",
    authoritySource: "season_index.current_season",
    authorityVerifiedAt: new Date().toISOString(),
    activeMplusCatalog: {
      schemaVersion: "active-mplus-catalog-v1",
      wclZoneId: 45,
      blizzardSeasonId,
      expansionIdentity: "Fixture",
      dungeonPoolHash: FIXTURE_POOL_HASH,
      sourceMetadataHash: "test",
      catalogVersion: "test",
      dungeonSlugs: [...FIXTURE_DUNGEON_SLUGS],
      synchronizedAt: new Date().toISOString(),
      validatedAt: new Date().toISOString(),
      lastKnownGood: true,
      authorityVersion: "active-mplus-season-authority-v1",
    },
  };
  return {
    id: "season-1",
    name: `Fixture Season ${blizzardSeasonId}`,
    isCurrent: true,
    dungeonCount: FIXTURE_DUNGEON_SLUGS.length,
    startsAt: null,
    endsAt: null,
    ...overrides,
    slug,
    blizzardSeasonId,
    regionId,
    metadata: (overrides.metadata as object | undefined) ?? metadata,
  };
}

export function scoringSeasonPrismaStubs(season = fixtureReadySeasonRow()) {
  return {
    ...mockActiveBootstrapCatalogReleasePrisma(),
    runtimeSetting: {
      findUnique: vi.fn(async () => null),
    },
    evidenceManifest: {
      findFirst: vi.fn(async () => null),
    },
    characterRunDigest: {
      findMany: vi.fn(async () => []),
    },
    seasonDungeon: {
      findMany: vi.fn(async () =>
        FIXTURE_DUNGEON_SLUGS.map((slug, i) => ({
          sortOrder: i,
          dungeonId: `dungeon-${i}`,
          dungeon: {
            id: `dungeon-${i}`,
            slug,
            wclZoneOrEncounterId: BigInt(10_000 + i),
          },
        })),
      ),
    },
    season,
  };
}
