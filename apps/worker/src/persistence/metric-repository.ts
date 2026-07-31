import { Prisma, type MetricDefinition, type PrismaClient } from "@mplus/database";
import type { MetricObservationDTO } from "@mplus/contracts";
import { buildObservationKey } from "@mplus/scoring";
import type { PrismaClientOrTx } from "./shared.js";

/**
 * Ensure a MetricDefinition row exists for the key.
 * Concurrent pipeline/test workers can race on first create; Prisma upsert may
 * still raise P2002 under parallel interactive transactions — recover by re-read.
 */
export async function ensureMetricDefinition(
  client: PrismaClientOrTx,
  metricKey: string,
  dimension: MetricObservationDTO["dimension"],
): Promise<MetricDefinition> {
  try {
    return await client.metricDefinition.upsert({
      where: { key: metricKey },
      create: {
        key: metricKey,
        dimension,
        valueType: "number",
        direction: "HIGHER_BETTER",
        description: `Auto-created metric definition for ${metricKey}`,
      },
      update: {},
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      const existing = await client.metricDefinition.findUnique({
        where: { key: metricKey },
      });
      if (existing) return existing;
    }
    throw error;
  }
}

export interface MetricRepository {
  /** Replaces all observations for a character/season pair with a fresh set (idempotent per pipeline run). */
  replaceObservations(
    characterId: string,
    seasonId: string,
    observations: MetricObservationDTO[],
  ): Promise<void>;
  /** Upserts observations by deterministic key, preserving compatible persisted data. */
  upsertObservations(
    characterId: string,
    seasonId: string,
    observations: MetricObservationDTO[],
  ): Promise<void>;
  listForCharacter(characterId: string, seasonId?: string): Promise<MetricObservationDTO[]>;
}

function readContextField(context: unknown, key: string): string | null {
  if (!context || typeof context !== "object") return null;
  const value = (context as Record<string, unknown>)[key];
  return typeof value === "string" ? value : null;
}

function mapProviderName(
  sourceProvider: string,
): "BLIZZARD" | "WARCRAFT_LOGS" | "RAIDER_IO" {
  switch (sourceProvider) {
    case "blizzard":
      return "BLIZZARD";
    case "warcraftlogs":
      return "WARCRAFT_LOGS";
    case "raiderio":
      return "RAIDER_IO";
    case "character_history":
    case "fusion":
      return "BLIZZARD";
    default:
      return "BLIZZARD";
  }
}

async function writeObservation(
  tx: Prisma.TransactionClient,
  characterId: string,
  seasonId: string,
  observation: MetricObservationDTO,
): Promise<void> {
  const definition = await ensureMetricDefinition(tx, observation.metricKey, observation.dimension);
  const observationKey = buildObservationKey(observation);
  const analysisVersion = readContextField(observation.context, "analysisVersion");
  const schemaVersion = readContextField(observation.context, "schemaVersion");
  const sourcePayloadFingerprint = readContextField(observation.context, "sourcePayloadFingerprint");

  const data = {
    characterId,
    seasonId,
    scopeType: "CHARACTER" as const,
    metricDefinitionId: definition.id,
    rawValue: observation.rawValue,
    normalizedValue: observation.normalizedValue,
    confidence: observation.confidence,
    observedAt: new Date(observation.observedAt),
    sourceProvider: mapProviderName(observation.sourceProvider),
    context: (observation.context ?? {}) as object,
    observationKey,
    analysisVersion,
    schemaVersion,
    sourcePayloadFingerprint,
  };

  const existing = await tx.metricObservation.findFirst({
    where: {
      characterId,
      seasonId,
      metricDefinition: { key: observation.metricKey },
    },
  });

  if (existing) {
    await tx.metricObservation.update({
      where: { id: existing.id },
      data: {
        ...data,
        ...(observationKey ? { observationKey } : {}),
      },
    });
  } else {
    await tx.metricObservation.create({ data });
  }
}

export function createMetricRepository(prisma: PrismaClient): MetricRepository {
  return {
    async replaceObservations(characterId, seasonId, observations) {
      await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        await tx.metricObservation.deleteMany({ where: { characterId, seasonId } });
        for (const observation of observations) {
          await writeObservation(tx, characterId, seasonId, observation);
        }
      });
    },

    async upsertObservations(characterId, seasonId, observations) {
      await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        for (const observation of observations) {
          await writeObservation(tx, characterId, seasonId, observation);
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
