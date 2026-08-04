import {
  Prisma,
  type CharacterRole,
  type DimensionComputation,
  type EvidenceManifest,
  type EvidenceManifestSlot,
  type PrismaClient,
  type ScoreDimension,
} from "@prisma/client";

function jsonStableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => jsonStableStringify(v)).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${jsonStableStringify(obj[k])}`).join(",")}}`;
}

function decimalOrNumberEquals(
  left: { toString(): string } | number | null | undefined,
  right: { toString(): string } | number | null | undefined,
): boolean {
  if (left == null && right == null) return true;
  if (left == null || right == null) return false;
  return Number(left.toString()) === Number(right.toString());
}

/** Logical DimensionComputation identity (excludes inputFingerprint). */
export function dimensionComputationLogicalIdentityKey(
  input: Pick<
    CreateDimensionComputationInput,
    "characterId" | "seasonId" | "manifestId" | "scoreModelId" | "dimension"
  >,
): string {
  return [
    input.characterId,
    input.seasonId,
    input.manifestId,
    input.scoreModelId,
    input.dimension,
  ].join("|");
}

export type DimensionComputationConflictReason =
  | "fingerprint_mismatch"
  | "content_mismatch"
  | "unique_constraint_without_existing_row";

/** Fail-closed conflict for the same logical dimension identity. */
export function buildDimensionComputationConflictError(input: {
  reason: DimensionComputationConflictReason;
  logicalIdentity: string;
  existingFingerprint: string | null;
  requestedFingerprint: string;
  dimension: string;
}): Error {
  return new Error(
    [
      `dimension_computation_conflict`,
      `reason=${input.reason}`,
      `dimension=${input.dimension}`,
      `logicalIdentity=${input.logicalIdentity}`,
      `existingFingerprint=${input.existingFingerprint ?? "null"}`,
      `requestedFingerprint=${input.requestedFingerprint}`,
    ].join(": "),
  );
}

function isPrismaUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002"
  );
}

/** Compare persisted DimensionComputation against an idempotent write intent. */
export function dimensionComputationContentMatches(
  existing: Pick<
    DimensionComputation,
    | "algorithmVersion"
    | "inputFingerprint"
    | "score"
    | "confidence"
    | "state"
    | "metrics"
    | "explanation"
  >,
  incoming: CreateDimensionComputationInput,
): boolean {
  if (existing.algorithmVersion !== incoming.algorithmVersion) return false;
  if (existing.inputFingerprint !== incoming.inputFingerprint) return false;
  if (existing.state !== incoming.state) return false;
  if (!decimalOrNumberEquals(existing.score, incoming.score ?? null)) return false;
  if (!decimalOrNumberEquals(existing.confidence, incoming.confidence)) return false;
  const existingMetrics = jsonStableStringify(existing.metrics ?? {});
  const incomingMetrics = jsonStableStringify(incoming.metrics ?? {});
  if (existingMetrics !== incomingMetrics) return false;
  const existingExplanation = jsonStableStringify(existing.explanation ?? {});
  const incomingExplanation = jsonStableStringify(incoming.explanation ?? {});
  return existingExplanation === incomingExplanation;
}

export interface CreateEvidenceManifestInput {
  characterId: string;
  seasonId: string;
  specializationId?: string | null;
  role: CharacterRole;
  refreshContractHash: string;
  selectorVersion: string;
  highKeyPolicyId: string;
  evidenceCutoffAt: Date;
  expectedSlotCount: number;
  selectedSlotCount: number;
  coverageState: string;
  schemaVersion: string;
  contentHash: string;
  document: Prisma.InputJsonValue;
  frozenAt: Date;
  slots: Array<{
    dungeonId: string;
    slotIndex: number;
    runId?: string | null;
    reportCode?: string | null;
    fightId?: number | null;
    reportRevision?: number | null;
    keyLevel?: number | null;
    candidateRank?: number | null;
    state: string;
    selectionReason?: string | null;
    dimensionValidity?: Prisma.InputJsonValue;
    invalidReasons?: Prisma.InputJsonValue;
    providerDataAsOf?: Date | null;
  }>;
}

export interface CreateEvidenceDatasetInput {
  manifestSlotId: string;
  datasetKey: string;
  compatibilityKey: string;
  artifactId?: string | null;
  schemaVersion: string;
  providerContractVersion: string;
  state: string;
  eventCount?: number;
  pageCount?: number;
  truncated?: boolean;
  pointsConsumed?: number | null;
  costSource?: string | null;
  payloadFingerprint?: string | null;
  fetchedAt?: Date | null;
}

export interface CreateRunFactSetInput {
  manifestSlotId: string;
  characterId: string;
  runId?: string | null;
  extractorFamily: string;
  extractorVersion: string;
  schemaVersion: string;
  inputFingerprint: string;
  facts: Prisma.InputJsonValue;
  coverage?: Prisma.InputJsonValue;
  limitations?: Prisma.InputJsonValue;
  computedAt: Date;
}

export interface CreateDimensionComputationInput {
  characterId: string;
  seasonId: string;
  manifestId: string;
  scoreModelId: string;
  dimension: ScoreDimension;
  algorithmVersion: string;
  inputFingerprint: string;
  score?: Prisma.Decimal | number | null;
  confidence: Prisma.Decimal | number;
  state: string;
  metrics?: Prisma.InputJsonValue;
  explanation?: Prisma.InputJsonValue;
  computedAt: Date;
}

export class EvidenceRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Insert a frozen evidence manifest + slots.
   * Idempotent on contentHash (returns existing row).
   * Never updates an existing frozen document.
   */
  async createFrozenManifest(
    input: CreateEvidenceManifestInput,
  ): Promise<{ manifest: EvidenceManifest; slots: EvidenceManifestSlot[]; created: boolean }> {
    const existing = await this.prisma.evidenceManifest.findUnique({
      where: { contentHash: input.contentHash },
      include: { slots: true },
    });
    if (existing) {
      return { manifest: existing, slots: existing.slots, created: false };
    }

    try {
      const manifest = await this.prisma.evidenceManifest.create({
        data: {
          characterId: input.characterId,
          seasonId: input.seasonId,
          specializationId: input.specializationId ?? null,
          role: input.role,
          refreshContractHash: input.refreshContractHash,
          selectorVersion: input.selectorVersion,
          highKeyPolicyId: input.highKeyPolicyId,
          evidenceCutoffAt: input.evidenceCutoffAt,
          expectedSlotCount: input.expectedSlotCount,
          selectedSlotCount: input.selectedSlotCount,
          coverageState: input.coverageState,
          schemaVersion: input.schemaVersion,
          contentHash: input.contentHash,
          document: input.document,
          frozenAt: input.frozenAt,
          slots: {
            create: input.slots.map((slot) => ({
              dungeonId: slot.dungeonId,
              slotIndex: slot.slotIndex,
              runId: slot.runId ?? null,
              reportCode: slot.reportCode ?? null,
              fightId: slot.fightId ?? null,
              reportRevision: slot.reportRevision ?? null,
              keyLevel: slot.keyLevel ?? null,
              candidateRank: slot.candidateRank ?? null,
              state: slot.state,
              selectionReason: slot.selectionReason ?? null,
              dimensionValidity: slot.dimensionValidity ?? {},
              invalidReasons: slot.invalidReasons ?? [],
              providerDataAsOf: slot.providerDataAsOf ?? null,
            })),
          },
        },
        include: { slots: true },
      });
      return { manifest, slots: manifest.slots, created: true };
    } catch (error) {
      // Concurrent insert of same contentHash — return winner.
      const raced = await this.prisma.evidenceManifest.findUnique({
        where: { contentHash: input.contentHash },
        include: { slots: true },
      });
      if (raced) {
        return { manifest: raced, slots: raced.slots, created: false };
      }
      throw error;
    }
  }

  async createDataset(input: CreateEvidenceDatasetInput) {
    return this.prisma.evidenceDataset.create({
      data: {
        manifestSlotId: input.manifestSlotId,
        datasetKey: input.datasetKey,
        compatibilityKey: input.compatibilityKey,
        artifactId: input.artifactId ?? null,
        schemaVersion: input.schemaVersion,
        providerContractVersion: input.providerContractVersion,
        state: input.state,
        eventCount: input.eventCount ?? 0,
        pageCount: input.pageCount ?? 0,
        truncated: input.truncated ?? false,
        pointsConsumed: input.pointsConsumed ?? null,
        costSource: input.costSource ?? null,
        payloadFingerprint: input.payloadFingerprint ?? null,
        fetchedAt: input.fetchedAt ?? null,
      },
    });
  }

  async createFactSet(input: CreateRunFactSetInput) {
    return this.prisma.runFactSet.create({
      data: {
        manifestSlotId: input.manifestSlotId,
        characterId: input.characterId,
        runId: input.runId ?? null,
        extractorFamily: input.extractorFamily,
        extractorVersion: input.extractorVersion,
        schemaVersion: input.schemaVersion,
        inputFingerprint: input.inputFingerprint,
        facts: input.facts,
        coverage: input.coverage ?? {},
        limitations: input.limitations ?? [],
        computedAt: input.computedAt,
      },
    });
  }

  /** Logical identity lookup — one typed fact family/version per slot. */
  async findFactSetByLogicalIdentity(input: {
    manifestSlotId: string;
    extractorFamily: string;
    extractorVersion: string;
  }) {
    return this.prisma.runFactSet.findFirst({
      where: {
        manifestSlotId: input.manifestSlotId,
        extractorFamily: input.extractorFamily,
        extractorVersion: input.extractorVersion,
      },
      orderBy: { computedAt: "desc" },
    });
  }

  async findDatasetByCompatibilityKey(compatibilityKey: string) {
    return this.prisma.evidenceDataset.findFirst({
      where: { compatibilityKey },
      orderBy: { createdAt: "asc" },
    });
  }

  /** All slot-owned descriptor rows sharing a logical compatibility identity. */
  async findDatasetsByCompatibilityKey(compatibilityKey: string) {
    return this.prisma.evidenceDataset.findMany({
      where: { compatibilityKey },
      orderBy: { createdAt: "asc" },
    });
  }

  async findDatasetBySlotAndKey(input: { manifestSlotId: string; datasetKey: string }) {
    return this.prisma.evidenceDataset.findUnique({
      where: {
        manifestSlotId_datasetKey: {
          manifestSlotId: input.manifestSlotId,
          datasetKey: input.datasetKey,
        },
      },
    });
  }

  async createDimensionComputation(input: CreateDimensionComputationInput) {
    return this.prisma.dimensionComputation.create({
      data: {
        characterId: input.characterId,
        seasonId: input.seasonId,
        manifestId: input.manifestId,
        scoreModelId: input.scoreModelId,
        dimension: input.dimension,
        algorithmVersion: input.algorithmVersion,
        inputFingerprint: input.inputFingerprint,
        score: input.score ?? null,
        confidence: input.confidence,
        state: input.state,
        metrics: input.metrics ?? {},
        explanation: input.explanation ?? {},
        computedAt: input.computedAt,
      },
    });
  }

  /**
   * Load fact sets for all slots of a frozen manifest (provider-free).
   */
  async listFactSetsForManifest(manifestId: string) {
    const slots = await this.prisma.evidenceManifestSlot.findMany({
      where: { manifestId },
      select: {
        id: true,
        reportCode: true,
        fightId: true,
        reportRevision: true,
        dungeonId: true,
        slotIndex: true,
        factSets: true,
        dungeon: { select: { slug: true } },
      },
    });
    return slots.flatMap((slot) =>
      slot.factSets.map((fs) => ({
        ...fs,
        manifestSlotId: slot.id,
        reportCode: slot.reportCode,
        fightId: slot.fightId,
        reportRevision: slot.reportRevision,
        dungeonSlug: slot.dungeon.slug,
        slotIndex: slot.slotIndex,
      })),
    );
  }

  /**
   * Idempotent DimensionComputation write.
   *
   * Authority is the DB unique on logical identity
   * (characterId, seasonId, manifestId, scoreModelId, dimension).
   * inputFingerprint is content integrity compared after a unique conflict.
   *
   * - First writer creates the row.
   * - Identical redelivery returns the existing row.
   * - Different fingerprint or content for the same logical identity fails closed.
   * - Concurrent writers cannot both succeed (P2002 → re-read + compare).
   */
  async createDimensionComputationIdempotent(
    input: CreateDimensionComputationInput,
  ): Promise<{
    row: Awaited<ReturnType<EvidenceRepository["createDimensionComputation"]>>;
    created: boolean;
  }> {
    const logicalIdentity = dimensionComputationLogicalIdentityKey(input);

    try {
      const row = await this.createDimensionComputation(input);
      return { row, created: true };
    } catch (error) {
      if (!isPrismaUniqueViolation(error)) {
        throw error;
      }

      const existing = await this.prisma.dimensionComputation.findUnique({
        where: {
          characterId_seasonId_manifestId_scoreModelId_dimension: {
            characterId: input.characterId,
            seasonId: input.seasonId,
            manifestId: input.manifestId,
            scoreModelId: input.scoreModelId,
            dimension: input.dimension,
          },
        },
      });

      if (!existing) {
        throw buildDimensionComputationConflictError({
          reason: "unique_constraint_without_existing_row",
          logicalIdentity,
          existingFingerprint: null,
          requestedFingerprint: input.inputFingerprint,
          dimension: input.dimension,
        });
      }

      if (existing.inputFingerprint !== input.inputFingerprint) {
        throw buildDimensionComputationConflictError({
          reason: "fingerprint_mismatch",
          logicalIdentity,
          existingFingerprint: existing.inputFingerprint,
          requestedFingerprint: input.inputFingerprint,
          dimension: input.dimension,
        });
      }

      if (!dimensionComputationContentMatches(existing, input)) {
        throw buildDimensionComputationConflictError({
          reason: "content_mismatch",
          logicalIdentity,
          existingFingerprint: existing.inputFingerprint,
          requestedFingerprint: input.inputFingerprint,
          dimension: input.dimension,
        });
      }

      return { row: existing, created: false };
    }
  }

  async upsertWclReportRevision(input: {
    reportCode: string;
    revision: number;
    visibility: string;
    archiveState?: string | null;
    startTimeMs: bigint;
    endTimeMs: bigint;
    zoneId?: number | null;
    masterDataArtifactId?: string | null;
    metadataHash: string;
    fetchedAt: Date;
  }) {
    return this.prisma.wclReportRevision.upsert({
      where: {
        reportCode_revision: {
          reportCode: input.reportCode,
          revision: input.revision,
        },
      },
      create: {
        reportCode: input.reportCode,
        revision: input.revision,
        visibility: input.visibility,
        archiveState: input.archiveState ?? null,
        startTimeMs: input.startTimeMs,
        endTimeMs: input.endTimeMs,
        zoneId: input.zoneId ?? null,
        masterDataArtifactId: input.masterDataArtifactId ?? null,
        metadataHash: input.metadataHash,
        fetchedAt: input.fetchedAt,
      },
      update: {
        visibility: input.visibility,
        archiveState: input.archiveState ?? null,
        masterDataArtifactId: input.masterDataArtifactId ?? null,
        metadataHash: input.metadataHash,
        fetchedAt: input.fetchedAt,
      },
    });
  }
}
