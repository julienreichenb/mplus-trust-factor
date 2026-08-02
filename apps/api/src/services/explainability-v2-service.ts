import type {
  ExplainabilityV2AvailabilityState,
  ExplainabilityV2DimensionKey,
  ExplainabilityV2ManifestListDTO,
  ScoreExplainabilityV2AdminDTO,
  ScoreExplainabilityV2PublicDTO,
} from "@mplus/contracts";
import {
  buildExplainabilityV2Public,
  characterSeasonEvidenceManifestV2Schema,
  derivePublicationState,
  isPubliclyEmittablePublicationState,
} from "@mplus/contracts";
import { buildExplainabilityV2Admin } from "@mplus/scoring";
import type { ApiContainer } from "../container.js";
import { HttpError } from "../errors.js";

const DEFAULT_LIST_LIMIT = 20;
const MAX_LIST_LIMIT = 50;

const PUBLIC_DIMENSIONS: ExplainabilityV2DimensionKey[] = [
  "PERFORMANCE",
  "SURVIVAL",
  "UTILITY",
  "EXPERIENCE",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function decimalToNumber(value: { toString(): string } | number | null | undefined): number | null {
  if (value == null) return null;
  const n = Number(value.toString());
  return Number.isFinite(n) ? n : null;
}

function parseIsoCursor(cursor: string | undefined): Date | undefined {
  if (cursor == null || cursor.trim() === "") return undefined;
  const ms = Date.parse(cursor);
  if (!Number.isFinite(ms)) {
    throw HttpError.badRequest("INVALID_CURSOR", "cursor must be a valid ISO-8601 timestamp");
  }
  return new Date(ms);
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

type PublicDimensionProjection = {
  dimension: string;
  score: { toString(): string } | number | null;
  confidence: { toString(): string } | number;
  state: string;
  algorithmVersion: string;
  metrics: unknown;
  explanation: unknown;
  scoreModelId: string;
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
    const cursorDate = parseIsoCursor(input.cursor);
    const rows = (await this.prisma.evidenceManifest.findMany({
      where: {
        ...(input.characterId ? { characterId: input.characterId } : {}),
        ...(input.seasonId ? { seasonId: input.seasonId } : {}),
        ...(cursorDate ? { frozenAt: { lt: cursorDate } } : {}),
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
    const manifest = await this.loadManifestForAdmin(input);
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

    // Admin fact-set metadata only — never select/return raw facts JSON.
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
        factKeys: [],
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
   * Public explainability — minimal projection, fail-closed publication gate.
   * Never calls getAdminDiagnostics, never loads factSets/facts/artifacts,
   * never triggers providers/refresh/queues.
   */
  async getPublicExplainability(input: {
    characterId: string;
    seasonId?: string;
  }): Promise<ScoreExplainabilityV2PublicDTO | null> {
    return this.getPublicExplainabilityFromPublishedComputations(input);
  }

  async getPublicExplainabilityFromPublishedComputations(input: {
    characterId: string;
    seasonId?: string;
  }): Promise<ScoreExplainabilityV2PublicDTO | null> {
    const eligibility = await this.prisma.evidenceManifest.findFirst({
      where: {
        characterId: input.characterId,
        ...(input.seasonId ? { seasonId: input.seasonId } : {}),
      },
      orderBy: { frozenAt: "desc" },
      select: {
        id: true,
        coverageState: true,
        expectedSlotCount: true,
        selectedSlotCount: true,
        evidenceCutoffAt: true,
        season: { select: { slug: true } },
        dimensionComputations: {
          select: { state: true, dimension: true },
        },
      },
    });

    if (!eligibility) return null;

    const lifecycleStates = eligibility.dimensionComputations.map((d) => d.state);
    const publicationState = derivePublicationState({
      coverageState: eligibility.coverageState,
      dimensions: [],
      lifecycleStates,
    });
    if (!isPubliclyEmittablePublicationState(publicationState)) {
      return null;
    }

    const [slots, dimensions] = await Promise.all([
      this.prisma.evidenceManifestSlot.findMany({
        where: { manifestId: eligibility.id },
        select: {
          dungeon: { select: { slug: true } },
          slotIndex: true,
          state: true,
          keyLevel: true,
          reportCode: true,
          providerDataAsOf: true,
        },
        orderBy: [{ dungeonId: "asc" }, { slotIndex: "asc" }],
      }),
      this.prisma.dimensionComputation.findMany({
        where: { manifestId: eligibility.id },
        select: {
          dimension: true,
          score: true,
          confidence: true,
          state: true,
          algorithmVersion: true,
          metrics: true,
          explanation: true,
          scoreModelId: true,
        },
        orderBy: { dimension: "asc" },
      }),
    ]);

    const publicDims = dimensions as PublicDimensionProjection[];
    const modelId = publicDims[0]?.scoreModelId ?? null;
    const model =
      modelId == null
        ? null
        : await this.prisma.scoreModel.findUnique({
            where: { id: modelId },
            select: { key: true, version: true },
          });

    const slotRows = slots as Array<{
      dungeon: { slug: string };
      slotIndex: number;
      state: string;
      keyLevel: number | null;
      reportCode: string | null;
      providerDataAsOf: Date | null;
    }>;

    const dataAsOfCandidates = slotRows
      .map((s) => s.providerDataAsOf?.toISOString() ?? null)
      .filter((v): v is string => Boolean(v))
      .sort();
    const dataAsOf =
      dataAsOfCandidates[dataAsOfCandidates.length - 1] ??
      eligibility.evidenceCutoffAt.toISOString();

    return buildExplainabilityV2Public({
      modelKey: model?.key ?? null,
      modelVersion: model?.version ?? null,
      dataAsOf,
      evidenceCutoffAt: eligibility.evidenceCutoffAt.toISOString(),
      coverageState: eligibility.coverageState,
      expectedSlotCount: eligibility.expectedSlotCount,
      selectedSlotCount: eligibility.selectedSlotCount,
      lifecycleStates: publicDims.map((d) => d.state),
      selectedRuns: slotRows.map((slot) => ({
        dungeonSlug: slot.dungeon.slug,
        slotIndex: (slot.slotIndex === 1 ? 1 : 0) as 0 | 1,
        keyLevel: slot.keyLevel,
        timed: null,
        state: slot.state,
        hasWclSource: Boolean(slot.reportCode),
      })),
      dimensions: publicDims
        .filter((d): d is PublicDimensionProjection & { dimension: ExplainabilityV2DimensionKey } =>
          PUBLIC_DIMENSIONS.includes(d.dimension as ExplainabilityV2DimensionKey),
        )
        .map((row) => {
          const metrics = isRecord(row.metrics) ? row.metrics : {};
          const explanation = isRecord(row.explanation) ? row.explanation : {};
          const availability = availabilityFromMetrics(
            metrics,
            decimalToNumber(row.score),
            Number(row.confidence),
          );
          const topContributors = Array.isArray(explanation.topContributors)
            ? explanation.topContributors
            : Array.isArray(metrics.topContributors)
              ? metrics.topContributors
              : Array.isArray(metrics.domainBreakdowns)
                ? (metrics.domainBreakdowns as unknown[])
                    .map((raw) => {
                      if (!isRecord(raw) || typeof raw.domain !== "string") return null;
                      return {
                        key: `utility.${raw.domain}`,
                        label: String(raw.domain),
                        score: typeof raw.score === "number" ? raw.score : null,
                      };
                    })
                    .filter(Boolean)
                : [];
          return {
            dimension: row.dimension,
            score: decimalToNumber(row.score),
            confidence: Number(row.confidence.toString()),
            availabilityState: availability,
            algorithmVersion: row.algorithmVersion,
            topContributors: topContributors
              .filter(isRecord)
              .map((c) => {
                const direction =
                  c.direction === "positive" ||
                  c.direction === "negative" ||
                  c.direction === "neutral"
                    ? (c.direction as "positive" | "negative" | "neutral")
                    : undefined;
                return {
                  key:
                    typeof c.key === "string"
                      ? c.key
                      : typeof c.metricKey === "string"
                        ? c.metricKey
                        : "unknown",
                  label: typeof c.label === "string" ? c.label : undefined,
                  score:
                    typeof c.score === "number"
                      ? c.score
                      : typeof c.value === "number"
                        ? c.value
                        : null,
                  direction,
                };
              })
              .filter((c) => c.key !== "unknown"),
            utilityNotes:
              row.dimension === "UTILITY" && Array.isArray(explanation.notes)
                ? explanation.notes.filter((n): n is string => typeof n === "string")
                : undefined,
          };
        }),
    });
  }

  private async loadManifestForAdmin(input: {
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
    const include = {
      season: true,
      slots: {
        include: {
          dungeon: true,
          datasets: {
            select: {
              datasetKey: true,
              state: true,
              pageCount: true,
              eventCount: true,
              truncated: true,
              pointsConsumed: true,
              costSource: true,
              schemaVersion: true,
              fetchedAt: true,
            },
          },
          factSets: {
            select: {
              id: true,
              extractorFamily: true,
              extractorVersion: true,
              schemaVersion: true,
              inputFingerprint: true,
              computedAt: true,
              coverage: true,
              limitations: true,
              // intentionally omit facts
            },
          },
        },
        orderBy: [{ dungeonId: "asc" as const }, { slotIndex: "asc" as const }],
      },
    };

    if (input.manifestId) {
      const byId = await this.prisma.evidenceManifest.findFirst({
        where: {
          id: input.manifestId,
          characterId: input.characterId,
          ...(input.seasonId ? { seasonId: input.seasonId } : {}),
        },
        include,
      });
      return byId as Awaited<ReturnType<ExplainabilityV2Service["loadManifestForAdmin"]>>;
    }

    const latest = await this.prisma.evidenceManifest.findFirst({
      where: {
        characterId: input.characterId,
        ...(input.seasonId ? { seasonId: input.seasonId } : {}),
      },
      orderBy: { frozenAt: "desc" },
      include,
    });
    return latest as Awaited<ReturnType<ExplainabilityV2Service["loadManifestForAdmin"]>>;
  }
}

function availabilityFromMetrics(
  metrics: Record<string, unknown>,
  score: number | null,
  confidence: number,
): ExplainabilityV2AvailabilityState {
  const raw = metrics.availabilityState;
  if (raw === "AVAILABLE" || raw === "PARTIAL" || raw === "UNAVAILABLE") return raw;
  if (score == null || confidence <= 0) return "UNAVAILABLE";
  return "AVAILABLE";
}

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
