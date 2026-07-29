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
import {
  computeCrossProviderRunKey,
  evaluateCrossProviderPersistMatch,
} from "../orchestration/run-fusion.js";

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

/**
 * Resolve and mark Blizzard's current season as the regional current season.
 * Replaces placeholder-current / auto-current as the active scoring season.
 */
export async function ensureBlizzardCurrentSeason(
  client: PrismaClientOrTx,
  regionId: string,
  blizzardSeasonId: number,
): Promise<Season> {
  const slug = `blizzard-season-${blizzardSeasonId}`;
  const existing = await client.season.findFirst({ where: { regionId, slug } });

  await client.season.updateMany({
    where: { regionId, isCurrent: true, NOT: { slug } },
    data: { isCurrent: false },
  });

  if (existing) {
    const previousMeta =
      existing.metadata && typeof existing.metadata === "object"
        ? (existing.metadata as Record<string, unknown>)
        : {};
    return client.season.update({
      where: { id: existing.id },
      data: {
        isCurrent: true,
        name: `Blizzard Season ${blizzardSeasonId}`,
        metadata: {
          ...previousMeta,
          blizzardSeasonId,
          source: "blizzard",
          // Preserve or seed active dungeon slugs so Icecrown cannot re-enter selection.
          dungeonSlugs: Array.isArray(previousMeta.dungeonSlugs)
            ? previousMeta.dungeonSlugs
            : undefined,
        },
      },
    });
  }

  return client.season.create({
    data: {
      regionId,
      slug,
      name: `Blizzard Season ${blizzardSeasonId}`,
      isCurrent: true,
      metadata: { blizzardSeasonId, source: "blizzard" },
    },
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
    options: { regionCode: string; targetCharacterId: string | null; seasonId?: string },
  ): Promise<MythicRun>;
  findLatestForCharacter(characterId: string): Promise<MythicRunWithRelations | null>;
  findHighestForCharacter(characterId: string): Promise<MythicRunWithRelations | null>;
  findRunsForCharacterInSeason(
    characterId: string,
    seasonId: string,
  ): Promise<MythicRunWithRelations[]>;
  findAllTargetRunsForCharacter(characterId: string): Promise<MythicRunWithRelations[]>;
  findById(runId: string): Promise<MythicRunWithRelations | null>;
  /**
   * Unique canonical Mythic+ runs the character participated in (target).
   * Counts distinct MythicRun.canonicalFingerprint — never RunSourceReference rows.
   */
  countForCharacter(characterId: string, seasonId?: string): Promise<number>;
  /** Provider source refs attached to those runs (RIO+WCL for one run → 2). Diagnostic only. */
  countProviderSourcesForCharacter(characterId: string, seasonId?: string): Promise<number>;
  /**
   * Collapse existing duplicate MythicRun rows that represent the same M+ run
   * (dungeon + key + time|duration). Moves sources/participants/analyses/metrics onto the winner.
   */
  reconcileDuplicateRunsForCharacter(
    characterId: string,
    seasonId?: string,
  ): Promise<{ mergedGroups: number; deletedRunCount: number }>;
  /**
   * Detach the character from MythicRun rows outside the active season and delete
   * orphaned runs that no longer have participants.
   */
  pruneOtherSeasonParticipations(
    characterId: string,
    activeSeasonId: string,
  ): Promise<{ detachedParticipations: number; deletedRuns: number }>;
  findWclSource(runId: string): Promise<{ reportCode: string; fightId: number } | null>;
  /**
   * Attach (or re-point) a WARCRAFT_LOGS report+fight onto a canonical MythicRun.
   * Used by Survival late-bind when fusion did not persist the source earlier.
   */
  attachWclSource(
    runId: string,
    source: { reportCode: string; fightId: number; externalUrl?: string | null },
  ): Promise<{ reportCode: string; fightId: number }>;
  findLatestAnalysisCoverage(
    characterId: string,
    runId: string,
  ): Promise<number | null>;
  findRunAnalysis(
    runId: string,
    characterId: string,
    analysisVersion: string,
  ): Promise<RunAnalysis | null>;
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
        const season = options.seasonId
          ? await tx.season.findUniqueOrThrow({ where: { id: options.seasonId } })
          : await ensureSeasonBySlug(tx, region.id, run.seasonSlug);
        const dungeon = await ensureDungeon(tx, run.dungeonSlug);

        const mythicRun = await tx.mythicRun.upsert({
          where: { canonicalFingerprint: run.canonicalFingerprint },
          update: {
            seasonId: season.id,
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
              runId: mythicRun.id,
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

    async findRunsForCharacterInSeason(characterId, seasonId) {
      const participants = await prisma.runParticipant.findMany({
        where: { characterId, isTargetCharacter: true, run: { seasonId } },
        include: { run: { include: { dungeon: true, season: true, sources: true } } },
        orderBy: [{ run: { completedAt: "desc" } }],
      });
      const byId = new Map<string, MythicRunWithRelations>();
      for (const row of participants) {
        byId.set(row.run.id, row.run);
      }
      return [...byId.values()];
    },

    async findAllTargetRunsForCharacter(characterId) {
      const participants = await prisma.runParticipant.findMany({
        where: { characterId, isTargetCharacter: true },
        include: { run: { include: { dungeon: true, season: true, sources: true } } },
        orderBy: [{ run: { completedAt: "desc" } }],
      });
      const byId = new Map<string, MythicRunWithRelations>();
      for (const row of participants) {
        byId.set(row.run.id, row.run);
      }
      return [...byId.values()];
    },

    async findById(runId) {
      return prisma.mythicRun.findUnique({
        where: { id: runId },
        include: { dungeon: true, season: true, sources: true },
      });
    },

    async countForCharacter(characterId, seasonId) {
      // Distinct fingerprints (unique on MythicRun) — not participant or provider-source rows.
      const rows = await prisma.mythicRun.findMany({
        where: {
          ...(seasonId ? { seasonId } : {}),
          participants: {
            some: { characterId, isTargetCharacter: true },
          },
        },
        select: { canonicalFingerprint: true },
        distinct: ["canonicalFingerprint"],
      });
      return rows.length;
    },

    async countProviderSourcesForCharacter(characterId, seasonId) {
      return prisma.runSourceReference.count({
        where: {
          run: {
            ...(seasonId ? { seasonId } : {}),
            participants: {
              some: { characterId, isTargetCharacter: true },
            },
          },
        },
      });
    },

    async reconcileDuplicateRunsForCharacter(characterId, seasonId) {
      const runs = await prisma.mythicRun.findMany({
        where: {
          ...(seasonId ? { seasonId } : {}),
          participants: { some: { characterId, isTargetCharacter: true } },
        },
        include: { sources: true, dungeon: true },
        orderBy: { createdAt: "asc" },
      });

      type RunRow = (typeof runs)[number];
      const parent = new Map<string, string>();
      const find = (id: string): string => {
        const p = parent.get(id) ?? id;
        if (p !== id) {
          const root = find(p);
          parent.set(id, root);
          return root;
        }
        return id;
      };
      const union = (a: string, b: string) => {
        const ra = find(a);
        const rb = find(b);
        if (ra !== rb) parent.set(rb, ra);
      };

      for (const run of runs) parent.set(run.id, run.id);

      for (let i = 0; i < runs.length; i++) {
        const a = runs[i]!;
        for (let j = i + 1; j < runs.length; j++) {
          const b = runs[j]!;
          const { matched } = evaluateCrossProviderPersistMatch(
            {
              dungeonSlug: a.dungeon.slug,
              keyLevel: a.keyLevel,
              completedAt: a.completedAt.toISOString(),
              durationMs: a.durationMs,
            },
            {
              dungeonSlug: b.dungeon.slug,
              keyLevel: b.keyLevel,
              completedAt: b.completedAt.toISOString(),
              durationMs: b.durationMs,
            },
          );
          if (matched) union(a.id, b.id);
        }
      }

      const groups = new Map<string, RunRow[]>();
      for (const run of runs) {
        const root = find(run.id);
        const list = groups.get(root) ?? [];
        list.push(run);
        groups.set(root, list);
      }

      let mergedGroups = 0;
      let deletedRunCount = 0;

      const providerRank = (provider: string) =>
        provider === "BLIZZARD" ? 3 : provider === "RAIDER_IO" ? 2 : provider === "WARCRAFT_LOGS" ? 1 : 0;

      for (const group of groups.values()) {
        if (group.length < 2) continue;
        mergedGroups += 1;

        group.sort((a, b) => {
          const aRank = Math.max(0, ...a.sources.map((s) => providerRank(s.provider)));
          const bRank = Math.max(0, ...b.sources.map((s) => providerRank(s.provider)));
          if (bRank !== aRank) return bRank - aRank;
          return a.createdAt.getTime() - b.createdAt.getTime();
        });
        const winner = group[0]!;
        const losers = group.slice(1);

        await prisma.$transaction(async (tx) => {
          for (const loser of losers) {
            // Move sources onto winner (skip if provider+external already present).
            for (const source of loser.sources) {
              const existing = await tx.runSourceReference.findFirst({
                where: {
                  OR: [
                    {
                      provider: source.provider,
                      externalRunId: source.externalRunId,
                    },
                    ...(source.reportCode != null && source.fightId != null
                      ? [
                          {
                            provider: source.provider,
                            reportCode: source.reportCode,
                            fightId: source.fightId,
                          },
                        ]
                      : []),
                  ],
                },
              });
              if (existing) {
                if (existing.runId !== winner.id) {
                  await tx.runSourceReference.update({
                    where: { id: existing.id },
                    data: { runId: winner.id },
                  });
                }
                if (existing.id !== source.id) {
                  await tx.runSourceReference.delete({ where: { id: source.id } }).catch(() => undefined);
                }
              } else {
                await tx.runSourceReference.update({
                  where: { id: source.id },
                  data: { runId: winner.id },
                });
              }
            }

            const loserParticipants = await tx.runParticipant.findMany({ where: { runId: loser.id } });
            for (const participant of loserParticipants) {
              const clash = await tx.runParticipant.findUnique({
                where: {
                  runId_providerCharacterKey: {
                    runId: winner.id,
                    providerCharacterKey: participant.providerCharacterKey,
                  },
                },
              });
              if (clash) {
                await tx.runParticipant.update({
                  where: { id: clash.id },
                  data: {
                    isTargetCharacter: clash.isTargetCharacter || participant.isTargetCharacter,
                    characterId: clash.characterId ?? participant.characterId,
                    itemLevel: clash.itemLevel ?? participant.itemLevel,
                    mythicRatingAtRun: clash.mythicRatingAtRun ?? participant.mythicRatingAtRun,
                  },
                });
                await tx.runParticipant.delete({ where: { id: participant.id } });
              } else {
                await tx.runParticipant.update({
                  where: { id: participant.id },
                  data: { runId: winner.id },
                });
              }
            }

            const analyses = await tx.runAnalysis.findMany({ where: { runId: loser.id } });
            for (const analysis of analyses) {
              const clash = await tx.runAnalysis.findUnique({
                where: {
                  runId_characterId_analysisVersion: {
                    runId: winner.id,
                    characterId: analysis.characterId,
                    analysisVersion: analysis.analysisVersion,
                  },
                },
              });
              if (clash) {
                if (analysis.analyzedAt > clash.analyzedAt) {
                  await tx.runAnalysis.update({
                    where: { id: clash.id },
                    data: {
                      analyzedAt: analysis.analyzedAt,
                      coverage: analysis.coverage,
                      summary: analysis.summary as object,
                      sourcePayloadIds: analysis.sourcePayloadIds as object,
                    },
                  });
                }
                await tx.runAnalysis.delete({ where: { id: analysis.id } });
              } else {
                await tx.runAnalysis.update({
                  where: { id: analysis.id },
                  data: { runId: winner.id },
                });
              }
            }

            await tx.metricObservation.updateMany({
              where: { runId: loser.id },
              data: { runId: winner.id },
            });
            await tx.characterRedFlag.updateMany({
              where: { runId: loser.id },
              data: { runId: winner.id },
            });
            await tx.ingestionJob.updateMany({
              where: { runId: loser.id },
              data: { runId: winner.id },
            });

            await tx.mythicRun.delete({ where: { id: loser.id } });
            deletedRunCount += 1;
          }

          const region = await tx.region.findUnique({ where: { id: winner.regionId } });
          const fingerprint = computeCrossProviderRunKey({
            region: (region?.code ?? "EU") as "EU" | "US" | "KR" | "TW",
            dungeonSlug: winner.dungeon.slug,
            keyLevel: winner.keyLevel,
            completedAt: winner.completedAt.toISOString(),
          });
          if (fingerprint !== winner.canonicalFingerprint) {
            const clash = await tx.mythicRun.findUnique({
              where: { canonicalFingerprint: fingerprint },
            });
            if (!clash || clash.id === winner.id) {
              await tx.mythicRun.update({
                where: { id: winner.id },
                data: { canonicalFingerprint: fingerprint },
              });
            }
          }
        });
      }

      // After source reassignment, drop orphan MythicRun rows that no longer have any sources.
      const orphans = await prisma.mythicRun.findMany({
        where: {
          ...(seasonId ? { seasonId } : {}),
          participants: { some: { characterId, isTargetCharacter: true } },
          sources: { none: {} },
        },
        select: { id: true },
      });
      for (const orphan of orphans) {
        await prisma.$transaction(async (tx) => {
          await tx.runParticipant.deleteMany({ where: { runId: orphan.id } });
          await tx.runAnalysis.deleteMany({ where: { runId: orphan.id } });
          await tx.scoreAnalysisBatchRun.deleteMany({ where: { runId: orphan.id } });
          await tx.metricObservation.updateMany({
            where: { runId: orphan.id },
            data: { runId: null },
          });
          await tx.characterRedFlag.updateMany({
            where: { runId: orphan.id },
            data: { runId: null },
          });
          await tx.ingestionJob.updateMany({
            where: { runId: orphan.id },
            data: { runId: null },
          });
          await tx.mythicRun.delete({ where: { id: orphan.id } });
        });
        deletedRunCount += 1;
      }

      return { mergedGroups, deletedRunCount };
    },

    async pruneOtherSeasonParticipations(characterId, activeSeasonId) {
      const foreign = await prisma.runParticipant.findMany({
        where: {
          characterId,
          isTargetCharacter: true,
          run: { seasonId: { not: activeSeasonId } },
        },
        select: { id: true, runId: true },
      });

      let detachedParticipations = 0;
      let deletedRuns = 0;
      const runIds = [...new Set(foreign.map((p) => p.runId))];

      for (const participant of foreign) {
        await prisma.runParticipant.delete({ where: { id: participant.id } });
        detachedParticipations += 1;
      }

      for (const runId of runIds) {
        const remaining = await prisma.runParticipant.count({ where: { runId } });
        if (remaining > 0) continue;
        await prisma.$transaction(async (tx) => {
          await tx.runSourceReference.deleteMany({ where: { runId } });
          await tx.runAnalysis.deleteMany({ where: { runId } });
          await tx.scoreAnalysisBatchRun.deleteMany({ where: { runId } });
          await tx.metricObservation.updateMany({ where: { runId }, data: { runId: null } });
          await tx.characterRedFlag.updateMany({ where: { runId }, data: { runId: null } });
          await tx.ingestionJob.updateMany({ where: { runId }, data: { runId: null } });
          await tx.mythicRun.delete({ where: { id: runId } });
        });
        deletedRuns += 1;
      }

      return { detachedParticipations, deletedRuns };
    },

    async findWclSource(runId) {
      const source = await prisma.runSourceReference.findFirst({
        where: { runId, provider: "WARCRAFT_LOGS" },
      });
      if (!source?.reportCode || source.fightId == null || source.fightId <= 0) return null;
      return { reportCode: source.reportCode, fightId: source.fightId };
    },

    async attachWclSource(runId, source) {
      if (!source.reportCode || source.fightId <= 0) {
        throw new Error("attachWclSource requires reportCode and fightId > 0");
      }
      const externalRunId = `${source.reportCode}:${source.fightId}`;
      const externalUrl =
        source.externalUrl ??
        `https://www.warcraftlogs.com/reports/${source.reportCode}?fight=${source.fightId}`;

      // Prefer moving an existing unique (provider, reportCode, fightId) row onto this run.
      const byReportFight = await prisma.runSourceReference.findFirst({
        where: {
          provider: "WARCRAFT_LOGS",
          reportCode: source.reportCode,
          fightId: source.fightId,
        },
      });
      if (byReportFight) {
        if (byReportFight.runId !== runId) {
          await prisma.runSourceReference.update({
            where: { id: byReportFight.id },
            data: { runId, externalUrl, externalRunId },
          });
        }
        return { reportCode: source.reportCode, fightId: source.fightId };
      }

      await prisma.runSourceReference.upsert({
        where: {
          provider_externalRunId: {
            provider: "WARCRAFT_LOGS",
            externalRunId,
          },
        },
        update: {
          runId,
          externalUrl,
          reportCode: source.reportCode,
          fightId: source.fightId,
        },
        create: {
          runId,
          provider: "WARCRAFT_LOGS",
          externalRunId,
          externalUrl,
          reportCode: source.reportCode,
          fightId: source.fightId,
          revision: null,
        },
      });
      return { reportCode: source.reportCode, fightId: source.fightId };
    },

    async findLatestAnalysisCoverage(characterId, runId) {
      const analysis = await prisma.runAnalysis.findFirst({
        where: {
          characterId,
          runId,
          analysisVersion: "wcl-combat-facts-v1",
        },
        orderBy: { analyzedAt: "desc" },
        select: { coverage: true },
      });
      return analysis?.coverage != null ? Number(analysis.coverage) : null;
    },

    async findRunAnalysis(runId, characterId, analysisVersion) {
      return prisma.runAnalysis.findUnique({
        where: {
          runId_characterId_analysisVersion: {
            runId,
            characterId,
            analysisVersion,
          },
        },
      });
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
