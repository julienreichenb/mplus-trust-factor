/**
 * Effective scoring season stub for refresh-contract preflight unit tests.
 */
import type { EffectiveScoringSeason } from "./active-mplus-season/effective-scoring-season.js";
import type { VerifiedSeasonAuthority } from "./season-authority.js";
import {
  ACTIVE_MPLUS_SEASON_AUTHORITY_VERSION,
  computeDungeonPoolHash,
  computeSourceMetadataHash,
} from "./active-mplus-season/types.js";

export function stubEffectiveFromAuthority(
  authority: VerifiedSeasonAuthority,
  zoneId = 39,
): EffectiveScoringSeason {
  const dungeonSlugs = ["stub-dungeon-a", "stub-dungeon-b"];
  const dungeonPoolHash = computeDungeonPoolHash(dungeonSlugs);
  const catalogVersion = `${ACTIVE_MPLUS_SEASON_AUTHORITY_VERSION}:zone-${zoneId}:pool-${dungeonPoolHash.slice(0, 12)}`;
  return {
    selectionMode: "AUTO",
    selection: { mode: "AUTO" },
    detected: authority,
    season: {
      id: authority.seasonRowId,
      slug: authority.slug,
      name: authority.slug,
      blizzardSeasonId: authority.blizzardSeasonId,
      isCurrent: true,
    } as never,
    applicationSeasonId: authority.seasonRowId,
    seasonSlug: authority.slug,
    seasonDisplayName: authority.slug,
    blizzardSeasonId: authority.blizzardSeasonId,
    wclZoneId: zoneId,
    dungeons: [],
    activeDungeonSlugs: dungeonSlugs,
    dungeonPoolHash,
    catalogVersion,
    catalogSource: "season_dungeon_bindings",
    activeSeasonId: authority.slug,
    bootstrapped: false,
    authority: {
      authorityVersion: ACTIVE_MPLUS_SEASON_AUTHORITY_VERSION,
      resolutionMode: "AUTO",
      operationalState: "ACTIVE_SEASON_CURRENT",
      applicationSeasonId: authority.seasonRowId,
      seasonSlug: authority.slug,
      seasonDisplayName: authority.slug,
      expansionIdentity: null,
      blizzardSeasonId: authority.blizzardSeasonId,
      raiderIoSeasonSlug: null,
      wclZoneId: zoneId,
      active: true,
      frozen: false,
      validFrom: null,
      validUntil: null,
      catalogSource: "season_dungeon_bindings",
      catalogVersion,
      sourceMetadataHash: computeSourceMetadataHash({
        blizzardSeasonId: authority.blizzardSeasonId,
        wclZoneId: zoneId,
        dungeonPoolHash,
        catalogVersion,
      }),
      dungeonPoolHash,
      dungeons: [],
      activeDungeonSlugs: dungeonSlugs,
      expectedDungeonCount: dungeonSlugs.length,
      runsPerDungeon: 2,
      expectedSlotCount: dungeonSlugs.length * 2,
      synchronizedAt: null,
      validatedAt: new Date().toISOString(),
      lastKnownGood: true,
      diagnosticExpectedZoneId: null,
      diagnosticZoneMatch: null,
      autoDetectedZoneId: null,
      lineage: {
        regionCode: authority.regionCode,
        regionId: authority.regionId,
        seasonRowId: authority.seasonRowId,
        dungeonPoolHash,
        catalogVersion,
        wclZoneId: zoneId,
      },
      warnings: [],
    },
  };
}
