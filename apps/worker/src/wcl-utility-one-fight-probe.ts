/**
 * Provider-free WCL Utility one-fight extraction probe.
 *
 * Usage:
 *   pnpm wcl:probe:utility-one-fight
 *
 * Loads only persisted PostgreSQL evidence for the spike fight.
 * Never issues live WCL requests.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { CURRENT_CATALOG_VERSION_ID } from "@mplus/abilities";
import { loadEnv } from "@mplus/config";
import { createPrismaClient } from "@mplus/database";
import {
  assertUtilityActionTimelineV1,
  type UtilityActionTimelineV1,
} from "@mplus/contracts";
import {
  buildUtilityProbePrintSummary,
  extractUtilityActionTimeline,
  UTILITY_PROBE_REQUIRED_DATASETS,
  type UtilityDatasetCoverageRow,
  type UtilityOneFightProbeReport,
  type UtilityOneFightDataset,
  type UtilityProbeParticipant,
  type UtilityProbeSourceIdentity,
} from "@mplus/provider-warcraftlogs";
import {
  persistUtilityActionTimeline,
  reloadUtilityActionTimeline,
} from "./utility-action-timeline-persist.js";
import { createRepositories } from "./persistence/index.js";
import { selectPreferredEvidencePages } from "./orchestration/scoring-v2/persistent-shared-evidence-store.js";
import { resolvePersistedFightWindow } from "./offensive-one-fight-probe-persist.js";
import { selectUtilityCapabilityEvidencePages } from "./utility-one-fight-capability-evidence.js";

const SPIKE_FIGHT = {
  reportCode: "1WKcCz2BnAQmbhfq",
  fightId: 1,
  reportRevision: 1,
} as const;

const ALL_LOAD_DATASETS: UtilityOneFightDataset[] = [
  "Casts",
  "Buffs",
  "Interrupts",
  "Dispels",
  "Debuffs",
  "Deaths",
  "CombatantInfo",
  "masterData",
];

export class UtilityProbeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UtilityProbeError";
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function parseOwnedPetActorIds(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is number => typeof item === "number" && Number.isFinite(item));
}

function normalizeClassSlug(value: string | null): string | null {
  if (!value) return null;
  const slug = value.trim().toLowerCase();
  if (slug === "deathknight") return "death-knight";
  if (slug === "demonhunter") return "demon-hunter";
  return slug;
}

function parseArgs(argv: string[]): { outputRoot: string; region: string } {
  const flags: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg?.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) continue;
    flags[key] = next;
    i += 1;
  }
  return {
    region: flags.region ?? "EU",
    outputRoot:
      flags["output-root"]?.trim() ||
      join(process.cwd(), "artifacts", "wcl-utility-one-fight"),
  };
}

async function loadPersistedUtilityEvidence(input: {
  region: string;
}): Promise<{
  source: UtilityProbeSourceIdentity;
  participants: UtilityProbeParticipant[];
  eventsByDataset: Partial<Record<string, Array<Record<string, unknown>>>>;
  coverage: UtilityDatasetCoverageRow[];
  storageSchemesRead: string[];
  providerCalls: number;
}> {
  const env = loadEnv();
  const prisma = createPrismaClient(env.DATABASE_URL);
  const { artifacts } = createRepositories(prisma, {
    rawArtifactsDir: env.RAW_ARTIFACTS_DIR,
  });
  const artifactIdsRead = new Set<string>();

  try {
    const digest = await prisma.wclRunSourceDigest.findUnique({
      where: {
        reportCode_fightId_reportRevision: {
          reportCode: SPIKE_FIGHT.reportCode,
          fightId: SPIKE_FIGHT.fightId,
          reportRevision: SPIKE_FIGHT.reportRevision,
        },
      },
      include: { participants: { orderBy: { wclActorId: "asc" } } },
    });
    if (!digest) {
      throw new UtilityProbeError(
        `Missing WclRunSourceDigest for ${SPIKE_FIGHT.reportCode}:${SPIKE_FIGHT.fightId}:r${SPIKE_FIGHT.reportRevision}`,
      );
    }
    if (digest.participants.length === 0) {
      throw new UtilityProbeError("Digest has no participants");
    }

    const eventsByDataset: Partial<Record<string, Array<Record<string, unknown>>>> = {};
    const coverage: UtilityDatasetCoverageRow[] = [];

    for (const datasetKey of ALL_LOAD_DATASETS) {
      const pages = await prisma.evidenceDatasetPage.findMany({
        where: {
          reportCode: SPIKE_FIGHT.reportCode,
          fightId: SPIKE_FIGHT.fightId,
          reportRevision: SPIKE_FIGHT.reportRevision,
          datasetKey,
        },
        orderBy: { pageIndex: "asc" },
        select: {
          artifactId: true,
          pageIndex: true,
          eventCount: true,
          scopeFingerprint: true,
        },
      });
      if (pages.length === 0) {
        if (UTILITY_PROBE_REQUIRED_DATASETS.includes(datasetKey)) {
          throw new UtilityProbeError(
            `Missing required dataset pages for ${datasetKey}`,
          );
        }
        coverage.push({
          datasetKey,
          pageCount: 0,
          eventCount: 0,
          complete: false,
          truncated: false,
          stopReason: "MISSING",
          coverageRatio: null,
          selectionKind: "EMPTY_OR_MISSING",
          scopeFingerprints: [],
          selectionLimitations: [`DATASET_MISSING:${datasetKey}`],
        });
        continue;
      }

      const scopeSelection = selectUtilityCapabilityEvidencePages({
        datasetKey,
        pages,
      });
      const storageUris = await artifacts.getStorageUris(
        scopeSelection.pages.map((p) => p.artifactId),
      );
      // Prefer pg:// within each scope. Do not collapse ability-filter batches
      // that share pageIndex 0 across different filter scopes.
      const selected: typeof scopeSelection.pages = [];
      for (const scope of scopeSelection.scopeFingerprints) {
        const inScope = scopeSelection.pages.filter((p) => p.scopeFingerprint === scope);
        selected.push(...selectPreferredEvidencePages(inScope, storageUris));
      }
      if (selected.length === 0 && scopeSelection.pages.length > 0) {
        selected.push(...selectPreferredEvidencePages(scopeSelection.pages, storageUris));
      }
      const events: Array<Record<string, unknown>> = [];
      let complete = true;
      let truncated = false;
      let stopReason: string | null = null;
      let coverageRatio: number | null = null;
      let metaSeen = false;
      const batchCompleteness: boolean[] = [];

      for (const page of selected) {
        artifactIdsRead.add(page.artifactId);
        const bytes = await artifacts.readVerified(page.artifactId);
        const envelope = JSON.parse(bytes.toString("utf8")) as {
          events?: Array<Record<string, unknown>>;
          datasetMeta?: {
            truncated?: boolean;
            pagination?: {
              complete?: boolean;
              stopReason?: string | null;
              coverageRatio?: number | null;
            };
          };
        };
        if (datasetKey === "masterData") {
          const first = envelope.events?.[0] as
            | { __masterData?: boolean; masterData?: unknown }
            | undefined;
          if (first?.__masterData && first.masterData != null) {
            eventsByDataset.masterData = [
              { __masterData: true, masterData: first.masterData },
            ];
          }
        } else {
          events.push(...(envelope.events ?? []));
        }
        if (envelope.datasetMeta?.pagination) {
          const pageComplete = envelope.datasetMeta.pagination.complete === true;
          batchCompleteness.push(pageComplete);
          if (!metaSeen) {
            metaSeen = true;
            const meta = envelope.datasetMeta;
            truncated = meta.truncated === true;
            stopReason = meta.pagination?.stopReason ?? null;
            coverageRatio = meta.pagination?.coverageRatio ?? null;
          } else if (envelope.datasetMeta.truncated === true) {
            truncated = true;
          }
          if (envelope.datasetMeta.pagination.stopReason && stopReason == null) {
            stopReason = envelope.datasetMeta.pagination.stopReason;
          }
        }
      }

      // Ability-filter batches are complete only when every batch page reports complete.
      if (scopeSelection.kind === "CAPABILITY_ABILITY_FILTER_BATCHES") {
        complete =
          batchCompleteness.length > 0 && batchCompleteness.every((v) => v === true);
        if (!complete && stopReason == null) {
          stopReason = "CAPABILITY_ABILITY_FILTER_BATCH_INCOMPLETE";
        }
      } else if (metaSeen) {
        complete = batchCompleteness.every((v) => v === true) && !truncated;
      }

      if (datasetKey !== "masterData") {
        eventsByDataset[datasetKey] = events;
      }

      const selectionLimitations = [...scopeSelection.limitations];
      if (
        scopeSelection.kind === "LEGACY_UNFILTERED_PARTY" &&
        (datasetKey === "Buffs" || datasetKey === "Casts") &&
        (truncated || stopReason === "MAX_PAGES")
      ) {
        selectionLimitations.push(
          `LEGACY_STREAM_TRUNCATED:${datasetKey}:${stopReason ?? "unknown"}`,
        );
        complete = false;
      }

      coverage.push({
        datasetKey,
        pageCount: selected.length,
        eventCount:
          datasetKey === "masterData"
            ? eventsByDataset.masterData
              ? 1
              : 0
            : events.length,
        complete: datasetKey === "masterData" ? eventsByDataset.masterData != null : complete,
        truncated,
        stopReason,
        coverageRatio,
        selectionKind: scopeSelection.kind,
        scopeFingerprints: scopeSelection.scopeFingerprints,
        selectionLimitations,
      });
    }

    const reportRevisionRow = await prisma.wclReportRevision.findUnique({
      where: {
        reportCode_revision: {
          reportCode: SPIKE_FIGHT.reportCode,
          revision: SPIKE_FIGHT.reportRevision,
        },
      },
      select: { startTimeMs: true, endTimeMs: true },
    });

    const masterEnvelope = eventsByDataset.masterData?.[0];
    const masterData = asRecord(masterEnvelope)?.masterData;
    const revisionStart =
      reportRevisionRow != null ? Number(reportRevisionRow.startTimeMs) : NaN;
    const revisionEnd =
      reportRevisionRow?.endTimeMs != null ? Number(reportRevisionRow.endTimeMs) : null;

    let fightStartMs: number;
    let fightEndMs: number | null;
    try {
      const window = resolvePersistedFightWindow(masterData, {
        fightId: SPIKE_FIGHT.fightId,
        fightStartMs: Number.isFinite(revisionStart) ? revisionStart : NaN,
        fightEndMs: revisionEnd,
      });
      fightStartMs = window.fightStartMs;
      fightEndMs = window.fightEndMs;
    } catch (error) {
      // Page envelope meta as last resort (capability pages carry requested window).
      let recovered: { fightStartMs: number; fightEndMs: number | null } | null = null;
      for (const datasetKey of ["Casts", "Interrupts", "Buffs"] as const) {
        const page0 = await prisma.evidenceDatasetPage.findFirst({
          where: {
            reportCode: SPIKE_FIGHT.reportCode,
            fightId: SPIKE_FIGHT.fightId,
            reportRevision: SPIKE_FIGHT.reportRevision,
            datasetKey,
            scopeFingerprint: { contains: "|a:all|" },
            pageIndex: 0,
          },
        });
        if (!page0) continue;
        try {
          artifactIdsRead.add(page0.artifactId);
          const bytes = await artifacts.readVerified(page0.artifactId);
          const envelope = JSON.parse(bytes.toString("utf8")) as {
            datasetMeta?: {
              pagination?: {
                requestedFightStartMs?: number;
                requestedFightEndMs?: number;
              };
            };
          };
          const start = envelope.datasetMeta?.pagination?.requestedFightStartMs;
          const end = envelope.datasetMeta?.pagination?.requestedFightEndMs;
          if (typeof start === "number" && Number.isFinite(start)) {
            recovered = {
              fightStartMs: start,
              fightEndMs: typeof end === "number" && Number.isFinite(end) ? end : null,
            };
            break;
          }
        } catch {
          // keep trying
        }
      }
      if (!recovered) {
        throw new UtilityProbeError(
          error instanceof Error ? error.message : String(error),
        );
      }
      fightStartMs = recovered.fightStartMs;
      fightEndMs = recovered.fightEndMs;
    }

    const participants: UtilityProbeParticipant[] = digest.participants
      .slice(0, 5)
      .map((p) => ({
        playerActorId: p.wclActorId,
        characterName: p.characterName,
        realmSlug: p.realmSlug,
        regionCode: p.regionCode,
        classSlug: normalizeClassSlug(p.classSlug),
        specSlug: p.specSlug,
        ownedPetActorIds: parseOwnedPetActorIds(p.ownedPetActorIds),
      }));

    if (participants.length !== 5) {
      throw new UtilityProbeError(
        `Expected 5 friendly participants, got ${participants.length}`,
      );
    }

    const source: UtilityProbeSourceIdentity = {
      reportCode: SPIKE_FIGHT.reportCode,
      fightId: SPIKE_FIGHT.fightId,
      reportRevision: SPIKE_FIGHT.reportRevision,
      dungeonSlug: digest.dungeonSlug,
      keyLevel: digest.keyLevel,
      fightStartMs,
      fightEndMs,
      region: input.region,
    };

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
      source,
      participants,
      eventsByDataset,
      coverage,
      storageSchemesRead,
      providerCalls: 0,
    };
  } finally {
    await prisma.$disconnect();
  }
}

function compactDiagnostic(
  report: UtilityOneFightProbeReport,
  extras?: { storageSchemesRead?: string[] },
): Record<string, unknown> {
  const t = report.timeline;
  return {
    schemaVersion: report.schemaVersion,
    generatedAt: report.generatedAt,
    sourceIdentity: report.sourceIdentity,
    providerCallsDuringProbe: report.providerCallsDuringProbe,
    providerCallsDuringReload: report.providerCallsDuringReload,
    evidenceStorageSchemes: extras?.storageSchemesRead ?? [],
    persistence: report.persistence,
    rawCandidateEventCount: t.rawCandidateEventCount,
    canonicalActionCount: t.canonicalActionCount,
    countsByCategory: t.countsByCategory,
    capabilityCompleteness: t.capabilityCompleteness.map((c) => ({
      capability: c.capability,
      status: c.status,
      incompleteDatasets: c.incompleteDatasets,
      limitations: c.limitations,
    })),
    participants: t.participants.map((p) => ({
      characterName: p.characterName,
      playerActorId: p.playerActorId,
      classSlug: p.classSlug,
      rawCandidateEventCount: p.rawCandidateEventCount,
      canonicalActionCount: p.canonicalActionCount,
      countsByCategory: p.countsByCategory,
      canonicalAbilityNames: p.canonicalAbilityNames,
      targets: p.targets.slice(0, 10),
      petAttributedActionCount: p.petAttributedActionCount,
      unresolvedLikelyUtilityCount: p.unresolvedLikelyUtilityCount,
      limitations: p.limitations,
    })),
    actions: t.actions.map((a) => ({
      canonicalActionId: a.canonicalActionId,
      abilityKey: a.abilityKey,
      canonicalName: a.canonicalName,
      utilityCategory: a.utilityCategory,
      ownerActorId: a.ownerActorId,
      sourceCharacterName: a.sourceCharacterName,
      targetActorId: a.targetActorId,
      targetCharacterName: a.targetCharacterName,
      sourceDataset: a.sourceDataset,
      evidenceEventTypes: a.evidenceEventTypes,
      fightOffsetMs: a.fightOffsetMs,
      attributedToPet: a.attributedToPet,
      limitations: a.limitations,
    })),
    utilityCatalogGapSummary: t.utilityCatalogGapSummary.slice(0, 30),
    unresolvedLikelyUtilityCandidates: t.unresolvedLikelyUtilityCandidates.slice(0, 30),
    datasetCoverage: t.datasetCoverage,
    limitations: t.limitations,
    catalogVersion: t.catalogVersion,
    contentHash: t.contentHash,
  };
}

export async function runUtilityOneFightProbe(options?: {
  region?: string;
  outputRoot?: string;
}): Promise<{ report: UtilityOneFightProbeReport; outputPath: string }> {
  const args = {
    region: options?.region ?? "EU",
    outputRoot:
      options?.outputRoot ?? join(process.cwd(), "artifacts", "wcl-utility-one-fight"),
  };

  const loaded = await loadPersistedUtilityEvidence({ region: args.region });
  if (loaded.providerCalls !== 0) {
    throw new UtilityProbeError(
      `Expected providerCallsDuringProbe=0 during load, got ${loaded.providerCalls}`,
    );
  }

  const extracted = extractUtilityActionTimeline({
    source: loaded.source,
    participants: loaded.participants,
    eventsByDataset: loaded.eventsByDataset,
    coverage: loaded.coverage,
    catalogVersion: CURRENT_CATALOG_VERSION_ID,
  });
  if (extracted.providerCallsDuringExtract !== 0) {
    throw new UtilityProbeError("Extraction must not call providers");
  }

  const env = loadEnv();
  const prisma = createPrismaClient(env.DATABASE_URL);
  const { artifacts } = createRepositories(prisma, {
    rawArtifactsDir: env.RAW_ARTIFACTS_DIR,
  });

  try {
    const persisted = await persistUtilityActionTimeline({
      artifacts,
      timeline: extracted.timeline,
    });
    if (persisted.providerCallsDuringPersist !== 0) {
      throw new UtilityProbeError("Persist must not call providers");
    }
    if (!persisted.storageUri.startsWith("pg://")) {
      throw new UtilityProbeError(
        `Expected pg:// utility timeline artifact, got ${persisted.storageUri}`,
      );
    }

    const reloaded = await reloadUtilityActionTimeline({
      artifacts,
      artifactId: persisted.artifactId,
    });
    if (reloaded.providerCallsDuringReload !== 0) {
      throw new UtilityProbeError("Reload must use zero provider calls");
    }

    const reloadedTimeline: UtilityActionTimelineV1 = assertUtilityActionTimelineV1(
      reloaded.timeline,
    );
    if (reloadedTimeline.contentHash !== extracted.timeline.contentHash) {
      throw new UtilityProbeError(
        `Reload contentHash mismatch: ${reloadedTimeline.contentHash} vs ${extracted.timeline.contentHash}`,
      );
    }

    const report: UtilityOneFightProbeReport = {
      schemaVersion: "wcl-utility-one-fight-v1",
      generatedAt: new Date().toISOString(),
      sourceIdentity: loaded.source,
      timeline: extracted.timeline,
      persistence: {
        mode: "POSTGRES_ROUND_TRIP",
        artifactId: persisted.artifactId,
        contentHash: extracted.timeline.contentHash,
        storageUriScheme: "pg",
        providerCallsDuringProbe: 0,
        providerCallsDuringReload: 0,
        reloadedContentHash: reloadedTimeline.contentHash,
        reloadMatched: true,
      },
      providerCallsDuringProbe: 0,
      providerCallsDuringReload: 0,
    };

    await mkdir(args.outputRoot, { recursive: true });
    const runKey = `${SPIKE_FIGHT.reportCode}-${SPIKE_FIGHT.fightId}-r${SPIKE_FIGHT.reportRevision}`;
    const outputPath = join(args.outputRoot, `${runKey}.utility-probe.json`);
    await writeFile(
      outputPath,
      `${JSON.stringify(
        compactDiagnostic(report, { storageSchemesRead: loaded.storageSchemesRead }),
        null,
        2,
      )}\n`,
      "utf8",
    );

    console.log(buildUtilityProbePrintSummary(extracted.timeline));
    console.log(
      `evidenceStorageSchemes=${loaded.storageSchemesRead.join(",") || "none"}`,
    );
    console.log(`providerCallsDuringProbe=${report.providerCallsDuringProbe}`);
    console.log(`providerCallsDuringReload=${report.providerCallsDuringReload}`);
    console.log(`artifact=${outputPath}`);
    console.log(`persistedArtifactId=${persisted.artifactId}`);

    return { report, outputPath };
  } finally {
    await prisma.$disconnect();
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  await runUtilityOneFightProbe(args);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
