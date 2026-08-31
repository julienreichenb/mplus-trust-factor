import { readFile } from "node:fs/promises";
import {
  KEY_CONTEXT_PERCENTILE_BPS,
  KEY_CONTEXT_REGION_CODES,
  KEY_DISTRIBUTION_INCLUSION_ALL_8,
  RAIDER_IO_ADDON_DISTRIBUTION_SOURCE,
  type KeyContextRegionCode,
} from "@mplus/contracts";
import {
  medianKeySnapshotIdentityHash,
  pointsFromHistogram,
  validatePackedDungeonKeyDistribution,
} from "@mplus/scoring";
import { accumulateEligibleMedianHistogram, assertLookupCoversNamedOffsets } from "./histogram.js";
import { assertRequestedAddonRegion, mapRioDungeonsToSeasonPool } from "./map-dungeons.js";
import {
  loadLookupBuffer,
  parseNamedCharacterOffsets,
  parseTocInterface,
  validatePackedProviderHeader,
} from "./parse-characters.js";
import { parseDbDungeonsLua, parseProviderHeader } from "./parse-lua-meta.js";
import { layoutFromProviderHeader } from "./packed-layout.js";
import { AddonDbFormatError, type SeasonDungeonIdentity } from "./types.js";

export interface AddonDistributionResult {
  source: typeof RAIDER_IO_ADDON_DISTRIBUTION_SOURCE;
  region: KeyContextRegionCode;
  points: Array<{ percentileBps: number; medianKeyThreshold: number }>;
  population: {
    indexedCharacters: number;
    eligibleCharacters: number;
    inclusionPolicy: typeof KEY_DISTRIBUTION_INCLUSION_ALL_8;
  };
  sourceMetadata: Record<string, unknown>;
  contentHash: string;
}

function normalizeRegionCode(regionCode: string): KeyContextRegionCode {
  const code = regionCode.trim().toUpperCase();
  if (!(KEY_CONTEXT_REGION_CODES as readonly string[]).includes(code)) {
    throw new AddonDbFormatError("REGION", `Unsupported Mythic+ region ${regionCode}`);
  }
  return code as KeyContextRegionCode;
}

export async function ingestMythicPlusAddonFiles(input: {
  regionCode: string;
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
  const region = normalizeRegionCode(input.regionCode);
  const lookupText = (await readFile(input.lookupLuaPath)).toString("latin1");
  const lookupHeader = parseProviderHeader(lookupText.slice(0, 32_768));
  validatePackedProviderHeader(lookupHeader);
  const layout = layoutFromProviderHeader({
    ...lookupHeader,
    dungeonCount: input.expectedDungeons.length,
  });
  const lookup = loadLookupBuffer(lookupText);
  const { header, named } = await parseNamedCharacterOffsets(input.charactersLuaPath, lookupHeader.recordSizeInBytes);
  assertRequestedAddonRegion(header.region, region);
  assertRequestedAddonRegion(lookupHeader.region, region);
  assertLookupCoversNamedOffsets(lookup, named, lookupHeader.recordSizeInBytes);
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
    layout,
  );
  if (eligibleCharacters <= 0) {
    throw new AddonDbFormatError("EMPTY_POPULATION", "No eligible 8/8 characters in addon snapshot");
  }
  const points = pointsFromHistogram(histogram, KEY_CONTEXT_PERCENTILE_BPS);
  const packed = validatePackedDungeonKeyDistribution(points);
  if (!packed.ok) {
    throw new AddonDbFormatError(
      "KEY_FIELD_SATURATION",
      packed.issues.map((issue: { message: string }) => issue.message).join("; "),
    );
  }
  const sourceVersion = input.releaseTag;
  const contentHash = medianKeySnapshotIdentityHash({
    source: RAIDER_IO_ADDON_DISTRIBUTION_SOURCE,
    sourceVersion,
    assetSha256: input.assetSha256,
    points,
  });
  return {
    source: RAIDER_IO_ADDON_DISTRIBUTION_SOURCE,
    region,
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
      providerDatabaseDate: lookupHeader.date,
      region,
      currentSeasonId: lookupHeader.currentSeasonId,
      recordSizeInBytes: lookupHeader.recordSizeInBytes,
      encodingOrder: lookupHeader.encodingOrder,
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

/** @deprecated Use ingestMythicPlusAddonFiles({ regionCode: "EU", ... }) */
export async function ingestEuMythicPlusAddonFiles(
  input: Omit<Parameters<typeof ingestMythicPlusAddonFiles>[0], "regionCode">,
): Promise<AddonDistributionResult> {
  return ingestMythicPlusAddonFiles({ ...input, regionCode: "EU" });
}
