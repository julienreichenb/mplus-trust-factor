import type {
  CharacterRole,
  DimensionComputation,
  EvidenceManifest,
  EvidenceManifestSlot,
  Prisma,
  PrismaClient,
  ScoreDimension,
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

/** Compare persisted DimensionComputation against an idempotent write intent. */
export function dimensionComputationContentMatches(
  existing: Pick<
    DimensionComputation,
    "algorithmVersion" | "score" | "confidence" | "state" | "metrics" | "explanation"
  >,
  incoming: CreateDimensionComputationInput,
): boolean {
  if (existing.algorithmVersion !== incoming.algorithmVersion) return false;
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
   * - No existing row for (character, season, manifest, model, dimension) → create
   * - Existing with same fingerprint + identical content → return existing
   * - Existing with same fingerprint but conflicting payload → fail closed
   * - Existing with different fingerprint → fail closed (no duplicate dims)
   */
  async createDimensionComputationIdempotent(
    input: CreateDimensionComputationInput,
  ): Promise<{
    row: Awaited<ReturnType<EvidenceRepository["createDimensionComputation"]>>;
    created: boolean;
  }> {
    const existingForDimension = await this.prisma.dimensionComputation.findFirst({
      where: {
        characterId: input.characterId,
        seasonId: input.seasonId,
        manifestId: input.manifestId,
        scoreModelId: input.scoreModelId,
        dimension: input.dimension,
      },
      orderBy: { computedAt: "desc" },
    });

    if (existingForDimension) {
      if (existingForDimension.inputFingerprint !== input.inputFingerprint) {
        throw new Error(
          `dimension_computation_fingerprint_conflict: dimension=${input.dimension} existing=${existingForDimension.inputFingerprint} incoming=${input.inputFingerprint}`,
        );
      }
      if (!dimensionComputationContentMatches(existingForDimension, input)) {
        throw new Error(
          `dimension_computation_content_conflict: dimension=${input.dimension} fingerprint=${input.inputFingerprint}`,
        );
      }
      return { row: existingForDimension, created: false };
    }

    try {
      const row = await this.createDimensionComputation(input);
      return { row, created: true };
    } catch (error) {
      // Concurrent insert — re-read and compare.
      const raced = await this.prisma.dimensionComputation.findFirst({
        where: {
          characterId: input.characterId,
          seasonId: input.seasonId,
          manifestId: input.manifestId,
          scoreModelId: input.scoreModelId,
          dimension: input.dimension,
          inputFingerprint: input.inputFingerprint,
        },
      });
      if (raced && dimensionComputationContentMatches(raced, input)) {
        return { row: raced, created: false };
      }
      if (raced) {
        throw new Error(
          `dimension_computation_content_conflict: dimension=${input.dimension} fingerprint=${input.inputFingerprint}`,
        );
      }
      throw error;
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
