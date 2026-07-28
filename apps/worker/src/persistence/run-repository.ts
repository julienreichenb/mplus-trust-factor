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
import { MIDNIGHT_S1_SEASON, resolveCanonicalScoringSeasonSlug } from "@mplus/mechanics";
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
  return ensureCanonicalScoringSeason(client, regionId);
}

/**
 * Resolve and mark the canonical Scoring v3 season for a region.
 * Never returns placeholder-current / auto-current for active scoring.
 */
export async function ensureCanonicalScoringSeason(
  client: PrismaClientOrTx,
  regionId: string,
  overrideSlug?: string | null,
): Promise<Season> {
  const slug = resolveCanonicalScoringSeasonSlug(overrideSlug);
  const existing = await client.season.findFirst({ where: { regionId, slug } });

  await client.season.updateMany({
    where: { regionId, isCurrent: true, NOT: { slug } },
    data: { isCurrent: false },
  });

  if (existing) {
    return client.season.update({
      where: { id: existing.id },
      data: {
        isCurrent: true,
        name: "Midnight Season 1",
        dungeonCount: MIDNIGHT_S1_SEASON.expectedDungeonCount,
        metadata: { source: "configured", canonical: true },
      },
    });
  }

  return client.season.create({
    data: {
      regionId,
      slug,
      name: "Midnight Season 1",
      isCurrent: true,
      dungeonCount: MIDNIGHT_S1_SEASON.expectedDungeonCount,
      metadata: { source: "configured", canonical: true },
    },
  });
}

/**
 * Resolve Blizzard's current season row for metadata (API season id, cutoffs context).
 * Does not replace the canonical Scoring v3 season as `isCurrent`.
 */
export async function ensureBlizzardCurrentSeason(
  client: PrismaClientOrTx,
  regionId: string,
  blizzardSeasonId: number,
): Promise<Season> {
  const slug = `blizzard-season-${blizzardSeasonId}`;
  const existing = await client.season.findFirst({ where: { regionId, slug } });

  if (existing) {
    return client.season.update({
      where: { id: existing.id },
      data: {
        name: `Blizzard Season ${blizzardSeasonId}`,
        metadata: { blizzardSeasonId, source: "blizzard" },
      },
    });
  }

  return client.season.create({
    data: {
      regionId,
      slug,
      name: `Blizzard Season ${blizzardSeasonId}`,
      isCurrent: false,
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
    options: { regionCode: string; targetCharacterId: string | null },
  ): Promise<MythicRun>;
  findLatestForCharacter(characterId: string): Promise<MythicRunWithRelations | null>;
  findHighestForCharacter(characterId: string): Promise<MythicRunWithRelations | null>;
  findById(runId: string): Promise<MythicRunWithRelations | null>;
  /** All target-character runs for a season (post-reconcile scoring selection). */
  listForCharacterSeason(characterId: string, seasonId: string): Promise<MythicRunWithRelations[]>;
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
  /** Move all target-character runs onto the canonical scoring season (cross-season re-home). */
  rehomeCharacterRunsToSeason(
    characterId: string,
    seasonId: string,
  ): Promise<{ updatedRunCount: number }>;
  findWclSource(runId: string): Promise<{ reportCode: string; fightId: number } | null>;
  findLatestAnalysisCoverage(
    characterId: string,
    runId: string,
  ): Promise<number | null>;
  /**
   * Latest wcl-combat-facts-v1 analyses for many runs (coverage + summary JSON).
   */
  findLatestAnalysesForRuns(
    characterId: string,
    runIds: string[],
  ): Promise<Map<string, { coverage: number | null; summary: unknown }>>;
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

    async findById(runId) {
      return prisma.mythicRun.findUnique({
        where: { id: runId },
        include: { dungeon: true, season: true, sources: true },
      });
    },

    async listForCharacterSeason(characterId, seasonId) {
      return prisma.mythicRun.findMany({
        where: {
          seasonId,
          participants: { some: { characterId, isTargetCharacter: true } },
        },
        include: { dungeon: true, season: true, sources: true },
        orderBy: [{ keyLevel: "desc" }, { completedAt: "desc" }],
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
          await tx.metricObservation.updateMany({ where: { runId }, data: { runId: null } });
          await tx.characterRedFlag.updateMany({ where: { runId }, data: { runId: null } });
          await tx.ingestionJob.updateMany({ where: { runId }, data: { runId: null } });
          await tx.mythicRun.delete({ where: { id: runId } });
        });
        deletedRuns += 1;
      }

      return { detachedParticipations, deletedRuns };
    },

    async rehomeCharacterRunsToSeason(characterId, seasonId) {
      const result = await prisma.mythicRun.updateMany({
        where: {
          seasonId: { not: seasonId },
          participants: { some: { characterId, isTargetCharacter: true } },
        },
        data: { seasonId },
      });
      return { updatedRunCount: result.count };
    },

    async findWclSource(runId) {
      const source = await prisma.runSourceReference.findFirst({
        where: { runId, provider: "WARCRAFT_LOGS" },
      });
      if (!source?.reportCode || source.fightId === null) return null;
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

    async findLatestAnalysesForRuns(characterId, runIds) {
      const out = new Map<string, { coverage: number | null; summary: unknown }>();
      if (runIds.length === 0) return out;
      const rows = await prisma.runAnalysis.findMany({
        where: {
          characterId,
          analysisVersion: "wcl-combat-facts-v1",
          runId: { in: [...new Set(runIds)] },
        },
        orderBy: { analyzedAt: "desc" },
        select: { runId: true, coverage: true, summary: true },
      });
      for (const row of rows) {
        if (out.has(row.runId)) continue;
        out.set(row.runId, {
          coverage: row.coverage != null ? Number(row.coverage) : null,
          summary: row.summary,
        });
      }
      return out;
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
