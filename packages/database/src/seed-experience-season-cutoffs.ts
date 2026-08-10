/**
 * Idempotent seed import of Experience historical season-cutoffs catalog into
 * Season rows + Season.metadata population policy (no network).
 */

import type { RegionCode } from "@mplus/contracts";
import {
  buildSeasonPopulationPolicy,
  stableSha256,
  type SeasonPopulationPolicy,
} from "@mplus/scoring";
import type { Prisma, PrismaClient } from "@prisma/client";
import {
  EXPERIENCE_POPULATION_CATALOG_PROVENANCE_KEY,
  EXPERIENCE_SEASON_CUTOFF_QUANTILES,
  catalogRegionAsRegionCode,
  loadExperienceSeasonCutoffsCatalog,
  readExperiencePopulationCatalogProvenance,
  type ExperienceSeasonCutoffsCatalog,
  type ExperienceSeasonCutoffsCatalogEntry,
} from "./experience-season-cutoffs-catalog.js";

/** Mirrors worker EXPERIENCE_POPULATION_POLICY_METADATA_KEY / store-v2 (no worker import). */
const EXPERIENCE_POPULATION_POLICY_METADATA_KEY = "experiencePopulationPolicy" as const;
const EXPERIENCE_POPULATION_POLICY_STORE_SCHEMA_VERSION =
  "experience-population-policy-store-v2" as const;

export type SeedExperienceCutoffsPrisma = Pick<PrismaClient, "region" | "season">;

export type SeedExperienceCutoffsEntryResult =
  | { status: "APPLIED"; region: string; raiderIoSeasonSlug: string; seasonId: string }
  | { status: "UNCHANGED"; region: string; raiderIoSeasonSlug: string; seasonId: string }
  | {
      status: "SKIPPED_OLDER_CATALOG";
      region: string;
      raiderIoSeasonSlug: string;
      seasonId: string;
      existingCatalogVersion: number;
      catalogVersion: number;
    }
  | {
      status: "SKIPPED_INSUFFICIENT";
      region: string;
      raiderIoSeasonSlug: string;
      reason: string;
    }
  | {
      status: "SKIPPED_REGION_MISSING";
      region: string;
      raiderIoSeasonSlug: string;
    };

export interface SeedExperienceCutoffsReport {
  catalogVersion: number;
  entryCount: number;
  results: SeedExperienceCutoffsEntryResult[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hashSeasonPopulationPolicyContent(policy: SeasonPopulationPolicy): string {
  const anchors = [...policy.anchors].sort((a, b) => {
    if (a.topPercent !== b.topPercent) return a.topPercent - b.topPercent;
    return a.key.localeCompare(b.key);
  });
  return stableSha256({
    version: policy.version,
    source: policy.source,
    region: policy.region,
    seasonSlug: policy.seasonSlug,
    sourceUpdatedAt: policy.sourceUpdatedAt,
    anchors: anchors.map((a) => ({
      key: a.key,
      topPercent: a.topPercent,
      nativeQuantile: a.nativeQuantile,
      score: a.score,
      quantilePopulationCount: a.quantilePopulationCount,
      totalPopulationCount: a.totalPopulationCount,
    })),
    quality: policy.quality,
  }).toLowerCase();
}

function threshold(
  score: number | undefined,
  quantile: (typeof EXPERIENCE_SEASON_CUTOFF_QUANTILES)[number],
  label:
    | "top_0_1_percent"
    | "top_1_percent"
    | "top_10_percent"
    | "top_25_percent"
    | "top_40_percent",
  totalPopulation: number | null,
) {
  if (score === undefined) return null;
  return {
    score,
    quantile,
    label,
    quantilePopulationCount: null,
    totalPopulationCount: totalPopulation,
  };
}

export function catalogEntryToRaiderIoSeasonCutoffs(
  entry: ExperienceSeasonCutoffsCatalogEntry,
) {
  const region = catalogRegionAsRegionCode(entry.region);
  return {
    region,
    seasonSlug: entry.raiderIoSeasonSlug,
    updatedAt: entry.sourceUpdatedAt,
    isRemappedSeason: entry.isRemappedSeason,
    top0_1Percent: threshold(
      entry.cutoffs.p999,
      "p999",
      "top_0_1_percent",
      entry.totalPopulation,
    ),
    top1Percent: threshold(
      entry.cutoffs.p990,
      "p990",
      "top_1_percent",
      entry.totalPopulation,
    ),
    top10Percent: threshold(
      entry.cutoffs.p900,
      "p900",
      "top_10_percent",
      entry.totalPopulation,
    ),
    top25Percent: threshold(
      entry.cutoffs.p750,
      "p750",
      "top_25_percent",
      entry.totalPopulation,
    ),
    top40Percent: threshold(
      entry.cutoffs.p600,
      "p600",
      "top_40_percent",
      entry.totalPopulation,
    ),
    attribution: {
      provider: "raiderio" as const,
      displayText: "Data from Raider.IO" as const,
      homepageUrl: "https://raider.io" as const,
      profileUrl: null,
      sourceUrl: null,
    },
  };
}

function seasonSlugForEntry(entry: ExperienceSeasonCutoffsCatalogEntry): string {
  if (entry.blizzardSeasonId != null) {
    return `blizzard-season-${entry.blizzardSeasonId}`;
  }
  return `rio-${entry.raiderIoSeasonSlug}`;
}

async function findOrCreateSeason(input: {
  prisma: SeedExperienceCutoffsPrisma;
  regionId: string;
  entry: ExperienceSeasonCutoffsCatalogEntry;
}): Promise<{ id: string; metadata: unknown }> {
  const { prisma, regionId, entry } = input;

  if (entry.blizzardSeasonId != null) {
    const byBlizzard = await prisma.season.findFirst({
      where: { regionId, blizzardSeasonId: entry.blizzardSeasonId },
      select: { id: true, metadata: true, startsAt: true, endsAt: true, providerSeasonId: true },
    });
    if (byBlizzard) {
      await prisma.season.update({
        where: { id: byBlizzard.id },
        data: {
          providerSeasonId: entry.raiderIoSeasonSlug,
          ...(byBlizzard.startsAt == null && entry.startsAt
            ? { startsAt: new Date(entry.startsAt) }
            : {}),
          ...(byBlizzard.endsAt == null && entry.endsAt
            ? { endsAt: new Date(entry.endsAt) }
            : {}),
        },
      });
      const refreshed = await prisma.season.findUniqueOrThrow({
        where: { id: byBlizzard.id },
        select: { id: true, metadata: true },
      });
      return refreshed;
    }
  }

  const byProvider = await prisma.season.findFirst({
    where: { regionId, providerSeasonId: entry.raiderIoSeasonSlug },
    select: { id: true, metadata: true },
  });
  if (byProvider) return byProvider;

  const slug = seasonSlugForEntry(entry);
  const bySlug = await prisma.season.findFirst({
    where: { regionId, slug },
    select: { id: true, metadata: true, startsAt: true, endsAt: true },
  });
  if (bySlug) {
    await prisma.season.update({
      where: { id: bySlug.id },
      data: {
        blizzardSeasonId: entry.blizzardSeasonId,
        providerSeasonId: entry.raiderIoSeasonSlug,
        ...(bySlug.startsAt == null && entry.startsAt
          ? { startsAt: new Date(entry.startsAt) }
          : {}),
        ...(bySlug.endsAt == null && entry.endsAt ? { endsAt: new Date(entry.endsAt) } : {}),
      },
    });
    const refreshed = await prisma.season.findUniqueOrThrow({
      where: { id: bySlug.id },
      select: { id: true, metadata: true },
    });
    return refreshed;
  }

  const created = await prisma.season.create({
    data: {
      regionId,
      slug,
      name: entry.name ?? `Mythic+ ${entry.raiderIoSeasonSlug}`,
      blizzardSeasonId: entry.blizzardSeasonId,
      providerSeasonId: entry.raiderIoSeasonSlug,
      isCurrent: false,
      ...(entry.startsAt ? { startsAt: new Date(entry.startsAt) } : {}),
      ...(entry.endsAt ? { endsAt: new Date(entry.endsAt) } : {}),
      metadata: {},
    },
    select: { id: true, metadata: true },
  });
  return created;
}

function mergeMetadata(
  existing: unknown,
  policyDoc: Record<string, unknown>,
  provenance: Record<string, unknown>,
): Record<string, unknown> {
  const base = isPlainObject(existing) ? { ...existing } : {};
  return {
    ...base,
    [EXPERIENCE_POPULATION_POLICY_METADATA_KEY]: policyDoc,
    [EXPERIENCE_POPULATION_CATALOG_PROVENANCE_KEY]: provenance,
  };
}

export async function seedExperienceSeasonCutoffsFromCatalog(
  prisma: SeedExperienceCutoffsPrisma,
  options?: {
    catalog?: ExperienceSeasonCutoffsCatalog;
    now?: Date;
  },
): Promise<SeedExperienceCutoffsReport> {
  const catalog = options?.catalog ?? loadExperienceSeasonCutoffsCatalog();
  const nowIso = (options?.now ?? new Date()).toISOString();
  const results: SeedExperienceCutoffsEntryResult[] = [];

  const regionRows = await prisma.region.findMany({
    select: { id: true, code: true },
  });
  const regionByCode = new Map(
    regionRows.map((r) => [r.code.trim().toUpperCase(), r.id] as const),
  );

  for (const entry of catalog.entries) {
    const regionId = regionByCode.get(entry.region);
    if (!regionId) {
      results.push({
        status: "SKIPPED_REGION_MISSING",
        region: entry.region,
        raiderIoSeasonSlug: entry.raiderIoSeasonSlug,
      });
      continue;
    }

    const cutoffs = catalogEntryToRaiderIoSeasonCutoffs(entry);
    const built = buildSeasonPopulationPolicy(cutoffs, {
      seasonSlug: entry.raiderIoSeasonSlug,
    });
    if (!built.ok || built.policy.quality === "INSUFFICIENT") {
      results.push({
        status: "SKIPPED_INSUFFICIENT",
        region: entry.region,
        raiderIoSeasonSlug: entry.raiderIoSeasonSlug,
        reason: built.ok ? "INSUFFICIENT_POLICY" : built.reason,
      });
      continue;
    }

    const season = await findOrCreateSeason({ prisma, regionId, entry });
    const existingProvenance = readExperiencePopulationCatalogProvenance(season.metadata);
    if (
      existingProvenance &&
      existingProvenance.catalogVersion > catalog.catalogVersion
    ) {
      results.push({
        status: "SKIPPED_OLDER_CATALOG",
        region: entry.region,
        raiderIoSeasonSlug: entry.raiderIoSeasonSlug,
        seasonId: season.id,
        existingCatalogVersion: existingProvenance.catalogVersion,
        catalogVersion: catalog.catalogVersion,
      });
      continue;
    }

    const policyContentHash = hashSeasonPopulationPolicyContent(built.policy);
    const existingPolicy = isPlainObject(season.metadata)
      ? season.metadata[EXPERIENCE_POPULATION_POLICY_METADATA_KEY]
      : null;
    const existingHash =
      isPlainObject(existingPolicy) && typeof existingPolicy.policyContentHash === "string"
        ? existingPolicy.policyContentHash.toLowerCase()
        : null;
    const samePolicy = existingHash === policyContentHash;
    const sameProvenance =
      existingProvenance?.catalogVersion === catalog.catalogVersion &&
      existingProvenance.raiderIoSeasonSlug === entry.raiderIoSeasonSlug;

    if (samePolicy && sameProvenance) {
      results.push({
        status: "UNCHANGED",
        region: entry.region,
        raiderIoSeasonSlug: entry.raiderIoSeasonSlug,
        seasonId: season.id,
      });
      continue;
    }

    const policyDoc = {
      schemaVersion: EXPERIENCE_POPULATION_POLICY_STORE_SCHEMA_VERSION,
      policy: built.policy,
      raiderIoSeasonSlug: entry.raiderIoSeasonSlug,
      policyContentHash,
      sourceRequestFingerprint: `experience-cutoffs-catalog:v${catalog.catalogVersion}:${entry.region}:${entry.raiderIoSeasonSlug}`,
      sourcePayloadId: null,
      sourceFetchedAt: entry.source.collectedAt,
      synchronizedAt: nowIso,
      lastKnownGood: true as const,
    };
    const provenance = {
      catalogVersion: catalog.catalogVersion,
      catalogSchemaVersion: catalog.schemaVersion,
      raiderIoSeasonSlug: entry.raiderIoSeasonSlug,
      importedAt: nowIso,
    };

    await prisma.season.update({
      where: { id: season.id },
      data: {
        metadata: mergeMetadata(season.metadata, policyDoc, provenance) as Prisma.InputJsonValue,
      },
    });

    results.push({
      status: "APPLIED",
      region: entry.region,
      raiderIoSeasonSlug: entry.raiderIoSeasonSlug,
      seasonId: season.id,
    });
  }

  return {
    catalogVersion: catalog.catalogVersion,
    entryCount: catalog.entries.length,
    results,
  };
}

/** @internal test helper — RegionCode cast for cutoffs builder. */
export type _RegionCode = RegionCode;
