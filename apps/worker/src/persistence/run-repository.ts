import type {
  Dungeon,
  MythicRun,
  Prisma,
  PrismaClient,
  RunAnalysis,
  RunSourceReference,
  Season,
} from "@mplus/database";
import type { MythicRunDTO } from "@mplus/contracts";
import { ensureRegion } from "./realm-repository.js";
import type { PrismaClientOrTx } from "./shared.js";

/** Read shape used by API mappers: adds the relations needed for a run summary DTO. */
export type MythicRunWithRelations = MythicRun & {
  dungeon: Dungeon;
  season: Season;
  sources: RunSourceReference[];
};

export async function ensureDungeon(client: PrismaClientOrTx, dungeonSlug: string): Promise<Dungeon> {
  const existing = await client.dungeon.findUnique({ where: { slug: dungeonSlug } });
  if (existing) return existing;
  return client.dungeon.create({ data: { slug: dungeonSlug, name: capitalize(dungeonSlug) } });
}

export async function ensureCurrentSeason(client: PrismaClientOrTx, regionId: string): Promise<Season> {
  const current = await client.season.findFirst({ where: { regionId, isCurrent: true } });
  if (current) return current;

  const globalCurrent = await client.season.findFirst({ where: { regionId: null, isCurrent: true } });
  if (globalCurrent) return globalCurrent;

  return client.season.create({
    data: { regionId, slug: "auto-current", name: "Auto-created current season", isCurrent: true },
  });
}

export async function ensureSeasonBySlug(
  client: PrismaClientOrTx,
  regionId: string,
  slug: string,
): Promise<Season> {
  const existing = await client.season.findFirst({ where: { regionId, slug } });
  if (existing) return existing;
  return client.season.create({ data: { regionId, slug, name: capitalize(slug) } });
}

function capitalize(value: string): string {
  return value
    .split(/[-_]/)
    .map((part) => (part ? part.charAt(0).toUpperCase() + part.slice(1) : part))
    .join(" ");
}

export interface RunRepository {
  upsertRunWithSourcesAndParticipants(
    run: MythicRunDTO,
    options: { regionCode: string; targetCharacterId: string | null },
  ): Promise<MythicRun>;
  findLatestForCharacter(characterId: string): Promise<MythicRunWithRelations | null>;
  findHighestForCharacter(characterId: string): Promise<MythicRunWithRelations | null>;
  findById(runId: string): Promise<MythicRunWithRelations | null>;
  countForCharacter(characterId: string): Promise<number>;
  findWclSource(runId: string): Promise<{ reportCode: string; fightId: number } | null>;
  upsertRunAnalysis(input: {
    runId: string;
    characterId: string;
    analysisVersion: string;
    analyzedAt: Date;
    coverage: number;
    summary: unknown;
    sourcePayloadIds?: string[];
  }): Promise<RunAnalysis>;
}

export function createRunRepository(prisma: PrismaClient): RunRepository {
  return {
    async upsertRunWithSourcesAndParticipants(run, options) {
      return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const region = await ensureRegion(tx, options.regionCode);
        const season = await ensureSeasonBySlug(tx, region.id, run.seasonSlug);
        const dungeon = await ensureDungeon(tx, run.dungeonSlug);

        const mythicRun = await tx.mythicRun.upsert({
          where: { canonicalFingerprint: run.canonicalFingerprint },
          update: {
            keyLevel: run.keyLevel,
            completedAt: new Date(run.completedAt),
            durationMs: run.durationMs,
            timerMs: run.timerMs,
            timed: run.timed,
            scoreValue: run.scoreValue,
            affixes: (run.affixes ?? []) as object,
          },
          create: {
            seasonId: season.id,
            dungeonId: dungeon.id,
            regionId: region.id,
            keyLevel: run.keyLevel,
            completedAt: new Date(run.completedAt),
            durationMs: run.durationMs,
            timerMs: run.timerMs,
            timed: run.timed,
            scoreValue: run.scoreValue,
            canonicalFingerprint: run.canonicalFingerprint,
            affixes: (run.affixes ?? []) as object,
          },
        });

        for (const source of run.sources) {
          await tx.runSourceReference.upsert({
            where: { provider_externalRunId: { provider: source.provider, externalRunId: source.externalRunId } },
            update: {
              externalUrl: source.externalUrl,
              reportCode: source.reportCode,
              fightId: source.fightId,
              revision: source.revision,
            },
            create: {
              runId: mythicRun.id,
              provider: source.provider,
              externalRunId: source.externalRunId,
              externalUrl: source.externalUrl,
              reportCode: source.reportCode,
              fightId: source.fightId,
              revision: source.revision,
            },
          });
        }

        for (const participant of run.participants) {
          const characterId = participant.isTargetCharacter ? options.targetCharacterId : null;
          await tx.runParticipant.upsert({
            where: {
              runId_providerCharacterKey: {
                runId: mythicRun.id,
                providerCharacterKey: participant.providerCharacterKey,
              },
            },
            update: {
              displayName: participant.displayName,
              realmSlug: participant.realmSlug,
              regionCode: participant.region,
              role: participant.role,
              itemLevel: participant.itemLevel,
              mythicRatingAtRun: participant.mythicRatingAtRun,
              isTargetCharacter: participant.isTargetCharacter,
              characterId,
            },
            create: {
              runId: mythicRun.id,
              providerCharacterKey: participant.providerCharacterKey,
              displayName: participant.displayName,
              realmSlug: participant.realmSlug,
              regionCode: participant.region,
              role: participant.role,
              itemLevel: participant.itemLevel,
              mythicRatingAtRun: participant.mythicRatingAtRun,
              isTargetCharacter: participant.isTargetCharacter,
              characterId,
            },
          });
        }

        return mythicRun;
      });
    },

    async findLatestForCharacter(characterId) {
      const participant = await prisma.runParticipant.findFirst({
        where: { characterId, isTargetCharacter: true },
        include: { run: { include: { dungeon: true, season: true, sources: true } } },
        orderBy: { run: { completedAt: "desc" } },
      });
      return participant?.run ?? null;
    },

    async findHighestForCharacter(characterId) {
      const participant = await prisma.runParticipant.findFirst({
        where: { characterId, isTargetCharacter: true },
        include: { run: { include: { dungeon: true, season: true, sources: true } } },
        orderBy: [{ run: { keyLevel: "desc" } }, { run: { completedAt: "desc" } }],
      });
      return participant?.run ?? null;
    },

    async findById(runId) {
      return prisma.mythicRun.findUnique({
        where: { id: runId },
        include: { dungeon: true, season: true, sources: true },
      });
    },

    async countForCharacter(characterId) {
      return prisma.runParticipant.count({
        where: { characterId, isTargetCharacter: true },
      });
    },

    async findWclSource(runId) {
      const source = await prisma.runSourceReference.findFirst({
        where: { runId, provider: "WARCRAFT_LOGS" },
      });
      if (!source?.reportCode || source.fightId === null) return null;
      return { reportCode: source.reportCode, fightId: source.fightId };
    },

    async upsertRunAnalysis(input) {
      return prisma.runAnalysis.upsert({
        where: {
          runId_characterId_analysisVersion: {
            runId: input.runId,
            characterId: input.characterId,
            analysisVersion: input.analysisVersion,
          },
        },
        update: {
          analyzedAt: input.analyzedAt,
          coverage: input.coverage,
          summary: input.summary as object,
          sourcePayloadIds: (input.sourcePayloadIds ?? []) as object,
        },
        create: {
          runId: input.runId,
          characterId: input.characterId,
          analysisVersion: input.analysisVersion,
          analyzedAt: input.analyzedAt,
          coverage: input.coverage,
          summary: input.summary as object,
          sourcePayloadIds: (input.sourcePayloadIds ?? []) as object,
        },
      });
    },
  };
}
