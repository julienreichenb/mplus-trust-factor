import { readFile } from "node:fs/promises";
import {
  ADMIN_SCORING_DEFAULT_REGION,
  KEY_CONTEXT_PERCENTILE_BPS,
  KEY_DISTRIBUTION_INCLUSION_ALL_8,
  RAIDER_IO_ADDON_DISTRIBUTION_SOURCE,
} from "@mplus/contracts";
import { medianKeySnapshotIdentityHash, pointsFromHistogram } from "@mplus/scoring";
import { accumulateEligibleMedianHistogram } from "./histogram.js";
import { assertEuRegion, mapRioDungeonsToSeasonPool } from "./map-dungeons.js";
import { loadLookupBuffer, parseNamedCharacterOffsets, parseTocInterface, validateHeader } from "./parse-characters.js";
import { parseDbDungeonsLua } from "./parse-lua-meta.js";
import { AddonDbFormatError, type SeasonDungeonIdentity } from "./types.js";

export interface AddonDistributionResult {
  source: typeof RAIDER_IO_ADDON_DISTRIBUTION_SOURCE;
  region: typeof ADMIN_SCORING_DEFAULT_REGION;
  points: Array<{ percentileBps: number; medianKeyThreshold: number }>;
  population: {
    indexedCharacters: number;
    eligibleCharacters: number;
    inclusionPolicy: typeof KEY_DISTRIBUTION_INCLUSION_ALL_8;
  };
  sourceMetadata: Record<string, unknown>;
  contentHash: string;
}

export async function ingestEuMythicPlusAddonFiles(input: {
  lookupLuaPath: string;
  charactersLuaPath: string;
  dungeonsLuaPath: string;
  tocText?: string | null;
  expectedDungeons: readonly SeasonDungeonIdentity[];
  releaseTag: string;
  assetName: string;
  assetSha256: string;
  githubPublishedAt?: string | null;
  collectedAt?: Date;
}): Promise<AddonDistributionResult> {
  const lookupText = await readFile(input.lookupLuaPath, "utf8");
  const lookup = loadLookupBuffer(lookupText);
  const { header, named } = await parseNamedCharacterOffsets(input.charactersLuaPath);
  validateHeader(header);
  assertEuRegion(header.region);
  if (lookup.length % 30 !== 0) {
    throw new AddonDbFormatError("LOOKUP_LENGTH", "truncated/corrupted lookup payload");
  }
  const dungeonsLua = await readFile(input.dungeonsLuaPath, "utf8");
  const rioDungeons = parseDbDungeonsLua(dungeonsLua, header.currentSeasonId);
  mapRioDungeonsToSeasonPool(rioDungeons, input.expectedDungeons);
  if (input.tocText) {
    const iface = parseTocInterface(input.tocText);
    if (iface != null && iface < 110000) {
      throw new AddonDbFormatError("TOC", `Unexpected retail Interface ${iface}`);
    }
  }
  const { indexedCharacters, eligibleCharacters, histogram } = accumulateEligibleMedianHistogram(
    lookup,
    named.map((n) => ({ byteOffset: n.byteOffset })),
  );
  if (eligibleCharacters <= 0) {
    throw new AddonDbFormatError("EMPTY_POPULATION", "No eligible 8/8 characters in addon snapshot");
  }
  const points = pointsFromHistogram(histogram, KEY_CONTEXT_PERCENTILE_BPS);
  const sourceVersion = input.releaseTag;
  const contentHash = medianKeySnapshotIdentityHash({
    source: RAIDER_IO_ADDON_DISTRIBUTION_SOURCE,
    sourceVersion,
    assetSha256: input.assetSha256,
    points,
  });
  return {
    source: RAIDER_IO_ADDON_DISTRIBUTION_SOURCE,
    region: ADMIN_SCORING_DEFAULT_REGION,
    points,
    population: {
      indexedCharacters,
      eligibleCharacters,
      inclusionPolicy: KEY_DISTRIBUTION_INCLUSION_ALL_8,
    },
    contentHash,
    sourceMetadata: {
      repository: "RaiderIO/raiderio-addon",
      releaseTag: input.releaseTag,
      assetName: input.assetName,
      assetSha256: input.assetSha256,
      githubPublishedAt: input.githubPublishedAt ?? null,
      providerDatabaseDate: header.date,
      region: ADMIN_SCORING_DEFAULT_REGION,
      currentSeasonId: header.currentSeasonId,
      dungeonSet: rioDungeons.map((d) => ({
        name: d.name,
        instanceMapId: d.instanceMapId,
        shortName: d.shortName,
      })),
      indexedCharacters,
      eligibleCharacters,
      inclusionPolicy: KEY_DISTRIBUTION_INCLUSION_ALL_8,
      collectedAt: (input.collectedAt ?? new Date()).toISOString(),
    },
  };
}
