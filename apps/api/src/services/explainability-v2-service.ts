import type {
  ExplainabilityV2ManifestListDTO,
  ScoreExplainabilityV2AdminDTO,
  ScoreExplainabilityV2PublicDTO,
} from "@mplus/contracts";
import { characterSeasonEvidenceManifestV2Schema } from "@mplus/contracts";
import {
  buildExplainabilityV2Admin,
  toPublicExplainabilityV2,
} from "@mplus/scoring";
import type { ApiContainer } from "../container.js";
import { HttpError } from "../errors.js";

const DEFAULT_LIST_LIMIT = 20;
const MAX_LIST_LIMIT = 50;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function decimalToNumber(value: { toString(): string } | number | null | undefined): number | null {
  if (value == null) return null;
  const n = Number(value.toString());
  return Number.isFinite(n) ? n : null;
}

type ManifestListRow = {
  id: string;
  characterId: string;
  seasonId: string;
  coverageState: string;
  contentHash: string;
  expectedSlotCount: number;
  selectedSlotCount: number;
  frozenAt: Date;
  createdAt: Date;
  season: { slug: string } | null;
};

type ManifestSlotRow = {
  id: string;
  dungeonId: string;
  slotIndex: number;
  state: string;
  keyLevel: number | null;
  reportCode: string | null;
  fightId: number | null;
  reportRevision: number | null;
  candidateRank: number | null;
  selectionReason: string | null;
  providerDataAsOf: Date | null;
  dungeon: { slug: string };
  datasets: Array<{
    datasetKey: string;
    state: string;
    pageCount: number;
    eventCount: number;
    truncated: boolean;
    pointsConsumed: number | null;
    costSource: string | null;
    schemaVersion: string;
    fetchedAt: Date | null;
  }>;
  factSets: Array<{
    id: string;
    extractorFamily: string;
    extractorVersion: string;
    schemaVersion: string;
    inputFingerprint: string;
    computedAt: Date;
    coverage: unknown;
    limitations: unknown;
    facts: unknown;
  }>;
};

type DimensionRow = {
  dimension: string;
  score: { toString(): string } | number | null;
  confidence: { toString(): string } | number;
  state: string;
  algorithmVersion: string;
  inputFingerprint: string;
  computedAt: Date;
  metrics: unknown;
  explanation: unknown;
  scoreModelId: string;
};

type DimensionScoreRow = {
  dimension: string;
  score: { toString(): string } | number | null;
  confidence: { toString(): string } | number;
  state: string;
};

export class ExplainabilityV2Service {
  constructor(private readonly container: ApiContainer) {}

  private get prisma() {
    return this.container.worker.prisma;
  }

  async listManifests(input: {
    characterId?: string;
    seasonId?: string;
    cursor?: string;
    limit?: number;
  }): Promise<ExplainabilityV2ManifestListDTO> {
    const limit = Math.min(Math.max(input.limit ?? DEFAULT_LIST_LIMIT, 1), MAX_LIST_LIMIT);
    const rows = (await this.prisma.evidenceManifest.findMany({
      where: {
        ...(input.characterId ? { characterId: input.characterId } : {}),
        ...(input.seasonId ? { seasonId: input.seasonId } : {}),
        ...(input.cursor ? { frozenAt: { lt: new Date(input.cursor) } } : {}),
      },
      orderBy: [{ frozenAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      include: {
        season: { select: { slug: true } },
      },
    })) as ManifestListRow[];

    const page = rows.slice(0, limit);
    const next = rows.length > limit ? page[page.length - 1] : null;
    return {
      items: page.map((row: ManifestListRow) => ({
        manifestId: row.id,
        characterId: row.characterId,
        seasonId: row.seasonId,
        seasonSlug: row.season?.slug ?? null,
        coverageState: row.coverageState,
        contentHash: row.contentHash,
        expectedSlotCount: row.expectedSlotCount,
        selectedSlotCount: row.selectedSlotCount,
        frozenAt: row.frozenAt.toISOString(),
        createdAt: row.createdAt.toISOString(),
      })),
      nextCursor: next ? next.frozenAt.toISOString() : null,
      limit,
    };
  }

  async getAdminDiagnostics(input: {
    characterId: string;
    seasonId?: string;
    manifestId?: string;
  }): Promise<ScoreExplainabilityV2AdminDTO> {
    const manifest = await this.loadManifest(input);
    if (!manifest) {
      throw HttpError.notFound("EVIDENCE_MANIFEST_NOT_FOUND", "No Scoring V2 evidence manifest found");
    }

    const [dimensionsRaw, batch, v1Snapshot] = await Promise.all([
      this.prisma.dimensionComputation.findMany({
        where: {
          characterId: manifest.characterId,
          seasonId: manifest.seasonId,
          manifestId: manifest.id,
        },
        orderBy: { dimension: "asc" },
      }),
      this.prisma.scoreAnalysisBatch.findFirst({
        where: {
          characterId: manifest.characterId,
          seasonId: manifest.seasonId,
          OR: [{ evidenceManifestId: manifest.id }, { evidenceManifestId: null }],
        },
        orderBy: { updatedAt: "desc" },
      }),
      this.prisma.scoreSnapshot.findFirst({
        where: {
          characterId: manifest.characterId,
          seasonId: manifest.seasonId,
          isPublic: true,
        },
        orderBy: { calculatedAt: "desc" },
        include: {
          scoreModel: true,
          dimensionScores: true,
        },
      }),
    ]);
    const dimensions = dimensionsRaw as DimensionRow[];
    const scoreModel = await dimensionsModelLookup(
      this.prisma,
      dimensionsScoreModelId(dimensions),
    );

    const documentRejected = readRejectedFromDocument(manifest.document);
    const dungeonSlugById = new Map(
      manifest.slots.map((slot: ManifestSlotRow) => [slot.dungeonId, slot.dungeon.slug] as const),
    );

    const datasets = manifest.slots.flatMap((slot: ManifestSlotRow) =>
      slot.datasets.map((ds) => ({
        datasetKey: ds.datasetKey,
        state: ds.state,
        pageCount: ds.pageCount,
        eventCount: ds.eventCount,
        truncated: ds.truncated,
        pointsConsumed: ds.pointsConsumed,
        costSource: ds.costSource,
        schemaVersion: ds.schemaVersion,
        fetchedAt: ds.fetchedAt,
      })),
    );

    const factSets = manifest.slots.flatMap((slot: ManifestSlotRow) =>
      slot.factSets.map((fs) => ({
        id: fs.id,
        extractorFamily: fs.extractorFamily,
        extractorVersion: fs.extractorVersion,
        schemaVersion: fs.schemaVersion,
        inputFingerprint: fs.inputFingerprint,
        computedAt: fs.computedAt,
        coverage: fs.coverage,
        limitations: fs.limitations,
        facts: fs.facts,
      })),
    );

    const modelKey = scoreModel?.key ?? v1Snapshot?.scoreModel.key ?? null;
    const modelVersion = scoreModel?.version ?? v1Snapshot?.scoreModel.version ?? null;

    return buildExplainabilityV2Admin({
      characterId: manifest.characterId,
      seasonId: manifest.seasonId,
      seasonSlug: manifest.season.slug,
      modelKey,
      modelVersion,
      manifestId: manifest.id,
      manifestContentHash: manifest.contentHash,
      coverageState: manifest.coverageState,
      expectedSlotCount: manifest.expectedSlotCount,
      selectedSlotCount: manifest.selectedSlotCount,
      evidenceCutoffAt: manifest.evidenceCutoffAt,
      slots: manifest.slots.map((slot: ManifestSlotRow) => ({
        id: slot.id,
        dungeonSlug: dungeonSlugById.get(slot.dungeonId) ?? slot.dungeon.slug,
        slotIndex: (slot.slotIndex === 1 ? 1 : 0) as 0 | 1,
        state: slot.state,
        keyLevel: slot.keyLevel,
        timed: null,
        reportCode: slot.reportCode,
        fightId: slot.fightId,
        reportRevision: slot.reportRevision,
        candidateRank: slot.candidateRank,
        selectionReason: slot.selectionReason,
        providerDataAsOf: slot.providerDataAsOf,
      })),
      rejectedCandidates: documentRejected,
      datasets,
      factSets,
      dimensions: dimensions.map((row: DimensionRow) => ({
        dimension: row.dimension,
        score: decimalToNumber(row.score),
        confidence: Number(row.confidence.toString()),
        state: row.state,
        algorithmVersion: row.algorithmVersion,
        inputFingerprint: row.inputFingerprint,
        computedAt: row.computedAt,
        metrics: row.metrics,
        explanation: row.explanation,
      })),
      batch: batch
        ? {
            id: batch.id,
            finalizationStatus: batch.finalizationStatus,
            expectedRunCount: batch.expectedRunCount,
            terminalRunCount: batch.terminalRunCount,
            successfulRunCount: batch.successfulRunCount,
            unavailableRunCount: batch.unavailableRunCount,
            failedRunCount: batch.failedRunCount,
            createdAt: batch.createdAt,
            updatedAt: batch.updatedAt,
            finalizedAt: batch.finalizedAt,
            evidenceManifestId: batch.evidenceManifestId,
          }
        : null,
      v1Snapshot: v1Snapshot
        ? {
            overallScore: decimalToNumber(v1Snapshot.overallScore),
            grade: v1Snapshot.grade,
            confidence: decimalToNumber(v1Snapshot.confidence),
            modelKey: v1Snapshot.scoreModel.key,
            modelVersion: v1Snapshot.scoreModel.version,
            dimensions: (v1Snapshot.dimensionScores as DimensionScoreRow[]).map(
              (d: DimensionScoreRow) => ({
                dimension: d.dimension,
                score: decimalToNumber(d.score),
                confidence: decimalToNumber(d.confidence),
                state: d.state,
              }),
            ),
          }
        : null,
    });
  }

  /**
   * Public explainability — never returns SHADOW/unpublished V2 payloads.
   * Pure DB read; no provider calls.
   */
  async getPublicExplainability(input: {
    characterId: string;
    seasonId?: string;
  }): Promise<ScoreExplainabilityV2PublicDTO | null> {
    const manifest = await this.loadManifest(input);
    if (!manifest) return null;
    try {
      const admin = await this.getAdminDiagnostics({
        characterId: input.characterId,
        seasonId: input.seasonId,
        manifestId: manifest.id,
      });
      return toPublicExplainabilityV2(admin);
    } catch {
      return null;
    }
  }

  private async loadManifest(input: {
    characterId: string;
    seasonId?: string;
    manifestId?: string;
  }): Promise<{
    id: string;
    characterId: string;
    seasonId: string;
    contentHash: string;
    coverageState: string;
    expectedSlotCount: number;
    selectedSlotCount: number;
    evidenceCutoffAt: Date;
    document: unknown;
    season: { slug: string };
    slots: ManifestSlotRow[];
  } | null> {
    if (input.manifestId) {
      const byId = await this.prisma.evidenceManifest.findFirst({
        where: {
          id: input.manifestId,
          characterId: input.characterId,
          ...(input.seasonId ? { seasonId: input.seasonId } : {}),
        },
        include: manifestInclude,
      });
      return byId as Awaited<ReturnType<ExplainabilityV2Service["loadManifest"]>>;
    }

    const latest = await this.prisma.evidenceManifest.findFirst({
      where: {
        characterId: input.characterId,
        ...(input.seasonId ? { seasonId: input.seasonId } : {}),
      },
      orderBy: { frozenAt: "desc" },
      include: manifestInclude,
    });
    return latest as Awaited<ReturnType<ExplainabilityV2Service["loadManifest"]>>;
  }
}

const manifestInclude = {
  season: true,
  slots: {
    include: {
      dungeon: true,
      datasets: true,
      factSets: true,
    },
    orderBy: [{ dungeonId: "asc" as const }, { slotIndex: "asc" as const }],
  },
};

function readRejectedFromDocument(document: unknown) {
  if (!isRecord(document)) return [];
  const parsed = characterSeasonEvidenceManifestV2Schema.safeParse(document);
  const rejected = parsed.success
    ? parsed.data.rejectedCandidates
    : Array.isArray(document.rejectedCandidates)
      ? document.rejectedCandidates
      : [];
  return rejected
    .filter(isRecord)
    .map((row) => ({
      reportCode: typeof row.reportCode === "string" ? row.reportCode : "unknown",
      fightId: typeof row.fightId === "number" ? row.fightId : 0,
      reportRevision: typeof row.reportRevision === "number" ? row.reportRevision : null,
      dungeonSlug: typeof row.dungeonSlug === "string" ? row.dungeonSlug : null,
      reason: typeof row.reason === "string" ? row.reason : "UNKNOWN",
      detail: typeof row.detail === "string" ? row.detail : null,
    }))
    .filter((row) => row.reportCode !== "unknown");
}

function dimensionsScoreModelId(dimensions: Array<{ scoreModelId: string }>): string | null {
  return dimensions[0]?.scoreModelId ?? null;
}

async function dimensionsModelLookup(
  prisma: ApiContainer["worker"]["prisma"],
  scoreModelId: string | null,
) {
  if (!scoreModelId) return null;
  return prisma.scoreModel.findUnique({ where: { id: scoreModelId } });
}
