import {
  buildPublicFromAdmin,
  EXPLAINABILITY_V2_SCHEMA_VERSION,
  sanitizeExplainabilityJson,
  type ExplainabilityV2AvailabilityState,
  type ExplainabilityV2BatchQueueAdminDTO,
  type ExplainabilityV2ComparisonAdminDTO,
  type ExplainabilityV2DatasetAdminDTO,
  type ExplainabilityV2DimensionAdminDTO,
  type ExplainabilityV2DimensionKey,
  type ExplainabilityV2FactSetAdminDTO,
  type ExplainabilityV2ManifestMatrixCellDTO,
  type ExplainabilityV2RejectedCandidateAdminDTO,
  type ExplainabilityV2SelectedRunAdminDTO,
  type ScoreExplainabilityV2AdminDTO,
  type ScoreExplainabilityV2PublicDTO,
} from "@mplus/contracts";

const PUBLIC_DIMENSIONS: ExplainabilityV2DimensionKey[] = [
  "PERFORMANCE",
  "SURVIVAL",
  "UTILITY",
  "EXPERIENCE",
];

export interface ExplainabilityV2SlotSource {
  id?: string;
  dungeonSlug: string;
  slotIndex: 0 | 1;
  state: string;
  keyLevel: number | null;
  timed?: boolean | null;
  reportCode: string | null;
  fightId: number | null;
  reportRevision: number | null;
  candidateRank?: number | null;
  selectionReason?: string | null;
  providerDataAsOf?: Date | string | null;
}

export interface ExplainabilityV2RejectedSource {
  reportCode: string;
  fightId: number;
  reportRevision: number | null;
  dungeonSlug: string | null;
  reason: string;
  detail: string | null;
}

export interface ExplainabilityV2DatasetSource {
  datasetKey: string;
  state: string;
  pageCount: number;
  eventCount: number;
  truncated: boolean;
  pointsConsumed: number | null;
  costSource: string | null;
  schemaVersion: string;
  fetchedAt: Date | string | null;
}

export interface ExplainabilityV2FactSetSource {
  id: string;
  extractorFamily: string;
  extractorVersion: string;
  schemaVersion: string;
  inputFingerprint: string;
  computedAt: Date | string;
  coverage: unknown;
  limitations: unknown;
  facts: unknown;
}

export interface ExplainabilityV2DimensionSource {
  dimension: string;
  score: number | null;
  confidence: number;
  state: string;
  algorithmVersion: string;
  inputFingerprint: string;
  computedAt: Date | string;
  metrics: unknown;
  explanation: unknown;
}

export interface ExplainabilityV2BatchSource {
  id: string;
  finalizationStatus: string;
  expectedRunCount: number;
  terminalRunCount: number;
  successfulRunCount: number;
  unavailableRunCount: number;
  failedRunCount: number;
  createdAt: Date | string;
  updatedAt: Date | string;
  finalizedAt: Date | string | null;
  evidenceManifestId: string | null;
}

export interface ExplainabilityV2V1SnapshotSource {
  overallScore: number | null;
  grade: string | null;
  confidence: number | null;
  modelKey: string | null;
  modelVersion: number | null;
  dimensions: Array<{
    dimension: string;
    score: number | null;
    confidence: number | null;
    state: string | null;
  }>;
}

export interface BuildExplainabilityV2AdminInput {
  characterId: string;
  seasonId: string;
  seasonSlug: string;
  modelKey: string | null;
  modelVersion: number | null;
  manifestId: string;
  manifestContentHash: string;
  coverageState: string;
  expectedSlotCount: number;
  selectedSlotCount: number;
  evidenceCutoffAt: Date | string | null;
  slots: ExplainabilityV2SlotSource[];
  rejectedCandidates: ExplainabilityV2RejectedSource[];
  datasets: ExplainabilityV2DatasetSource[];
  factSets: ExplainabilityV2FactSetSource[];
  dimensions: ExplainabilityV2DimensionSource[];
  batch: ExplainabilityV2BatchSource | null;
  v1Snapshot: ExplainabilityV2V1SnapshotSource | null;
}

function iso(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  return value;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function availabilityFrom(metrics: Record<string, unknown>, score: number | null, confidence: number): ExplainabilityV2AvailabilityState {
  const raw = metrics.availabilityState;
  if (raw === "AVAILABLE" || raw === "PARTIAL" || raw === "UNAVAILABLE") return raw;
  if (score == null || confidence <= 0) return "UNAVAILABLE";
  return "AVAILABLE";
}

function factKeys(facts: unknown): string[] {
  if (!facts || typeof facts !== "object" || Array.isArray(facts)) return [];
  return Object.keys(facts as Record<string, unknown>).slice(0, 64);
}

function sanitizeProviderDetail(detail: string | null): string | null {
  if (detail == null) return null;
  const trimmed = detail.trim().slice(0, 240);
  if (/token|authorization|bearer|secret/i.test(trimmed)) return "provider_error_redacted";
  return trimmed;
}

export function buildExplainabilityV2Admin(
  input: BuildExplainabilityV2AdminInput,
): ScoreExplainabilityV2AdminDTO {
  const matrix: ExplainabilityV2ManifestMatrixCellDTO[] = input.slots
    .slice()
    .sort((a, b) => a.dungeonSlug.localeCompare(b.dungeonSlug) || a.slotIndex - b.slotIndex)
    .map((slot) => ({
      dungeonSlug: slot.dungeonSlug,
      slotIndex: slot.slotIndex,
      state: slot.state,
      keyLevel: slot.keyLevel,
      reportCode: slot.reportCode,
      fightId: slot.fightId,
      reportRevision: slot.reportRevision,
      candidateRank: slot.candidateRank ?? null,
      selectionReason: slot.selectionReason ?? null,
    }));

  const selectedRuns: ExplainabilityV2SelectedRunAdminDTO[] = input.slots.map((slot, index) => ({
    slotId: slot.id ?? `${slot.dungeonSlug}:${slot.slotIndex}:${index}`,
    dungeonSlug: slot.dungeonSlug,
    slotIndex: slot.slotIndex,
    keyLevel: slot.keyLevel,
    timed: slot.timed ?? null,
    state: slot.state,
    hasWclSource: Boolean(slot.reportCode),
    reportCode: slot.reportCode,
    fightId: slot.fightId,
    reportRevision: slot.reportRevision,
    selectionReason: slot.selectionReason ?? null,
    candidateRank: slot.candidateRank ?? null,
  }));

  const rejectedCandidates: ExplainabilityV2RejectedCandidateAdminDTO[] = input.rejectedCandidates
    .slice(0, 200)
    .map((row) => ({
      reportCode: row.reportCode,
      fightId: row.fightId,
      reportRevision: row.reportRevision,
      dungeonSlug: row.dungeonSlug,
      reason: row.reason,
      detail: sanitizeProviderDetail(row.detail),
    }));

  const datasets: ExplainabilityV2DatasetAdminDTO[] = input.datasets.slice(0, 200).map((row) => ({
    datasetKey: row.datasetKey,
    state: row.state,
    pageCount: row.pageCount,
    eventCount: row.eventCount,
    truncated: row.truncated,
    pointsConsumed: row.pointsConsumed,
    costSource: row.costSource,
    schemaVersion: row.schemaVersion,
    fetchedAt: iso(row.fetchedAt),
  }));

  const factSets: ExplainabilityV2FactSetAdminDTO[] = input.factSets.slice(0, 200).map((row) => ({
    id: row.id,
    extractorFamily: row.extractorFamily,
    extractorVersion: row.extractorVersion,
    schemaVersion: row.schemaVersion,
    inputFingerprint: row.inputFingerprint,
    computedAt: iso(row.computedAt) ?? new Date(0).toISOString(),
    coverage: sanitizeExplainabilityJson(row.coverage, { stripReportCodes: false }),
    limitations: sanitizeExplainabilityJson(row.limitations, { stripReportCodes: false }),
    factKeys: factKeys(row.facts),
  }));

  const dimensions: ExplainabilityV2DimensionAdminDTO[] = input.dimensions
    .filter((d): d is ExplainabilityV2DimensionSource & { dimension: ExplainabilityV2DimensionKey } =>
      PUBLIC_DIMENSIONS.includes(d.dimension as ExplainabilityV2DimensionKey),
    )
    .map((row) => {
      const metrics = asRecord(
        sanitizeExplainabilityJson(row.metrics, { stripReportCodes: false }),
      );
      const explanation = asRecord(
        sanitizeExplainabilityJson(row.explanation, { stripReportCodes: false }),
      );
      const score =
        row.score == null || Number.isNaN(Number(row.score)) ? null : Number(row.score);
      const confidence = Number(row.confidence);
      return {
        dimension: row.dimension,
        score,
        confidence: Number.isFinite(confidence) ? confidence : 0,
        lifecycleState: row.state,
        availabilityState: availabilityFrom(metrics, score, confidence),
        algorithmVersion: row.algorithmVersion,
        inputFingerprint: row.inputFingerprint,
        computedAt: iso(row.computedAt) ?? new Date(0).toISOString(),
        metrics,
        explanation,
      };
    });

  const batchQueue: ExplainabilityV2BatchQueueAdminDTO | null = input.batch
    ? {
        batchId: input.batch.id,
        finalizationStatus: input.batch.finalizationStatus,
        expectedRunCount: input.batch.expectedRunCount,
        terminalRunCount: input.batch.terminalRunCount,
        successfulRunCount: input.batch.successfulRunCount,
        unavailableRunCount: input.batch.unavailableRunCount,
        failedRunCount: input.batch.failedRunCount,
        createdAt: iso(input.batch.createdAt) ?? new Date(0).toISOString(),
        updatedAt: iso(input.batch.updatedAt) ?? new Date(0).toISOString(),
        finalizedAt: iso(input.batch.finalizedAt),
        evidenceManifestId: input.batch.evidenceManifestId,
      }
    : null;

  const comparison: ExplainabilityV2ComparisonAdminDTO = {
    v1: input.v1Snapshot
      ? {
          overallScore: input.v1Snapshot.overallScore,
          grade: input.v1Snapshot.grade,
          confidence: input.v1Snapshot.confidence,
          modelKey: input.v1Snapshot.modelKey,
          modelVersion: input.v1Snapshot.modelVersion,
          dimensions: input.v1Snapshot.dimensions,
        }
      : null,
    v2:
      dimensions.length > 0
        ? {
            publicationState: dimensions.some((d) => d.lifecycleState === "SHADOW")
              ? "SHADOW"
              : "UNAVAILABLE",
            dimensions: dimensions.map((d) => ({
              dimension: d.dimension,
              score: d.score,
              confidence: d.confidence,
              availabilityState: d.availabilityState,
              lifecycleState: d.lifecycleState,
            })),
          }
        : null,
  };

  const dataAsOfCandidates = input.slots
    .map((s) => iso(s.providerDataAsOf ?? null))
    .filter((v): v is string => Boolean(v))
    .sort();
  const dataAsOf = dataAsOfCandidates[dataAsOfCandidates.length - 1] ?? iso(input.evidenceCutoffAt);

  const adminWithoutPublic: Omit<ScoreExplainabilityV2AdminDTO, "publicView"> = {
    schemaVersion: EXPLAINABILITY_V2_SCHEMA_VERSION,
    characterId: input.characterId,
    seasonId: input.seasonId,
    seasonSlug: input.seasonSlug,
    modelKey: input.modelKey,
    modelVersion: input.modelVersion,
    dataAsOf,
    evidenceCutoffAt: iso(input.evidenceCutoffAt),
    manifestId: input.manifestId,
    manifestContentHash: input.manifestContentHash,
    coverageState: input.coverageState,
    expectedSlotCount: input.expectedSlotCount,
    selectedSlotCount: input.selectedSlotCount,
    matrix,
    selectedRuns,
    rejectedCandidates,
    datasets,
    factSets,
    dimensions,
    batchQueue,
    comparison,
    calibrationLinks: [
      { label: "Calibration platform", href: "/admin/calibration" },
      {
        label: "Score models",
        href: "/admin/models",
      },
    ],
  };

  return {
    ...adminWithoutPublic,
    publicView: buildPublicFromAdmin(adminWithoutPublic),
  };
}

/**
 * Public publication gate: SHADOW lifecycle never appears on public profiles.
 * Returns null when V2 is shadow-only or insufficient for public display.
 */
export function toPublicExplainabilityV2(
  admin: ScoreExplainabilityV2AdminDTO,
  options: { allowShadowPublic?: boolean } = {},
): ScoreExplainabilityV2PublicDTO | null {
  const pub = admin.publicView;
  if (pub.coverage.publicationState === "SHADOW" && !options.allowShadowPublic) {
    return null;
  }
  if (pub.coverage.publicationState === "UNAVAILABLE" && admin.dimensions.length === 0) {
    return null;
  }
  return pub;
}
