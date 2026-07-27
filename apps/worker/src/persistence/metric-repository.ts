import type { MetricDefinition, Prisma, PrismaClient } from "@mplus/database";
import type { MetricObservationDTO } from "@mplus/contracts";
import type { PrismaClientOrTx } from "./shared.js";

export async function ensureMetricDefinition(
  client: PrismaClientOrTx,
  metricKey: string,
  dimension: MetricObservationDTO["dimension"],
): Promise<MetricDefinition> {
  const existing = await client.metricDefinition.findUnique({ where: { key: metricKey } });
  if (existing) return existing;
  return client.metricDefinition.create({
    data: {
      key: metricKey,
      dimension,
      valueType: "number",
      direction: "HIGHER_BETTER",
      description: `Auto-created metric definition for ${metricKey}`,
    },
  });
}

export interface MetricRepository {
  /** Replaces all observations for a character/season pair with a fresh set (idempotent per pipeline run). */
  replaceObservations(
    characterId: string,
    seasonId: string,
    observations: MetricObservationDTO[],
  ): Promise<void>;
  listForCharacter(characterId: string, seasonId?: string): Promise<MetricObservationDTO[]>;
}

export function createMetricRepository(prisma: PrismaClient): MetricRepository {
  return {
    async replaceObservations(characterId, seasonId, observations) {
      await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        await tx.metricObservation.deleteMany({ where: { characterId, seasonId } });
        for (const observation of observations) {
          const definition = await ensureMetricDefinition(tx, observation.metricKey, observation.dimension);
          await tx.metricObservation.create({
            data: {
              characterId,
              seasonId,
              scopeType: "CHARACTER",
              metricDefinitionId: definition.id,
              rawValue: observation.rawValue,
              normalizedValue: observation.normalizedValue,
              confidence: observation.confidence,
              observedAt: new Date(observation.observedAt),
              sourceProvider: mapProviderName(observation.sourceProvider),
              context: (observation.context ?? {}) as object,
            },
          });
        }
      });
    },

    async listForCharacter(characterId, seasonId) {
      const observations = await prisma.metricObservation.findMany({
        where: { characterId, ...(seasonId ? { seasonId } : {}) },
        include: { metricDefinition: true },
        orderBy: { observedAt: "desc" },
      });
      return observations.map((observation) => ({
        metricKey: observation.metricDefinition.key,
        dimension: observation.metricDefinition.dimension,
        rawValue: observation.rawValue ? Number(observation.rawValue) : null,
        normalizedValue: observation.normalizedValue ? Number(observation.normalizedValue) : null,
        confidence: Number(observation.confidence),
        observedAt: observation.observedAt.toISOString(),
        sourceProvider: observation.sourceProvider,
        coverage: null,
        context: observation.context,
      }));
    },
  };
}

function mapProviderName(sourceProvider: string): "BLIZZARD" | "WARCRAFT_LOGS" | "RAIDER_IO" {
  switch (sourceProvider) {
    case "blizzard":
      return "BLIZZARD";
    case "warcraftlogs":
      return "WARCRAFT_LOGS";
    case "raiderio":
      return "RAIDER_IO";
    default:
      return "BLIZZARD";
  }
}
