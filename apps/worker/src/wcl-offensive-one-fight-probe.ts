/**
 * Provider-free WCL offensive cooldown one-fight extraction probe.
 *
 * Usage:
 *   pnpm wcl:probe:offensive-one-fight
 *
 * Provider-free only: loads persisted PostgreSQL evidence.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { CURRENT_CATALOG_VERSION_ID, getAbilityCatalog, findRetailSpecIdentityByBlizzardSpecId, normalizeRetailClassSlug, type AbilityRole } from "@mplus/abilities";
import { loadEnv } from "@mplus/config";
import { createPrismaClient } from "@mplus/database";
import { normalizeName, normalizeRealmSlug } from "@mplus/domain";
import {
  buildOffensiveProbeReport,
  normalizeWclEventFields,
  printOffensiveProbeSummary,
  OFFENSIVE_ONE_FIGHT_DATASETS,
  type OffensiveProbeDataLoad,
  type OffensiveProbeFightSelection,
  type OffensiveProbeReport,
  type OffensiveProbePersistenceDataset,
  type OffensiveProbePersistenceSection,
} from "@mplus/provider-warcraftlogs";
import { createRepositories } from "./persistence/index.js";
import { selectPreferredEvidencePages } from "./orchestration/scoring-v2/persistent-shared-evidence-store.js";
import {
  formatPersistedCandidateLoadFailures,
  prioritizeOffensiveProbeCandidates,
  resolvePersistedFightWindow,
  type OffensiveProbeCandidateLoadFailure,
} from "./offensive-one-fight-probe-persist.js";

const REQUIRED_DATASET_KEYS = ["Casts", "Buffs", "CombatantInfo", "masterData"] as const;

/** Spike target: one shared acquisition for this report/fight/revision only. */
const SPIKE_FIGHT = {
  reportCode: "1WKcCz2BnAQmbhfq",
  fightId: 1,
  reportRevision: 1,
} as const;

function envFlag(value: string | undefined, defaultValue = false): boolean {
  if (value === undefined || value === "") return defaultValue;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

async function slotHasCompletePersistedPages(
  prisma: ReturnType<typeof createPrismaClient>,
  slot: { reportCode: string | null; fightId: number | null; reportRevision: number | null },
): Promise<boolean> {
  if (!slot.reportCode || slot.fightId == null || slot.reportRevision == null) return false;
  for (const datasetKey of REQUIRED_DATASET_KEYS) {
    const count = await prisma.evidenceDatasetPage.count({
      where: {
        reportCode: slot.reportCode,
        fightId: slot.fightId,
        reportRevision: slot.reportRevision,
        datasetKey,
      },
    });
    if (count === 0) return false;
  }
  return true;
}

export class OffensiveProbeSelectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OffensiveProbeSelectionError";
  }
}

function parseOwnedPetActorIds(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is number => typeof item === "number" && Number.isFinite(item));
}

async function listWallidrixeOffensiveProbeCandidates(input: {
  region?: string;
  realmSlug?: string;
  characterName?: string;
  requirePersistedPages?: boolean;
}): Promise<OffensiveProbeFightSelection[]> {
  const env = loadEnv();
  const prisma = createPrismaClient(env.DATABASE_URL);
  const region = (input.region ?? "EU").toUpperCase();
  const realmSlug = normalizeRealmSlug(input.realmSlug ?? "archimonde");
  const characterName = input.characterName ?? "Wallidrixe";
  const normalizedName = normalizeName(characterName);
  const requirePersistedPages = input.requirePersistedPages ?? true;

  try {
    const character = await prisma.character.findFirst({
      where: {
        normalizedName,
        region: { code: region },
        realm: { slug: realmSlug },
      },
      select: {
        id: true,
        gameClass: { select: { slug: true } },
        activeSpec: { select: { slug: true } },
      },
    });
    if (!character) {
      throw new OffensiveProbeSelectionError(
        `No character row for ${region}/${realmSlug}/${characterName}`,
      );
    }

    const manifest = await prisma.evidenceManifest.findFirst({
      where: { characterId: character.id },
      orderBy: { frozenAt: "desc" },
      include: {
        slots: {
          where: { state: "SELECTED" },
          orderBy: { slotIndex: "asc" },
          include: {
            dungeon: { select: { slug: true } },
          },
        },
      },
    });
    if (!manifest) {
      throw new OffensiveProbeSelectionError(
        `No EvidenceManifest found for ${region}/${realmSlug}/${characterName}`,
      );
    }

    const candidates: OffensiveProbeFightSelection[] = [];
    for (const slot of manifest.slots) {
      if (!slot.reportCode || slot.fightId == null || slot.reportRevision == null) continue;
      if (requirePersistedPages && !(await slotHasCompletePersistedPages(prisma, slot))) continue;

      const digest = await prisma.wclRunSourceDigest.findUnique({
        where: {
          reportCode_fightId_reportRevision: {
            reportCode: slot.reportCode,
            fightId: slot.fightId,
            reportRevision: slot.reportRevision,
          },
        },
        include: {
          participants: {
            where: {
              characterName: { equals: characterName, mode: "insensitive" },
              realmSlug,
              regionCode: region,
            },
          },
        },
      });
      if (!digest) continue;

      const participant = digest.participants[0];
      if (!participant) continue;

      const reportRevisionRow = await prisma.wclReportRevision.findUnique({
        where: {
          reportCode_revision: {
            reportCode: slot.reportCode,
            revision: slot.reportRevision,
          },
        },
        select: { startTimeMs: true, endTimeMs: true },
      });

      if (!reportRevisionRow) continue;
      const fightStartMs = Number(reportRevisionRow.startTimeMs);
      const fightEndMs =
        reportRevisionRow.endTimeMs != null
          ? Number(reportRevisionRow.endTimeMs)
          : null;
      if (!Number.isFinite(fightStartMs)) continue;

      candidates.push({
        manifestId: manifest.id,
        slotId: slot.id,
        characterId: character.id,
        reportCode: slot.reportCode,
        fightId: slot.fightId,
        reportRevision: slot.reportRevision,
        dungeonSlug: slot.dungeon.slug ?? digest.dungeonSlug ?? null,
        keyLevel: slot.keyLevel ?? digest.keyLevel ?? null,
        playerActorId: participant.wclActorId,
        ownedPetActorIds: parseOwnedPetActorIds(participant.ownedPetActorIds),
        fightStartMs,
        fightEndMs,
        classSlug: participant.classSlug ?? character.gameClass?.slug ?? "warlock",
        specSlug: participant.specSlug ?? character.activeSpec?.slug ?? "demonology",
      });
    }

    if (candidates.length === 0) {
      throw new OffensiveProbeSelectionError(
        requirePersistedPages
          ? `No SELECTED manifest slot with complete persisted Casts/Buffs/CombatantInfo/masterData for ${region}/${realmSlug}/${characterName}`
          : `No SELECTED manifest slot with digest participant for ${region}/${realmSlug}/${characterName}`,
      );
    }
    return candidates;
  } finally {
    await prisma.$disconnect();
  }
}

async function loadPersistedProbeData(selection: OffensiveProbeFightSelection): Promise<{
  selection: OffensiveProbeFightSelection;
  casts: Array<Record<string, unknown>>;
  buffs: Array<Record<string, unknown>>;
  storageSchemesRead: string[];
  participants: Array<{
    playerActorId: number;
    characterName: string;
    classSlug: string | null;
    specSlug: string | null;
    role: AbilityRole | null;
    ownedPetActorIds: number[];
  }>;
}> {
  const env = loadEnv();
  const prisma = createPrismaClient(env.DATABASE_URL);
  const { artifacts } = createRepositories(prisma, {
    rawArtifactsDir: env.RAW_ARTIFACTS_DIR,
  });
  const artifactIdsRead = new Set<string>();
  const readArtifactBytes = async (artifactId: string) => {
    artifactIdsRead.add(artifactId);
    return artifacts.readVerified(artifactId);
  };

  try {
    const masterPage = await prisma.evidenceDatasetPage.findFirst({
      where: {
        reportCode: selection.reportCode,
        fightId: selection.fightId,
        reportRevision: selection.reportRevision,
        datasetKey: "masterData",
      },
      orderBy: { pageIndex: "asc" },
    });
    if (!masterPage) {
      throw new OffensiveProbeSelectionError(
        `masterData pages missing for ${selection.reportCode}:${selection.fightId}`,
      );
    }

    const masterBytes = await readArtifactBytes(masterPage.artifactId);
    const masterEnvelope = JSON.parse(masterBytes.toString("utf8")) as {
      events?: Array<{ __masterData?: boolean; masterData?: unknown }>;
    };
    const masterData = masterEnvelope.events?.[0]?.masterData;
    let fightTimes;
    try {
      fightTimes = resolvePersistedFightWindow(masterData, selection);
    } catch (error) {
      throw new OffensiveProbeSelectionError(
        error instanceof Error ? error.message : String(error),
      );
    }

    const resolvedSelection: OffensiveProbeFightSelection = {
      ...selection,
      fightStartMs: fightTimes.fightStartMs,
      fightEndMs: fightTimes.fightEndMs,
      classSlug: normalizeRetailClassSlug(selection.classSlug),
    };

    const loadDataset = async (datasetKey: "Casts" | "Buffs" | "CombatantInfo") => {
      const pages = await prisma.evidenceDatasetPage.findMany({
        where: {
          reportCode: selection.reportCode,
          fightId: selection.fightId,
          reportRevision: selection.reportRevision,
          datasetKey,
        },
        orderBy: { pageIndex: "asc" },
      });
      const events: Array<Record<string, unknown>> = [];
      for (const page of pages) {
        const bytes = await readArtifactBytes(page.artifactId);
        const envelope = JSON.parse(bytes.toString("utf8")) as {
          events?: Array<Record<string, unknown>>;
        };
        events.push(...(envelope.events ?? []));
      }
      return events;
    };

    const digest = await prisma.wclRunSourceDigest.findUnique({
      where: {
        reportCode_fightId_reportRevision: {
          reportCode: selection.reportCode,
          fightId: selection.fightId,
          reportRevision: selection.reportRevision,
        },
      },
      include: { participants: { orderBy: { wclActorId: "asc" } } },
    });
    if (!digest || digest.participants.length === 0) {
      throw new OffensiveProbeSelectionError(
        `No digest participants for ${selection.reportCode}:${selection.fightId}:r${selection.reportRevision}`,
      );
    }

    const combatantEvents = await loadDataset("CombatantInfo");
    const specByActor = new Map<number, ReturnType<typeof findRetailSpecIdentityByBlizzardSpecId>>();
    for (const row of combatantEvents) {
      const sourceId =
        typeof row.sourceID === "number"
          ? row.sourceID
          : typeof (row.source as { id?: unknown } | undefined)?.id === "number"
            ? ((row.source as { id: number }).id)
            : null;
      const specId =
        typeof row.specID === "number"
          ? row.specID
          : typeof row.specId === "number"
            ? row.specId
            : null;
      if (sourceId == null || specId == null) continue;
      const identity = findRetailSpecIdentityByBlizzardSpecId(specId);
      if (identity) specByActor.set(sourceId, identity);
    }

    const participants = digest.participants.map((participant) => {
      const fromCombatant = specByActor.get(participant.wclActorId) ?? null;
      const classSlug =
        normalizeRetailClassSlug(participant.classSlug) ??
        fromCombatant?.classSlug ??
        null;
      const specSlug = participant.specSlug ?? fromCombatant?.specSlug ?? null;
      const role =
        (participant.role as AbilityRole | null | undefined) ??
        fromCombatant?.role ??
        null;
      return {
        playerActorId: participant.wclActorId,
        characterName: participant.characterName,
        classSlug,
        specSlug,
        role,
        ownedPetActorIds: parseOwnedPetActorIds(participant.ownedPetActorIds),
      };
    });

    const storageUris = await artifacts.getStorageUris([...artifactIdsRead]);
    const storageSchemesRead = [
      ...new Set(
        [...storageUris.values()].map((uri) => {
          if (uri.startsWith("pg://")) return "pg";
          if (uri.startsWith("cas://")) return "cas";
          return uri.split("://")[0] ?? "unknown";
        }),
      ),
    ].sort();

    return {
      selection: {
        ...resolvedSelection,
        classSlug:
          normalizeRetailClassSlug(resolvedSelection.classSlug) ??
          participants.find((p) => p.playerActorId === resolvedSelection.playerActorId)
            ?.classSlug ??
          resolvedSelection.classSlug,
        specSlug:
          resolvedSelection.specSlug ??
          participants.find((p) => p.playerActorId === resolvedSelection.playerActorId)
            ?.specSlug ??
          null,
      },
      casts: await loadDataset("Casts"),
      buffs: await loadDataset("Buffs"),
      storageSchemesRead,
      participants,
    };
  } finally {
    await prisma.$disconnect();
  }
}

function parseArgs(argv: string[]): {
  region: string;
  realmSlug: string;
  characterName: string;
  outputRoot: string;
} {
  const flags: Record<string, string> = {};
  const bools = new Set<string>();
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg?.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      bools.add(key);
      continue;
    }
    flags[key] = next;
    i += 1;
  }
  return {
    region: flags.region ?? "EU",
    realmSlug: flags.realm ?? "archimonde",
    characterName: flags.name ?? "Wallidrixe",
    outputRoot:
      flags["output-root"]?.trim() ||
      join(process.cwd(), "artifacts", "wcl-offensive-one-fight"),
  };
}

export async function runOffensiveOneFightProbe(options?: {
  region?: string;
  realmSlug?: string;
  characterName?: string;
  outputRoot?: string;
}): Promise<{ report: OffensiveProbeReport; outputPath: string }> {
  const args = {
    region: options?.region ?? "EU",
    realmSlug: options?.realmSlug ?? "archimonde",
    characterName: options?.characterName ?? "Wallidrixe",
    outputRoot:
      options?.outputRoot ?? join(process.cwd(), "artifacts", "wcl-offensive-one-fight"),
  };

  const catalog = getAbilityCatalog({
    classSlug: "warlock",
    specSlug: "demonology",
  });

  const candidates = prioritizeOffensiveProbeCandidates(
    await listWallidrixeOffensiveProbeCandidates({
      ...args,
      requirePersistedPages: true,
    }),
    SPIKE_FIGHT,
  );
  let loaded: Awaited<ReturnType<typeof loadPersistedProbeData>> | null = null;
  const failures: OffensiveProbeCandidateLoadFailure[] = [];
  for (const candidate of candidates) {
    try {
      loaded = await loadPersistedProbeData(candidate);
      break;
    } catch (error) {
      failures.push({
        candidate: {
          reportCode: candidate.reportCode,
          fightId: candidate.fightId,
          reportRevision: candidate.reportRevision,
        },
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  if (!loaded) {
    throw new OffensiveProbeSelectionError(formatPersistedCandidateLoadFailures(failures));
  }

  const report = buildOffensiveProbeReport({
    selection: loaded.selection,
    casts: loaded.casts,
    buffs: loaded.buffs,
    catalog,
    participants: loaded.participants,
    dataLoad: {
      mode: "PERSISTED_EVIDENCE",
      datasets: [...OFFENSIVE_ONE_FIGHT_DATASETS],
      castsSource: "PERSISTED_EVIDENCE",
      buffsSource: "PERSISTED_EVIDENCE",
      storageSchemesRead: loaded.storageSchemesRead,
      totalProviderCalls: 0,
      providerCallsDuringReload: 0,
      wclRequests: 0,
    },
    eventSource: "PERSISTED_EVIDENCE",
    evidenceIntegrity: {
      totalProviderCalls: 0,
      providerCallsDuringReload: 0,
      storageSchemesRead: loaded.storageSchemesRead,
      fillersExcluded: true,
      allFiveParticipantsResolved: loaded.participants.length === 5,
      participantCount: loaded.participants.length,
    },
  });

  await mkdir(args.outputRoot, { recursive: true });
  const outputPath = join(
    args.outputRoot,
    `${report.selection.manifestId}-${report.selection.slotId}.json`,
  );
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  printOffensiveProbeSummary(report);
  console.log(`artifact=${outputPath}`);

  if (report.summary.distinctObservedSpellIds === 0) {
    throw new OffensiveProbeSelectionError(
      "Probe produced empty player/pet ability inventory",
    );
  }

  return { report, outputPath };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  await runOffensiveOneFightProbe(args);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
