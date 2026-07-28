import type { DimensionScore, Prisma, PrismaClient, ScoreModel, ScoreSnapshot, Season } from "@mplus/database";
import type { ScoreModelConfig, ScoreScope, ScoreSnapshotDTO } from "@mplus/contracts";

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
  /** When true (default), atomically supersede prior public snapshots. */
  publish?: boolean;
  analysisBatchId?: string | null;
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
  listPublicModels(): Promise<ScoreModel[]>;
  /** All models regardless of status, newest first — admin listing only. */
  listAllModels(): Promise<ScoreModel[]>;
  getLatestSnapshot(characterId: string): Promise<ScoreSnapshotWithRelations | null>;
  listHistory(characterId: string, limit?: number): Promise<ScoreSnapshotWithRelations[]>;
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

        const data = {
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
          publicationStatus: publish ? ("PUBLIC" as const) : ("DRAFT" as const),
          isPublic: publish,
          analysisBatchId: input.analysisBatchId ?? null,
        };

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

        for (const dimension of snapshot.dimensions) {
          await tx.dimensionScore.upsert({
            where: {
              scoreSnapshotId_dimension: {
                scoreSnapshotId: scoreSnapshot.id,
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
              scoreSnapshotId: scoreSnapshot.id,
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

        return scoreSnapshot;
      });
    },

    async listPublicModels() {
      return prisma.scoreModel.findMany({ where: { status: "ACTIVE" }, orderBy: { key: "asc" } });
    },

    async listAllModels() {
      return prisma.scoreModel.findMany({ orderBy: [{ key: "asc" }, { version: "desc" }] });
    },

    async getLatestSnapshot(characterId) {
      return prisma.scoreSnapshot.findFirst({
        where: { characterId, isPublic: true },
        orderBy: { calculatedAt: "desc" },
        include: { dimensionScores: true, scoreModel: true, season: true },
      });
    },

    async listHistory(characterId, limit = 20) {
      return prisma.scoreSnapshot.findMany({
        where: { characterId, isPublic: true },
        orderBy: { calculatedAt: "desc" },
        take: limit,
        include: { dimensionScores: true, scoreModel: true, season: true },
      });
    },
  };
}
