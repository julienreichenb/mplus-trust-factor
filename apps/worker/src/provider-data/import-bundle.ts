import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { Prisma, type PrismaClient } from "@mplus/database";
import {
  PROVIDER_DATA_DENYLIST_TABLES,
  PROVIDER_DATA_EXPORT_TABLES,
  PROVIDER_DATA_SCHEMA_VERSION,
} from "./allowlist.js";
import type { ProviderDataCorpus, ProviderDataManifest } from "./build-corpus.js";
import { hashCanonicalPayload } from "./canonical.js";

export class ProviderDataImportError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ProviderDataImportError";
  }
}

export async function readProviderDataBundle(dir: string): Promise<{
  manifest: ProviderDataManifest;
  corpus: ProviderDataCorpus;
}> {
  const manifestRaw = await readFile(join(dir, "manifest.json"), "utf8");
  const manifest = JSON.parse(manifestRaw) as ProviderDataManifest;
  const gzipBytes = await readFile(join(dir, "latest.json.gz"));
  const json = gunzipSync(gzipBytes).toString("utf8");
  const corpus = JSON.parse(json) as ProviderDataCorpus;
  return { manifest, corpus };
}

function assertBundleIntegrity(manifest: ProviderDataManifest, corpus: ProviderDataCorpus): void {
  if (manifest.schemaVersion !== PROVIDER_DATA_SCHEMA_VERSION) {
    throw new ProviderDataImportError(
      "UNSUPPORTED_SCHEMA",
      `Unsupported provider-data schemaVersion ${manifest.schemaVersion} (expected ${PROVIDER_DATA_SCHEMA_VERSION})`,
    );
  }
  if (corpus.schemaVersion !== PROVIDER_DATA_SCHEMA_VERSION) {
    throw new ProviderDataImportError(
      "UNSUPPORTED_SCHEMA",
      `Corpus schemaVersion ${corpus.schemaVersion} mismatch`,
    );
  }
  for (const denied of PROVIDER_DATA_DENYLIST_TABLES) {
    if (corpus.tables[denied]) {
      throw new ProviderDataImportError(
        "DENYLIST_VIOLATION",
        `Bundle contains denied table ${denied}`,
      );
    }
  }
  const actualHash = hashCanonicalPayload(corpus);
  if (actualHash !== manifest.contentHash) {
    throw new ProviderDataImportError(
      "CONTENT_HASH_MISMATCH",
      `Bundle contentHash mismatch (manifest ${manifest.contentHash}, actual ${actualHash})`,
    );
  }
}

function asJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function asDate(value: unknown): Date | null {
  if (value == null) return null;
  return value instanceof Date ? value : new Date(String(value));
}

function asRequiredDate(value: unknown): Date {
  const d = asDate(value);
  if (!d || Number.isNaN(d.getTime())) {
    throw new ProviderDataImportError("INVALID_DATE", `Invalid date value: ${String(value)}`);
  }
  return d;
}

function asBigInt(value: unknown): bigint | null {
  if (value == null) return null;
  if (typeof value === "bigint") return value;
  return BigInt(String(value));
}

function prepareRow(table: string, row: Record<string, unknown>): Record<string, unknown> {
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
  if (table === "characters") {
    next.blizzardCharacterId = asBigInt(next.blizzardCharacterId);
    next.wclCanonicalId = asBigInt(next.wclCanonicalId);
  }
  return next;
}

async function upsertRows(
  prisma: PrismaClient,
  table: string,
  rows: Array<Record<string, unknown>>,
): Promise<{ inserted: number; updated: number; unchanged: number }> {
  let inserted = 0;
  let updated = 0;
  let unchanged = 0;

  for (const raw of rows) {
    const row = prepareRow(table, raw);
    const result = await upsertOne(prisma, table, row);
    if (result === "inserted") inserted += 1;
    else if (result === "updated") updated += 1;
    else unchanged += 1;
  }
  return { inserted, updated, unchanged };
}

async function upsertOne(
  prisma: PrismaClient,
  table: string,
  row: Record<string, unknown>,
): Promise<"inserted" | "updated" | "unchanged"> {
  switch (table) {
    case "regions": {
      const existing = await prisma.region.findUnique({ where: { id: String(row.id) } });
      if (!existing) {
        await prisma.region.create({ data: row as never });
        return "inserted";
      }
      return "unchanged";
    }
    case "realms": {
      const existing = await prisma.realm.findUnique({ where: { id: String(row.id) } });
      if (!existing) {
        await prisma.realm.create({ data: row as never });
        return "inserted";
      }
      return "unchanged";
    }
    case "game_classes": {
      const existing = await prisma.gameClass.findUnique({ where: { id: String(row.id) } });
      if (!existing) {
        await prisma.gameClass.create({ data: row as never });
        return "inserted";
      }
      return "unchanged";
    }
    case "game_specializations": {
      const existing = await prisma.gameSpecialization.findUnique({ where: { id: String(row.id) } });
      if (!existing) {
        await prisma.gameSpecialization.create({ data: row as never });
        return "inserted";
      }
      return "unchanged";
    }
    case "seasons": {
      const existing = await prisma.season.findUnique({ where: { id: String(row.id) } });
      if (!existing) {
        await prisma.season.create({ data: row as never });
        return "inserted";
      }
      return "unchanged";
    }
    case "dungeons": {
      const existing = await prisma.dungeon.findUnique({ where: { id: String(row.id) } });
      if (!existing) {
        await prisma.dungeon.create({ data: row as never });
        return "inserted";
      }
      return "unchanged";
    }
    case "season_dungeons": {
      const seasonId = String(row.seasonId);
      const dungeonId = String(row.dungeonId);
      const existing = await prisma.seasonDungeon.findUnique({
        where: { seasonId_dungeonId: { seasonId, dungeonId } },
      });
      if (!existing) {
        await prisma.seasonDungeon.create({ data: row as never });
        return "inserted";
      }
      return "unchanged";
    }
    case "score_models": {
      const existing = await prisma.scoreModel.findUnique({ where: { id: String(row.id) } });
      if (!existing) {
        await prisma.scoreModel.create({
          data: {
            ...row,
            config: asJson(row.config),
            createdAt: asRequiredDate(row.createdAt),
            activatedAt: asDate(row.activatedAt),
          } as never,
        });
        return "inserted";
      }
      return "unchanged";
    }
    case "red_flag_definitions": {
      const existing = await prisma.redFlagDefinition.findUnique({ where: { id: String(row.id) } });
      if (!existing) {
        await prisma.redFlagDefinition.create({ data: row as never });
        return "inserted";
      }
      return "unchanged";
    }
    case "characters": {
      const existing = await prisma.character.findUnique({ where: { id: String(row.id) } });
      if (!existing) {
        await prisma.character.create({
          data: {
            ...row,
            lastSeenAt: asDate(row.lastSeenAt),
            lastPublicRefreshAt: asDate(row.lastPublicRefreshAt),
            createdAt: asRequiredDate(row.createdAt),
            updatedAt: asRequiredDate(row.updatedAt),
          } as never,
        });
        return "inserted";
      }
      return "unchanged";
    }
    case "character_aliases": {
      const existing = await prisma.characterAlias.findUnique({ where: { id: String(row.id) } });
      if (!existing) {
        await prisma.characterAlias.create({
          data: {
            ...row,
            validFrom: asRequiredDate(row.validFrom),
            validTo: asDate(row.validTo),
          } as never,
        });
        return "inserted";
      }
      return "unchanged";
    }
    case "character_provider_states": {
      const existing = await prisma.characterProviderState.findUnique({
        where: { id: String(row.id) },
      });
      if (!existing) {
        await prisma.characterProviderState.create({
          data: {
            ...row,
            warnings: asJson(row.warnings ?? []),
            disagreements: asJson(row.disagreements ?? []),
            excludedObservations: asJson(row.excludedObservations ?? []),
            metadata: asJson(row.metadata ?? {}),
            lastAttemptAt: asRequiredDate(row.lastAttemptAt),
            lastSuccessAt: asDate(row.lastSuccessAt),
            fetchedAt: asDate(row.fetchedAt),
            expiresAt: asDate(row.expiresAt),
            createdAt: asRequiredDate(row.createdAt),
            updatedAt: asRequiredDate(row.updatedAt),
          } as never,
        });
        return "inserted";
      }
      return "unchanged";
    }
    case "season_median_key_distribution_snapshots": {
      const existing = await prisma.seasonMedianKeyDistributionSnapshot.findUnique({
        where: { id: String(row.id) },
      });
      if (!existing) {
        await prisma.seasonMedianKeyDistributionSnapshot.create({
          data: {
            ...row,
            provenance: asJson(row.provenance),
            points: asJson(row.points),
            collectedAt: asRequiredDate(row.collectedAt),
            effectiveAt: asDate(row.effectiveAt),
            createdAt: asRequiredDate(row.createdAt),
            updatedAt: asRequiredDate(row.updatedAt),
          } as never,
        });
        return "inserted";
      }
      if (existing.contentHash !== row.contentHash) {
        throw new ProviderDataImportError(
          "IMMUTABLE_CONFLICT",
          `Distribution snapshot ${row.id} contentHash conflict`,
        );
      }
      return "unchanged";
    }
    case "season_score_context_revisions": {
      const existing = await prisma.seasonScoreContextRevision.findUnique({
        where: { id: String(row.id) },
      });
      if (!existing) {
        await prisma.seasonScoreContextRevision.create({
          data: {
            ...row,
            tierFactors: asJson(row.tierFactors),
            specAssignments: asJson(row.specAssignments),
            percentileAnchors: asJson(row.percentileAnchors),
            createdAt: asRequiredDate(row.createdAt),
            publishedAt: asDate(row.publishedAt),
            updatedAt: asRequiredDate(row.updatedAt),
          } as never,
        });
        return "inserted";
      }
      return "unchanged";
    }
    case "score_context_revision_region_snapshots": {
      const existing = await prisma.scoreContextRevisionRegionSnapshot.findUnique({
        where: { id: String(row.id) },
      });
      if (!existing) {
        await prisma.scoreContextRevisionRegionSnapshot.create({
          data: {
            ...row,
            createdAt: asRequiredDate(row.createdAt),
          } as never,
        });
        return "inserted";
      }
      return "unchanged";
    }
    case "wcl_run_raw": {
      const existing = await prisma.wclRunRaw.findUnique({ where: { id: String(row.id) } });
      if (!existing) {
        await prisma.wclRunRaw.create({
          data: {
            ...row,
            payload: asJson(row.payload),
            providerCost: row.providerCost == null ? undefined : asJson(row.providerCost),
            fetchedAt: asRequiredDate(row.fetchedAt),
            createdAt: asRequiredDate(row.createdAt),
            updatedAt: asRequiredDate(row.updatedAt),
          } as never,
        });
        return "inserted";
      }
      return "unchanged";
    }
    case "character_run_digests": {
      const existing = await prisma.characterRunDigest.findUnique({ where: { id: String(row.id) } });
      if (!existing) {
        await prisma.characterRunDigest.create({
          data: {
            ...row,
            offensive: asJson(row.offensive),
            utility: asJson(row.utility),
            survival: asJson(row.survival),
            sourceMetadata: asJson(row.sourceMetadata),
            createdAt: asRequiredDate(row.createdAt),
            updatedAt: asRequiredDate(row.updatedAt),
          } as never,
        });
        return "inserted";
      }
      return "unchanged";
    }
    case "run_ranking_facts": {
      const existing = await prisma.runRankingFact.findUnique({ where: { id: String(row.id) } });
      if (!existing) {
        await prisma.runRankingFact.create({
          data: {
            ...row,
            payload: asJson(row.payload),
            fetchedAt: asRequiredDate(row.fetchedAt),
            createdAt: asRequiredDate(row.createdAt),
            updatedAt: asRequiredDate(row.updatedAt),
          } as never,
        });
        return "inserted";
      }
      return "unchanged";
    }
    case "wcl_fight_ranking_snapshots": {
      const existing = await prisma.wclFightRankingSnapshot.findUnique({
        where: { id: String(row.id) },
      });
      if (!existing) {
        await prisma.wclFightRankingSnapshot.create({
          data: {
            ...row,
            fetchedAt: asRequiredDate(row.fetchedAt),
            createdAt: asRequiredDate(row.createdAt),
          } as never,
        });
        return "inserted";
      }
      return "unchanged";
    }
    case "wcl_fight_ranking_entries": {
      const existing = await prisma.wclFightRankingEntry.findUnique({
        where: { id: String(row.id) },
      });
      if (!existing) {
        await prisma.wclFightRankingEntry.create({ data: row as never });
        return "inserted";
      }
      return "unchanged";
    }
    case "character_performance_aggregates": {
      const existing = await prisma.characterPerformanceAggregate.findUnique({
        where: { id: String(row.id) },
      });
      if (!existing) {
        await prisma.characterPerformanceAggregate.create({
          data: {
            ...row,
            rawPayload: asJson(row.rawPayload),
            dungeonAggregates: asJson(row.dungeonAggregates),
            globalSummary: row.globalSummary == null ? undefined : asJson(row.globalSummary),
            diagnostics: asJson(row.diagnostics),
            fetchedAt: asRequiredDate(row.fetchedAt),
            expiresAt: asRequiredDate(row.expiresAt),
            createdAt: asRequiredDate(row.createdAt),
            updatedAt: asRequiredDate(row.updatedAt),
          } as never,
        });
        return "inserted";
      }
      return "unchanged";
    }
    case "character_experience_evidence": {
      const existing = await prisma.characterExperienceEvidence.findUnique({
        where: { id: String(row.id) },
      });
      if (!existing) {
        await prisma.characterExperienceEvidence.create({
          data: {
            ...row,
            payload: asJson(row.payload),
            fetchedAt: asRequiredDate(row.fetchedAt),
            createdAt: asRequiredDate(row.createdAt),
            updatedAt: asRequiredDate(row.updatedAt),
          } as never,
        });
        return "inserted";
      }
      return "unchanged";
    }
    case "character_scores": {
      const existing = await prisma.characterScore.findUnique({ where: { id: String(row.id) } });
      const calculatedAt = asRequiredDate(row.calculatedAt);
      if (!existing) {
        await prisma.characterScore.create({
          data: {
            ...row,
            dimensionDetails:
              row.dimensionDetails == null ? undefined : asJson(row.dimensionDetails),
            selectedRuns: asJson(row.selectedRuns),
            calculatedAt,
            createdAt: asRequiredDate(row.createdAt),
            updatedAt: asRequiredDate(row.updatedAt),
          } as never,
        });
        return "inserted";
      }
      if (existing.calculatedAt >= calculatedAt) return "unchanged";
      await prisma.characterScore.update({
        where: { id: String(row.id) },
        data: {
          ...row,
          dimensionDetails:
            row.dimensionDetails == null ? undefined : asJson(row.dimensionDetails),
          selectedRuns: asJson(row.selectedRuns),
          calculatedAt,
          updatedAt: asRequiredDate(row.updatedAt),
        } as never,
      });
      return "updated";
    }
    case "score_snapshots": {
      const existing = await prisma.scoreSnapshot.findUnique({ where: { id: String(row.id) } });
      if (!existing) {
        await prisma.scoreSnapshot.create({
          data: {
            ...row,
            explanation: asJson(row.explanation),
            calculatedAt: asRequiredDate(row.calculatedAt),
            publishedAt: asDate(row.publishedAt),
            providerDataAsOf: asDate(row.providerDataAsOf),
          } as never,
        });
        return "inserted";
      }
      if (existing.inputFingerprint !== row.inputFingerprint) {
        throw new ProviderDataImportError(
          "IMMUTABLE_CONFLICT",
          `ScoreSnapshot ${row.id} inputFingerprint conflict`,
        );
      }
      return "unchanged";
    }
    case "dimension_scores": {
      const existing = await prisma.dimensionScore.findUnique({ where: { id: String(row.id) } });
      if (!existing) {
        await prisma.dimensionScore.create({
          data: { ...row, contributors: asJson(row.contributors) } as never,
        });
        return "inserted";
      }
      return "unchanged";
    }
    case "character_published_scores": {
      const importedSnapshotId = String(row.publishedSnapshotId);
      const byId = await prisma.characterPublishedScore.findUnique({
        where: { id: String(row.id) },
      });
      const byUnique = await prisma.characterPublishedScore.findFirst({
        where: {
          characterId: String(row.characterId),
          seasonId: String(row.seasonId),
          scoreModelId: String(row.scoreModelId),
          scopeType: row.scopeType as never,
          scopeKey: row.scopeKey == null ? null : String(row.scopeKey),
        },
      });
      const existing = byId ?? byUnique;
      if (!existing) {
        await prisma.characterPublishedScore.create({ data: row as never });
        return "inserted";
      }
      if (existing.publishedSnapshotId === importedSnapshotId) return "unchanged";
      const [currentSnap, importedSnap] = await Promise.all([
        prisma.scoreSnapshot.findUnique({ where: { id: existing.publishedSnapshotId } }),
        prisma.scoreSnapshot.findUnique({ where: { id: importedSnapshotId } }),
      ]);
      if (!importedSnap) {
        throw new ProviderDataImportError(
          "MISSING_PUBLISHED_SNAPSHOT",
          `Published pointer references missing snapshot ${importedSnapshotId}`,
        );
      }
      if (currentSnap && currentSnap.calculatedAt > importedSnap.calculatedAt) {
        return "unchanged";
      }
      await prisma.characterPublishedScore.update({
        where: { id: existing.id },
        data: { publishedSnapshotId: importedSnapshotId },
      });
      return "updated";
    }
    case "character_red_flags": {
      const existing = await prisma.characterRedFlag.findUnique({ where: { id: String(row.id) } });
      if (!existing) {
        await prisma.characterRedFlag.create({
          data: {
            ...row,
            evidence: asJson(row.evidence),
            firstDetectedAt: asRequiredDate(row.firstDetectedAt),
            lastDetectedAt: asRequiredDate(row.lastDetectedAt),
          } as never,
        });
        return "inserted";
      }
      return "unchanged";
    }
    default:
      throw new ProviderDataImportError("UNKNOWN_TABLE", `No import handler for ${table}`);
  }
}

export async function importProviderDataBundle(input: {
  prisma: PrismaClient;
  dir: string;
}): Promise<{
  contentHash: string;
  skippedDuplicate: boolean;
  stats: Record<string, { inserted: number; updated: number; unchanged: number }>;
}> {
  const { manifest, corpus } = await readProviderDataBundle(input.dir);
  assertBundleIntegrity(manifest, corpus);

  const prior = await input.prisma.providerDataImport.findUnique({
    where: { contentHash: manifest.contentHash },
  });
  if (prior) {
    return { contentHash: manifest.contentHash, skippedDuplicate: true, stats: {} };
  }

  const stats: Record<string, { inserted: number; updated: number; unchanged: number }> = {};
  await input.prisma.$transaction(
    async (tx) => {
      for (const table of PROVIDER_DATA_EXPORT_TABLES) {
        const rows = corpus.tables[table] ?? [];
        stats[table] = await upsertRows(tx as unknown as PrismaClient, table, rows);
      }
      await tx.providerDataImport.create({
        data: {
          contentHash: manifest.contentHash,
          schemaVersion: manifest.schemaVersion,
          sourceEnvironment: manifest.sourceEnvironment,
          generatedAt: new Date(manifest.generatedAt),
          manifest: manifest as unknown as Prisma.InputJsonValue,
          counts: manifest.counts as unknown as Prisma.InputJsonValue,
        },
      });
    },
    { timeout: 600_000 },
  );

  return { contentHash: manifest.contentHash, skippedDuplicate: false, stats };
}
