import type { DimensionScore, Prisma, PrismaClient, ScoreModel, ScoreSnapshot, Season } from "@mplus/database";
import type { ScoreModelConfig, ScoreScope, ScoreSnapshotDTO } from "@mplus/contracts";
import type { CoherenceValidationResult } from "@mplus/scoring";

/** Read shape used by API mappers: adds the relations needed to build a full `ScoreSnapshotDTO`. */
export type ScoreSnapshotWithRelations = ScoreSnapshot & {
  dimensionScores: DimensionScore[];
  scoreModel: ScoreModel;
  season: Season;
};

const WEIGHT_SUM_EPSILON = 0.01;

export function validateConfig(config: ScoreModelConfig): string[] {
  const errors: string[] = [];
  const weightSum = Object.values(config.weights).reduce((sum, value) => sum + value, 0);
  if (Math.abs(weightSum - 1) > WEIGHT_SUM_EPSILON) {
    errors.push(`weights must sum to ~1 (got ${weightSum.toFixed(4)})`);
  }

  const blendSum = config.authenticityBlend.skillWeight + config.authenticityBlend.authenticityWeight;
  if (Math.abs(blendSum - 1) > WEIGHT_SUM_EPSILON) {
    errors.push(`authenticityBlend weights must sum to ~1 (got ${blendSum.toFixed(4)})`);
  }

  const { S, A, B, C } = config.gradeThresholds;
  if (!(S >= A && A >= B && B >= C)) {
    errors.push("gradeThresholds must be non-increasing: S >= A >= B >= C");
  }

  return errors;
}

export interface CreateDraftModelInput {
  key: string;
  name: string;
  description?: string;
  config: ScoreModelConfig;
  createdByUserId?: string | null;
}

export interface SaveScoreSnapshotInput {
  characterId: string;
  seasonId: string;
  scoreModelId: string;
  scopeType: ScoreScope;
  scopeKey: string | null;
  snapshot: ScoreSnapshotDTO;
  /** When true, atomically supersede prior public snapshots. */
  publish?: boolean;
  analysisBatchId?: string | null;
  refreshContractHash?: string | null;
  providerDataAsOf?: Date | null;
  coverageState?: string | null;
}

export interface PublishCandidateInput {
  characterId: string;
  seasonId: string;
  scoreModelId: string;
  scopeType: ScoreScope;
  scopeKey: string | null;
  snapshot: ScoreSnapshotDTO;
  analysisBatchId?: string | null;
  refreshContractHash: string;
  providerDataAsOf?: Date | null;
  coverageState: string;
  coherence: CoherenceValidationResult;
}

export interface RejectCandidateInput {
  characterId: string;
  seasonId: string;
  scoreModelId: string;
  scopeType: ScoreScope;
  scopeKey: string | null;
  snapshot: ScoreSnapshotDTO;
  analysisBatchId?: string | null;
  refreshContractHash: string;
  rejectionReason: string;
  coherence: CoherenceValidationResult;
}

export interface ScoreRepository {
  getActiveModel(key?: string): Promise<ScoreModel | null>;
  getModelById(id: string): Promise<ScoreModel | null>;
  getModelByKeyVersion(key: string, version: number): Promise<ScoreModel | null>;
  createDraftModel(input: CreateDraftModelInput): Promise<ScoreModel>;
  updateDraftConfig(id: string, config: ScoreModelConfig): Promise<ScoreModel>;
  validateConfig(config: ScoreModelConfig): string[];
  activateModel(id: string): Promise<ScoreModel>;
  saveScoreSnapshot(input: SaveScoreSnapshotInput): Promise<ScoreSnapshot>;
  /** Save as CANDIDATE without publishing. */
  saveCandidateSnapshot(input: SaveScoreSnapshotInput): Promise<ScoreSnapshot>;
  /** Validate coherence and atomically publish or reject. */
  publishOrRejectCandidate(input: PublishCandidateInput): Promise<{
    published: boolean;
    snapshot: ScoreSnapshot;
    rejectionReason?: string;
  }>;
  listPublicModels(): Promise<ScoreModel[]>;
  listAllModels(): Promise<ScoreModel[]>;
  getLatestSnapshot(characterId: string): Promise<ScoreSnapshotWithRelations | null>;
  getPublishedSnapshot(
    characterId: string,
    seasonId?: string,
    scoreModelId?: string,
  ): Promise<ScoreSnapshotWithRelations | null>;
  listHistory(characterId: string, limit?: number): Promise<ScoreSnapshotWithRelations[]>;
}

function snapshotData(
  snapshot: ScoreSnapshotDTO,
  opts: {
    publicationStatus: "CANDIDATE" | "PUBLIC" | "PUBLISHED" | "REJECTED_INCOMPLETE";
    isPublic: boolean;
    analysisBatchId?: string | null;
    refreshContractHash?: string | null;
    providerDataAsOf?: Date | null;
    coverageState?: string | null;
    rejectionReason?: string | null;
    publishedAt?: Date | null;
  },
) {
  return {
    overallScore: snapshot.overallScore,
    grade: snapshot.grade,
    skillScore: snapshot.skillScore,
    authenticityScore: snapshot.authenticityScore,
    confidence: snapshot.confidence,
    calculatedAt: new Date(snapshot.calculatedAt),
    explanation: {
      ...(typeof snapshot.explanation === "object" && snapshot.explanation !== null
        ? (snapshot.explanation as Record<string, unknown>)
        : {}),
      redFlags: snapshot.redFlags,
    } as object,
    publicationStatus: opts.publicationStatus,
    isPublic: opts.isPublic,
    analysisBatchId: opts.analysisBatchId ?? null,
    refreshContractHash: opts.refreshContractHash ?? null,
    providerDataAsOf: opts.providerDataAsOf ?? null,
    coverageState: opts.coverageState ?? null,
    rejectionReason: opts.rejectionReason ?? null,
    publishedAt: opts.publishedAt ?? null,
  };
}

async function upsertDimensionScores(
  tx: Prisma.TransactionClient,
  scoreSnapshotId: string,
  snapshot: ScoreSnapshotDTO,
): Promise<void> {
  for (const dimension of snapshot.dimensions) {
    await tx.dimensionScore.upsert({
      where: {
        scoreSnapshotId_dimension: {
          scoreSnapshotId,
          dimension: dimension.dimension,
        },
      },
      update: {
        score: dimension.score,
        confidence: dimension.confidence,
        weight: dimension.weight,
        state: dimension.state ?? "AVAILABLE",
        reason: dimension.reason ?? null,
        contributors: (dimension.contributors ?? []) as object,
      },
      create: {
        scoreSnapshotId,
        dimension: dimension.dimension,
        score: dimension.score,
        confidence: dimension.confidence,
        weight: dimension.weight,
        state: dimension.state ?? "AVAILABLE",
        reason: dimension.reason ?? null,
        contributors: (dimension.contributors ?? []) as object,
      },
    });
  }
}

async function upsertPublishedPointer(
  tx: Prisma.TransactionClient,
  input: {
    characterId: string;
    seasonId: string;
    scoreModelId: string;
    scopeType: ScoreScope;
    scopeKey: string | null;
    publishedSnapshotId: string;
  },
): Promise<void> {
  try {
    await tx.characterPublishedScore.upsert({
      where: {
        characterId_seasonId_scoreModelId_scopeType_scopeKey: {
          characterId: input.characterId,
          seasonId: input.seasonId,
          scoreModelId: input.scoreModelId,
          scopeType: input.scopeType,
          scopeKey: input.scopeKey,
        },
      },
      update: { publishedSnapshotId: input.publishedSnapshotId },
      create: {
        characterId: input.characterId,
        seasonId: input.seasonId,
        scoreModelId: input.scoreModelId,
        scopeType: input.scopeType,
        scopeKey: input.scopeKey,
        publishedSnapshotId: input.publishedSnapshotId,
      },
    });
  } catch {
    // Pointer table not migrated yet — publication still works via isPublic.
  }
}

export function createScoreRepository(prisma: PrismaClient): ScoreRepository {
  return {
    async getActiveModel(key = "default") {
      return prisma.scoreModel.findFirst({
        where: { key, status: "ACTIVE" },
        orderBy: { version: "desc" },
      });
    },

    async getModelById(id) {
      return prisma.scoreModel.findUnique({ where: { id } });
    },

    async getModelByKeyVersion(key, version) {
      return prisma.scoreModel.findUnique({ where: { key_version: { key, version } } });
    },

    async createDraftModel(input) {
      const errors = validateConfig(input.config);
      if (errors.length > 0) {
        throw new Error(`Invalid score model config: ${errors.join("; ")}`);
      }
      const latest = await prisma.scoreModel.findFirst({
        where: { key: input.key },
        orderBy: { version: "desc" },
      });
      const version = (latest?.version ?? 0) + 1;
      return prisma.scoreModel.create({
        data: {
          key: input.key,
          version,
          name: input.name,
          description: input.description ?? "",
          status: "DRAFT",
          config: input.config as object,
          createdByUserId: input.createdByUserId ?? null,
        },
      });
    },

    async updateDraftConfig(id, config) {
      const errors = validateConfig(config);
      if (errors.length > 0) {
        throw new Error(`Invalid score model config: ${errors.join("; ")}`);
      }
      const existing = await prisma.scoreModel.findUnique({ where: { id } });
      if (!existing) {
        throw new Error(`Score model ${id} not found`);
      }
      if (existing.status !== "DRAFT") {
        throw new Error(`Only DRAFT models can be updated (got ${existing.status})`);
      }
      return prisma.scoreModel.update({
        where: { id },
        data: { config: config as object },
      });
    },

    validateConfig,

    async activateModel(id) {
      return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const target = await tx.scoreModel.findUniqueOrThrow({ where: { id } });
        await tx.scoreModel.updateMany({
          where: { key: target.key, status: "ACTIVE", id: { not: id } },
          data: { status: "ARCHIVED" },
        });
        return tx.scoreModel.update({
          where: { id },
          data: { status: "ACTIVE", activatedAt: new Date() },
        });
      });
    },

    async saveCandidateSnapshot(input) {
      return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const existing = await tx.scoreSnapshot.findFirst({
          where: {
            characterId: input.characterId,
            seasonId: input.seasonId,
            scoreModelId: input.scoreModelId,
            scopeType: input.scopeType,
            scopeKey: input.scopeKey,
            inputFingerprint: input.snapshot.inputFingerprint,
          },
        });

        const data = snapshotData(input.snapshot, {
          publicationStatus: "CANDIDATE",
          isPublic: false,
          analysisBatchId: input.analysisBatchId,
          refreshContractHash: input.refreshContractHash,
          providerDataAsOf: input.providerDataAsOf,
          coverageState: input.coverageState,
        });

        const scoreSnapshot = existing
          ? await tx.scoreSnapshot.update({ where: { id: existing.id }, data })
          : await tx.scoreSnapshot.create({
              data: {
                characterId: input.characterId,
                seasonId: input.seasonId,
                scoreModelId: input.scoreModelId,
                scopeType: input.scopeType,
                scopeKey: input.scopeKey,
                inputFingerprint: input.snapshot.inputFingerprint,
                ...data,
              },
            });

        await upsertDimensionScores(tx, scoreSnapshot.id, input.snapshot);
        return scoreSnapshot;
      });
    },

    async publishOrRejectCandidate(input) {
      const now = new Date();
      if (!input.coherence.ok) {
        const rejected = await this.saveCandidateSnapshot({
          ...input,
          snapshot: input.snapshot,
          publish: false,
        });
        await prisma.scoreSnapshot.update({
          where: { id: rejected.id },
          data: {
            publicationStatus: "REJECTED_INCOMPLETE",
            isPublic: false,
            rejectionReason: input.coherence.violations.map((v) => v.code).join(", "),
            coverageState: input.coverageState,
          },
        });
        return {
          published: false,
          snapshot: rejected,
          rejectionReason: input.coherence.violations.map((v) => v.message).join("; "),
        };
      }

      return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const existing = await tx.scoreSnapshot.findFirst({
          where: {
            characterId: input.characterId,
            seasonId: input.seasonId,
            scoreModelId: input.scoreModelId,
            scopeType: input.scopeType,
            scopeKey: input.scopeKey,
            inputFingerprint: input.snapshot.inputFingerprint,
          },
        });

        const data = snapshotData(input.snapshot, {
          publicationStatus: "PUBLISHED",
          isPublic: true,
          analysisBatchId: input.analysisBatchId,
          refreshContractHash: input.refreshContractHash,
          providerDataAsOf: input.providerDataAsOf,
          coverageState: input.coverageState,
          publishedAt: now,
        });

        await tx.scoreSnapshot.updateMany({
          where: {
            characterId: input.characterId,
            seasonId: input.seasonId,
            scoreModelId: input.scoreModelId,
            isPublic: true,
            ...(existing ? { id: { not: existing.id } } : {}),
          },
          data: { isPublic: false, publicationStatus: "SUPERSEDED" },
        });

        const scoreSnapshot = existing
          ? await tx.scoreSnapshot.update({ where: { id: existing.id }, data })
          : await tx.scoreSnapshot.create({
              data: {
                characterId: input.characterId,
                seasonId: input.seasonId,
                scoreModelId: input.scoreModelId,
                scopeType: input.scopeType,
                scopeKey: input.scopeKey,
                inputFingerprint: input.snapshot.inputFingerprint,
                ...data,
              },
            });

        await upsertDimensionScores(tx, scoreSnapshot.id, input.snapshot);
        await upsertPublishedPointer(tx, {
          characterId: input.characterId,
          seasonId: input.seasonId,
          scoreModelId: input.scoreModelId,
          scopeType: input.scopeType,
          scopeKey: input.scopeKey,
          publishedSnapshotId: scoreSnapshot.id,
        });

        return { published: true, snapshot: scoreSnapshot };
      });
    },

    async saveScoreSnapshot(input) {
      const { snapshot } = input;
      const publish = input.publish !== false;
      return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const existing = await tx.scoreSnapshot.findFirst({
          where: {
            characterId: input.characterId,
            seasonId: input.seasonId,
            scoreModelId: input.scoreModelId,
            scopeType: input.scopeType,
            scopeKey: input.scopeKey,
            inputFingerprint: snapshot.inputFingerprint,
          },
        });

        const data = snapshotData(snapshot, {
          publicationStatus: publish ? "PUBLISHED" : "CANDIDATE",
          isPublic: publish,
          analysisBatchId: input.analysisBatchId,
          refreshContractHash: input.refreshContractHash,
          providerDataAsOf: input.providerDataAsOf,
          coverageState: input.coverageState,
          publishedAt: publish ? new Date() : null,
        });

        if (publish) {
          await tx.scoreSnapshot.updateMany({
            where: {
              characterId: input.characterId,
              seasonId: input.seasonId,
              scoreModelId: input.scoreModelId,
              isPublic: true,
              ...(existing ? { id: { not: existing.id } } : {}),
            },
            data: { isPublic: false, publicationStatus: "SUPERSEDED" },
          });
        }

        const scoreSnapshot = existing
          ? await tx.scoreSnapshot.update({ where: { id: existing.id }, data })
          : await tx.scoreSnapshot.create({
              data: {
                characterId: input.characterId,
                seasonId: input.seasonId,
                scoreModelId: input.scoreModelId,
                scopeType: input.scopeType,
                scopeKey: input.scopeKey,
                inputFingerprint: snapshot.inputFingerprint,
                ...data,
              },
            });

        await upsertDimensionScores(tx, scoreSnapshot.id, snapshot);

        if (publish) {
          await upsertPublishedPointer(tx, {
            characterId: input.characterId,
            seasonId: input.seasonId,
            scoreModelId: input.scoreModelId,
            scopeType: input.scopeType,
            scopeKey: input.scopeKey,
            publishedSnapshotId: scoreSnapshot.id,
          });
        }

        return scoreSnapshot;
      });
    },

    async listPublicModels() {
      return prisma.scoreModel.findMany({ where: { status: "ACTIVE" }, orderBy: { key: "asc" } });
    },

    async listAllModels() {
      return prisma.scoreModel.findMany({ orderBy: [{ key: "asc" }, { version: "desc" }] });
    },

    async getPublishedSnapshot(characterId, seasonId, scoreModelId) {
      try {
        const pointer = await prisma.characterPublishedScore.findFirst({
          where: {
            characterId,
            ...(seasonId ? { seasonId } : {}),
            ...(scoreModelId ? { scoreModelId } : {}),
          },
          orderBy: { updatedAt: "desc" },
        });
        if (pointer) {
          const snapshot = await prisma.scoreSnapshot.findUnique({
            where: { id: pointer.publishedSnapshotId },
            include: { dimensionScores: true, scoreModel: true, season: true },
          });
          if (snapshot) return snapshot;
        }
      } catch {
        // Table may not exist before migration — fall through to legacy query.
      }
      return this.getLatestSnapshot(characterId);
    },

    async getLatestSnapshot(characterId) {
      return prisma.scoreSnapshot.findFirst({
        where: {
          characterId,
          isPublic: true,
          publicationStatus: { in: ["PUBLIC", "PUBLISHED"] },
        },
        orderBy: { calculatedAt: "desc" },
        include: { dimensionScores: true, scoreModel: true, season: true },
      });
    },

    async listHistory(characterId, limit = 20) {
      return prisma.scoreSnapshot.findMany({
        where: {
          characterId,
          publicationStatus: { in: ["PUBLIC", "PUBLISHED", "SUPERSEDED"] },
        },
        orderBy: { calculatedAt: "desc" },
        take: limit,
        include: { dimensionScores: true, scoreModel: true, season: true },
      });
    },
  };
}
