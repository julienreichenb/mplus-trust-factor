import type { PrismaClient } from "@mplus/database";
import { PROVIDER_DATA_EXPORT_TABLES, PROVIDER_DATA_SCHEMA_VERSION } from "./allowlist.js";
import { hashCanonicalPayload, serializeRow } from "./canonical.js";

export type ProviderDataCorpus = {
  schemaVersion: typeof PROVIDER_DATA_SCHEMA_VERSION;
  tables: Record<string, Array<Record<string, unknown>>>;
};

export type ProviderDataManifest = {
  schemaVersion: number;
  generatedAt: string;
  sourceEnvironment: string;
  contentHash: string;
  regions: string[];
  seasonIds: string[];
  counts: Record<string, number>;
};

async function loadTableRows(
  prisma: PrismaClient,
  table: string,
): Promise<Array<Record<string, unknown>>> {
  switch (table) {
    case "regions":
      return prisma.region.findMany({ orderBy: { id: "asc" } }) as Promise<
        Array<Record<string, unknown>>
      >;
    case "realms":
      return prisma.realm.findMany({ orderBy: { id: "asc" } }) as Promise<
        Array<Record<string, unknown>>
      >;
    case "game_classes":
      return prisma.gameClass.findMany({ orderBy: { id: "asc" } }) as Promise<
        Array<Record<string, unknown>>
      >;
    case "game_specializations":
      return prisma.gameSpecialization.findMany({ orderBy: { id: "asc" } }) as Promise<
        Array<Record<string, unknown>>
      >;
    case "seasons":
      return prisma.season.findMany({ orderBy: { id: "asc" } }) as Promise<
        Array<Record<string, unknown>>
      >;
    case "dungeons":
      return prisma.dungeon.findMany({ orderBy: { id: "asc" } }) as Promise<
        Array<Record<string, unknown>>
      >;
    case "season_dungeons":
      return prisma.seasonDungeon.findMany({
        orderBy: [{ seasonId: "asc" }, { dungeonId: "asc" }],
      }) as Promise<Array<Record<string, unknown>>>;
    case "score_models":
      return prisma.scoreModel.findMany({ orderBy: { id: "asc" } }) as Promise<
        Array<Record<string, unknown>>
      >;
    case "red_flag_definitions":
      return prisma.redFlagDefinition.findMany({ orderBy: { id: "asc" } }) as Promise<
        Array<Record<string, unknown>>
      >;
    case "characters":
      return prisma.character.findMany({ orderBy: { id: "asc" } }) as Promise<
        Array<Record<string, unknown>>
      >;
    case "character_aliases":
      return prisma.characterAlias.findMany({ orderBy: { id: "asc" } }) as Promise<
        Array<Record<string, unknown>>
      >;
    case "character_provider_states":
      return prisma.characterProviderState.findMany({ orderBy: { id: "asc" } }) as Promise<
        Array<Record<string, unknown>>
      >;
    case "season_median_key_distribution_snapshots":
      return prisma.seasonMedianKeyDistributionSnapshot.findMany({
        orderBy: { id: "asc" },
      }) as Promise<Array<Record<string, unknown>>>;
    case "season_score_context_revisions":
      return prisma.seasonScoreContextRevision.findMany({ orderBy: { id: "asc" } }) as Promise<
        Array<Record<string, unknown>>
      >;
    case "score_context_revision_region_snapshots":
      return prisma.scoreContextRevisionRegionSnapshot.findMany({
        orderBy: { id: "asc" },
      }) as Promise<Array<Record<string, unknown>>>;
    case "wcl_run_raw":
      return prisma.wclRunRaw.findMany({ orderBy: { id: "asc" } }) as Promise<
        Array<Record<string, unknown>>
      >;
    case "character_run_digests":
      return prisma.characterRunDigest.findMany({ orderBy: { id: "asc" } }) as Promise<
        Array<Record<string, unknown>>
      >;
    case "run_ranking_facts":
      return prisma.runRankingFact.findMany({ orderBy: { id: "asc" } }) as Promise<
        Array<Record<string, unknown>>
      >;
    case "wcl_fight_ranking_snapshots":
      return prisma.wclFightRankingSnapshot.findMany({ orderBy: { id: "asc" } }) as Promise<
        Array<Record<string, unknown>>
      >;
    case "wcl_fight_ranking_entries":
      return prisma.wclFightRankingEntry.findMany({ orderBy: { id: "asc" } }) as Promise<
        Array<Record<string, unknown>>
      >;
    case "character_performance_aggregates":
      return prisma.characterPerformanceAggregate.findMany({ orderBy: { id: "asc" } }) as Promise<
        Array<Record<string, unknown>>
      >;
    case "character_experience_evidence":
      return prisma.characterExperienceEvidence.findMany({ orderBy: { id: "asc" } }) as Promise<
        Array<Record<string, unknown>>
      >;
    case "character_scores":
      return prisma.characterScore.findMany({ orderBy: { id: "asc" } }) as Promise<
        Array<Record<string, unknown>>
      >;
    case "score_snapshots":
      return prisma.scoreSnapshot.findMany({ orderBy: { id: "asc" } }) as Promise<
        Array<Record<string, unknown>>
      >;
    case "dimension_scores":
      return prisma.dimensionScore.findMany({ orderBy: { id: "asc" } }) as Promise<
        Array<Record<string, unknown>>
      >;
    case "character_published_scores":
      return prisma.characterPublishedScore.findMany({ orderBy: { id: "asc" } }) as Promise<
        Array<Record<string, unknown>>
      >;
    case "character_red_flags":
      return prisma.characterRedFlag.findMany({ orderBy: { id: "asc" } }) as Promise<
        Array<Record<string, unknown>>
      >;
    default:
      throw new Error(`PROVIDER_DATA_EXPORT: missing loader for ${table}`);
  }
}

function stripSensitiveFields(table: string, row: Record<string, unknown>): Record<string, unknown> {
  const next = { ...row };
  if (table === "score_models" || table === "season_score_context_revisions") {
    next.createdByUserId = null;
  }
  if (table === "character_scores") {
    next.abilityCatalogReleaseId = null;
  }
  if (table === "score_snapshots") {
    next.analysisBatchId = null;
    next.evidenceManifestId = null;
    next.abilityCatalogReleaseId = null;
  }
  if (table === "character_red_flags") {
    next.runId = null;
  }
  if (table === "character_experience_evidence") {
    next.sourcePayloadId = null;
  }
  return next;
}

export async function buildProviderDataCorpus(prisma: PrismaClient): Promise<{
  corpus: ProviderDataCorpus;
  contentHash: string;
  counts: Record<string, number>;
  regions: string[];
  seasonIds: string[];
}> {
  const tables: Record<string, Array<Record<string, unknown>>> = {};
  const counts: Record<string, number> = {};

  for (const table of PROVIDER_DATA_EXPORT_TABLES) {
    const rows = await loadTableRows(prisma, table);
    const serialized = rows.map((row) => serializeRow(stripSensitiveFields(table, row)));
    tables[table] = serialized;
    counts[table] = serialized.length;
  }

  const corpus: ProviderDataCorpus = {
    schemaVersion: PROVIDER_DATA_SCHEMA_VERSION,
    tables,
  };
  const contentHash = hashCanonicalPayload(corpus);
  const regions = (tables.regions ?? [])
    .map((r) => String(r.code ?? ""))
    .filter(Boolean)
    .sort();
  const seasonIds = (tables.seasons ?? []).map((s) => String(s.id)).sort();

  return { corpus, contentHash, counts, regions, seasonIds };
}

export function buildManifest(input: {
  contentHash: string;
  sourceEnvironment: string;
  generatedAt?: Date;
  regions: string[];
  seasonIds: string[];
  counts: Record<string, number>;
}): ProviderDataManifest {
  return {
    schemaVersion: PROVIDER_DATA_SCHEMA_VERSION,
    generatedAt: (input.generatedAt ?? new Date()).toISOString(),
    sourceEnvironment: input.sourceEnvironment,
    contentHash: input.contentHash,
    regions: input.regions,
    seasonIds: input.seasonIds,
    counts: input.counts,
  };
}
