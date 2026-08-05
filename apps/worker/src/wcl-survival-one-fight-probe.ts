/**
 * Provider-free WCL Survival one-fight extraction probe.
 *
 * Usage:
 *   pnpm wcl:probe:survival-one-fight
 *
 * Loads only persisted PostgreSQL evidence for the spike fight,
 * rebuilds the shared capability evidence package offline, then extracts
 * Survival timelines. Never issues live WCL requests.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  CURRENT_CATALOG_VERSION_ID,
  findRetailSpecIdentityByBlizzardSpecId,
  normalizeRetailClassSlug,
  type AbilityRole,
} from "@mplus/abilities";
import { loadEnv } from "@mplus/config";
import { createPrismaClient } from "@mplus/database";
import {
  assertSurvivalActionTimelineV1,
  hashSurvivalActionTimelinePayload,
  type SurvivalActionTimelineV1,
} from "@mplus/contracts";
import {
  buildSurvivalProbePrintSummary,
  extractSurvivalFromCapabilityPackage,
  persistCapabilityEvidencePackage,
  rebuildCapabilityPackageFromPersistedEvents,
  sharedPackageParticipantProof,
  type SurvivalOneFightProbeReport,
  type SurvivalProbeParticipant,
  type SurvivalProbeSourceIdentity,
} from "@mplus/provider-warcraftlogs";
import {
  persistSurvivalActionTimeline,
  reloadSurvivalActionTimeline,
} from "./survival-action-timeline-persist.js";
import { createRepositories } from "./persistence/index.js";
import { selectPreferredEvidencePages } from "./orchestration/scoring-v2/persistent-shared-evidence-store.js";
import { selectUtilityCapabilityEvidencePages } from "./utility-one-fight-capability-evidence.js";

const SPIKE_FIGHT = {
  reportCode: "1WKcCz2BnAQmbhfq",
  fightId: 1,
  reportRevision: 1,
} as const;

const LOAD_DATASETS = [
  "Casts",
  "Buffs",
  "DamageTaken",
  "Deaths",
  "Debuffs",
  "Interrupts",
  "Dispels",
  "CombatantInfo",
  "masterData",
] as const;

const REQUIRED_DATASETS = ["Casts", "Buffs", "DamageTaken", "Deaths", "masterData"] as const;

export class SurvivalProbeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SurvivalProbeError";
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

function fightTimesFromMasterData(
  masterData: unknown,
  fightId: number,
): { fightStartMs: number; fightEndMs: number | null } | null {
  const root = asRecord(masterData);
  const fights = Array.isArray(root?.fights) ? root!.fights : [];
  for (const fight of fights) {
    const row = asRecord(fight);
    if (!row || row.id !== fightId) continue;
    const start =
      typeof row.startTime === "number"
        ? row.startTime
        : typeof row.start_time === "number"
          ? row.start_time
          : null;
    const end =
      typeof row.endTime === "number"
        ? row.endTime
        : typeof row.end_time === "number"
          ? row.end_time
          : null;
    if (start == null || !Number.isFinite(start)) return null;
    return {
      fightStartMs: start,
      fightEndMs: end != null && Number.isFinite(end) ? end : null,
    };
  }
  return null;
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
      join(process.cwd(), "artifacts", "wcl-survival-one-fight"),
  };
}

async function loadPersistedSurvivalEvidence(input: {
  region: string;
}): Promise<{
  source: SurvivalProbeSourceIdentity;
  participants: SurvivalProbeParticipant[];
  eventsByDataset: Partial<Record<string, Array<Record<string, unknown>>>>;
  coverageRows: Array<{
    datasetKey: string;
    pageCount: number;
    eventCount: number;
    complete: boolean;
    truncated: boolean;
    stopReason: string | null;
    coverageRatio: number | null;
  }>;
  sourceArtifactIds: string[];
  storageSchemesRead: string[];
  providerCalls: number;
}> {
  const env = loadEnv();
  const prisma = createPrismaClient(env.DATABASE_URL);
  const { artifacts } = createRepositories(prisma, {
    rawArtifactsDir: env.RAW_ARTIFACTS_DIR,
  });

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
      throw new SurvivalProbeError(
        `Missing WclRunSourceDigest for ${SPIKE_FIGHT.reportCode}:${SPIKE_FIGHT.fightId}:r${SPIKE_FIGHT.reportRevision}`,
      );
    }
    if (digest.participants.length === 0) {
      throw new SurvivalProbeError("Digest has no participants");
    }

    const eventsByDataset: Partial<Record<string, Array<Record<string, unknown>>>> = {};
    const coverageRows: Array<{
      datasetKey: string;
      pageCount: number;
      eventCount: number;
      complete: boolean;
      truncated: boolean;
      stopReason: string | null;
      coverageRatio: number | null;
    }> = [];
    const sourceArtifactIds: string[] = [];
    const storageSchemeSet = new Set<string>();
    const selectionLimitations: string[] = [];

    const noteStorageUris = (uris: Map<string, string>) => {
      for (const uri of uris.values()) {
        if (uri.startsWith("pg://")) storageSchemeSet.add("pg");
        else if (uri.startsWith("cas://")) storageSchemeSet.add("cas");
        else storageSchemeSet.add(uri.split("://")[0] ?? "unknown");
      }
    };

    for (const datasetKey of LOAD_DATASETS) {
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
        if ((REQUIRED_DATASETS as readonly string[]).includes(datasetKey)) {
          throw new SurvivalProbeError(`Missing required dataset pages for ${datasetKey}`);
        }
        coverageRows.push({
          datasetKey,
          pageCount: 0,
          eventCount: 0,
          complete: false,
          truncated: false,
          stopReason: "MISSING",
          coverageRatio: null,
        });
        continue;
      }

      const byScope = new Map<string, typeof pages>();
      for (const page of pages) {
        const list = byScope.get(page.scopeFingerprint) ?? [];
        list.push(page);
        byScope.set(page.scopeFingerprint, list);
      }

      // DamageTaken / Deaths are acquired as per-player sourceID batches.
      // Merge non-empty scopes instead of preferring an empty party-wide stub.
      const mergeActorBatches =
        datasetKey === "DamageTaken" || datasetKey === "Deaths";

      let selected: typeof pages;
      if (mergeActorBatches) {
        const nonEmptyScopes = [...byScope.values()].filter(
          (list) => list.reduce((s, p) => s + p.eventCount, 0) > 0,
        );
        const scopesToUse =
          nonEmptyScopes.length > 0 ? nonEmptyScopes : [...byScope.values()];
        selected = [];
        for (const scopePages of scopesToUse) {
          const scopeUris = await artifacts.getStorageUris(
            scopePages.map((p) => p.artifactId),
          );
          noteStorageUris(scopeUris);
          selected.push(...selectPreferredEvidencePages(scopePages, scopeUris));
        }
      } else if (
        datasetKey === "Casts" ||
        datasetKey === "Buffs" ||
        datasetKey === "Debuffs" ||
        datasetKey === "Interrupts" ||
        datasetKey === "Dispels" ||
        datasetKey === "CombatantInfo"
      ) {
        const scopeSelection = selectUtilityCapabilityEvidencePages({
          datasetKey,
          pages,
        });
        selectionLimitations.push(...scopeSelection.limitations);
        const storageUris = await artifacts.getStorageUris(
          scopeSelection.pages.map((p) => p.artifactId),
        );
        noteStorageUris(storageUris);
        // Prefer pg:// within each scope. Do not collapse ability-filter batches
        // that share pageIndex 0 across different filter scopes.
        selected = [];
        for (const scope of scopeSelection.scopeFingerprints) {
          const inScope = scopeSelection.pages.filter((p) => p.scopeFingerprint === scope);
          selected.push(...selectPreferredEvidencePages(inScope, storageUris));
        }
        if (selected.length === 0 && scopeSelection.pages.length > 0) {
          selected.push(...selectPreferredEvidencePages(scopeSelection.pages, storageUris));
        }
      } else {
        const scopedPages =
          [...byScope.entries()]
            .sort(([aKey, aPages], [bKey, bPages]) => {
              const aEvents = aPages.reduce((s, p) => s + p.eventCount, 0);
              const bEvents = bPages.reduce((s, p) => s + p.eventCount, 0);
              if (aEvents !== bEvents) return bEvents - aEvents;
              const aAll = aKey.includes("|a:all|") ? 1 : 0;
              const bAll = bKey.includes("|a:all|") ? 1 : 0;
              if (aAll !== bAll) return bAll - aAll;
              return bPages.length - aPages.length;
            })
            .map(([, list]) => list)[0] ?? pages;
        const storageUris = await artifacts.getStorageUris(
          scopedPages.map((p) => p.artifactId),
        );
        noteStorageUris(storageUris);
        selected = selectPreferredEvidencePages(scopedPages, storageUris);
      }

      const events: Array<Record<string, unknown>> = [];
      let complete = true;
      let truncated = false;
      let stopReason: string | null = null;
      let coverageRatio: number | null = null;
      let metaSeen = false;

      for (const page of selected) {
        sourceArtifactIds.push(page.artifactId);
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
        if (!metaSeen && envelope.datasetMeta?.pagination) {
          metaSeen = true;
          const meta = envelope.datasetMeta;
          complete = meta.pagination?.complete === true;
          truncated = meta.truncated === true;
          stopReason = meta.pagination?.stopReason ?? null;
          coverageRatio = meta.pagination?.coverageRatio ?? null;
        }
        if (envelope.datasetMeta?.pagination?.complete === false) {
          complete = false;
        }
        if (envelope.datasetMeta?.truncated === true) truncated = true;
      }

      if (datasetKey !== "masterData") {
        // Actor-batch merges and ability-filter batch merges can repeat events.
        const shouldDedupe =
          mergeActorBatches || datasetKey === "Casts" || datasetKey === "Buffs";
        if (shouldDedupe) {
          const seen = new Set<string>();
          const deduped: Array<Record<string, unknown>> = [];
          for (const row of events) {
            const source = row.source as { id?: number } | undefined;
            const target = row.target as { id?: number } | undefined;
            const ability = row.ability as { guid?: number; id?: number } | undefined;
            const ts = row.timestamp ?? row.timestampMs ?? "";
            const src = row.sourceID ?? source?.id ?? "";
            const tgt = row.targetID ?? target?.id ?? "";
            const ab = row.abilityGameID ?? ability?.guid ?? ability?.id ?? "";
            const amt = row.amount ?? "";
            const typ = row.type ?? "";
            const key = `${ts}|${src}|${tgt}|${ab}|${amt}|${typ}`;
            if (seen.has(key)) continue;
            seen.add(key);
            deduped.push(row);
          }
          eventsByDataset[datasetKey] = deduped;
        } else {
          eventsByDataset[datasetKey] = events;
        }
      }

      const storedEvents =
        datasetKey === "masterData"
          ? eventsByDataset.masterData
          : eventsByDataset[datasetKey];

      let effectiveComplete =
        datasetKey === "masterData" ? eventsByDataset.masterData != null : complete;
      let effectiveStop = stopReason;
      if (
        (datasetKey === "Casts" || datasetKey === "Buffs") &&
        selectionLimitations.some((l) =>
          l.includes(`FALLBACK_LEGACY_UNFILTERED:${datasetKey}`),
        )
      ) {
        effectiveComplete = false;
        effectiveStop = effectiveStop ?? "LEGACY_UNFILTERED_FALLBACK";
      }

      coverageRows.push({
        datasetKey,
        pageCount: selected.length,
        eventCount:
          datasetKey === "masterData"
            ? storedEvents
              ? 1
              : 0
            : (storedEvents?.length ?? 0),
        complete: effectiveComplete,
        truncated,
        stopReason: effectiveStop,
        coverageRatio,
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
    const fightTimesFromMaster = fightTimesFromMasterData(masterData, SPIKE_FIGHT.fightId);

    let fightStartMs =
      fightTimesFromMaster?.fightStartMs ??
      (reportRevisionRow != null ? Number(reportRevisionRow.startTimeMs) : NaN);
    let fightEndMs =
      fightTimesFromMaster?.fightEndMs ??
      (reportRevisionRow?.endTimeMs != null ? Number(reportRevisionRow.endTimeMs) : null);

    if (!Number.isFinite(fightStartMs) || fightTimesFromMaster == null) {
      for (const datasetKey of ["DamageTaken", "Casts", "Buffs"] as const) {
        const page0 = await prisma.evidenceDatasetPage.findFirst({
          where: {
            reportCode: SPIKE_FIGHT.reportCode,
            fightId: SPIKE_FIGHT.fightId,
            reportRevision: SPIKE_FIGHT.reportRevision,
            datasetKey,
            pageIndex: 0,
          },
        });
        if (!page0) continue;
        try {
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
            fightStartMs = start;
            if (typeof end === "number" && Number.isFinite(end)) fightEndMs = end;
            break;
          }
        } catch {
          // keep prior candidate
        }
      }
    }

    if (!Number.isFinite(fightStartMs)) {
      throw new SurvivalProbeError(
        "Could not resolve fight times from masterData, WclReportRevision, or page meta",
      );
    }

    const combatantEvents = eventsByDataset.CombatantInfo ?? [];
    const specByActor = new Map<
      number,
      ReturnType<typeof findRetailSpecIdentityByBlizzardSpecId>
    >();
    for (const row of combatantEvents) {
      const sourceId =
        typeof row.sourceID === "number"
          ? row.sourceID
          : typeof (row.source as { id?: unknown } | undefined)?.id === "number"
            ? (row.source as { id: number }).id
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

    const participants: SurvivalProbeParticipant[] = digest.participants
      .slice(0, 5)
      .map((p) => {
        const fromCombatant = specByActor.get(p.wclActorId) ?? null;
        const classSlug =
          normalizeRetailClassSlug(p.classSlug) ?? fromCombatant?.classSlug ?? null;
        const specSlug = p.specSlug ?? fromCombatant?.specSlug ?? null;
        const role =
          (p.role as AbilityRole | null | undefined) ?? fromCombatant?.role ?? null;
        return {
          playerActorId: p.wclActorId,
          characterName: p.characterName,
          realmSlug: p.realmSlug,
          regionCode: p.regionCode,
          classSlug,
          specSlug,
          role,
          ownedPetActorIds: parseOwnedPetActorIds(p.ownedPetActorIds),
        };
      });

    if (participants.length !== 5) {
      throw new SurvivalProbeError(
        `Expected 5 friendly participants, got ${participants.length}`,
      );
    }

    const source: SurvivalProbeSourceIdentity = {
      reportCode: SPIKE_FIGHT.reportCode,
      fightId: SPIKE_FIGHT.fightId,
      reportRevision: SPIKE_FIGHT.reportRevision,
      dungeonSlug: digest.dungeonSlug,
      keyLevel: digest.keyLevel,
      fightStartMs,
      fightEndMs,
      region: input.region,
    };

    return {
      source,
      participants,
      eventsByDataset,
      coverageRows,
      sourceArtifactIds: [...new Set(sourceArtifactIds)],
      storageSchemesRead: [...storageSchemeSet].sort(),
      providerCalls: 0,
    };
  } finally {
    await prisma.$disconnect();
  }
}

function compactDiagnostic(report: SurvivalOneFightProbeReport): Record<string, unknown> {
  const t = report.timeline;
  return {
    schemaVersion: report.schemaVersion,
    generatedAt: report.generatedAt,
    sourceIdentity: report.sourceIdentity,
    providerCallsDuringProbe: report.providerCallsDuringProbe,
    providerCallsDuringReload: report.providerCallsDuringReload,
    persistence: report.persistence,
    storageSchemesRead: report.storageSchemesRead,
    capabilityEvidencePackageContentHash: t.capabilityEvidencePackageContentHash,
    capabilityEvidencePackageArtifactId: t.capabilityEvidencePackageArtifactId,
    rawVersusDeduplicated: {
      rawDefensiveEventCount: t.rawDefensiveEventCount,
      canonicalPersonalDefensiveCount: t.canonicalPersonalDefensiveCount,
      rawRecoveryEventCount: t.rawRecoveryEventCount,
      canonicalRecoveryCount: t.canonicalRecoveryCount,
      externalDefensiveReceivedCount: t.externalDefensiveReceivedCount,
    },
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
      specSlug: p.specSlug,
      damageTakenTotal: p.damageTakenTotal,
      damageTakenEventCount: p.damageTakenEventCount,
      deathCount: p.deathCount,
      rawDefensiveEventCount: p.rawDefensiveEventCount,
      canonicalPersonalDefensiveCount: p.canonicalPersonalDefensiveCount,
      rawRecoveryEventCount: p.rawRecoveryEventCount,
      canonicalRecoveryCount: p.canonicalRecoveryCount,
      externalDefensiveReceivedCount: p.externalDefensiveReceivedCount,
      pressureWindowCount: p.pressureWindowCount,
      sustainedPressureCount: p.sustainedPressureCount,
      isolatedDamageCount: p.isolatedDamageCount,
      noResponseWindowCount: p.noResponseWindowCount,
      petAttributedActivationCount: p.petAttributedActivationCount,
      capabilityEvidencePackageContentHash: p.capabilityEvidencePackageContentHash,
      limitations: p.limitations,
    })),
    deaths: t.deaths,
    activations: t.activations.map((a) => ({
      canonicalActivationId: a.canonicalActivationId,
      abilityKey: a.abilityKey,
      canonicalName: a.canonicalName,
      activationKind: a.activationKind,
      defensiveCategory: a.defensiveCategory,
      participantActorId: a.participantActorId,
      casterActorId: a.casterActorId,
      recipientActorId: a.recipientActorId,
      casterCharacterName: a.casterCharacterName,
      recipientCharacterName: a.recipientCharacterName,
      activationSource: a.activationSource,
      evidenceEventTypes: a.evidenceEventTypes,
      fightOffsetMs: a.fightOffsetMs,
      attributedToPet: a.attributedToPet,
      creditsSurvivalUsageToRecipient: a.creditsSurvivalUsageToRecipient,
      creditsCasterForUtility: a.creditsCasterForUtility,
      relatedPressureWindowId: a.relatedPressureWindowId,
      responseRelation: a.responseRelation,
      limitations: a.limitations,
    })),
    pressureWindows: t.pressureWindows.map((w) => ({
      pressureWindowId: w.pressureWindowId,
      participantActorId: w.participantActorId,
      characterName: w.characterName,
      windowClass: w.windowClass,
      derivation: w.derivation,
      response: w.response,
      limitations: w.limitations,
    })),
    survivalCatalogGapSummary: t.survivalCatalogGapSummary.slice(0, 40),
    limitations: t.limitations,
    catalogVersion: t.catalogVersion,
    pressureConfigVersion: t.pressureConfigVersion,
    contentHash: t.contentHash,
  };
}

export async function runSurvivalOneFightProbe(options?: {
  region?: string;
  outputRoot?: string;
}): Promise<{ report: SurvivalOneFightProbeReport; outputPath: string }> {
  const args = {
    region: options?.region ?? "EU",
    outputRoot:
      options?.outputRoot ?? join(process.cwd(), "artifacts", "wcl-survival-one-fight"),
  };

  const loaded = await loadPersistedSurvivalEvidence({ region: args.region });
  if (loaded.providerCalls !== 0) {
    throw new SurvivalProbeError(
      `Expected providerCallsDuringProbe=0 during load, got ${loaded.providerCalls}`,
    );
  }

  const rebuilt = rebuildCapabilityPackageFromPersistedEvents({
    source: loaded.source,
    participants: loaded.participants,
    bundle: {
      eventsByDataset: loaded.eventsByDataset,
      coverageRows: loaded.coverageRows,
    },
    catalogVersion: CURRENT_CATALOG_VERSION_ID,
    sourceArtifactIds: loaded.sourceArtifactIds,
  });
  if (rebuilt.providerCalls !== 0) {
    throw new SurvivalProbeError("Capability package rebuild must not call providers");
  }

  const packageProof = sharedPackageParticipantProof(
    rebuilt.package,
    loaded.participants,
  );
  if (!packageProof.allSamePackage) {
    throw new SurvivalProbeError(
      "All five participants must reference the same shared capability evidence package",
    );
  }

  const extracted = extractSurvivalFromCapabilityPackage({
    source: loaded.source,
    participants: loaded.participants,
    capabilityPackage: rebuilt.package,
    catalogVersion: CURRENT_CATALOG_VERSION_ID,
  });
  if (extracted.providerCallsDuringExtract !== 0) {
    throw new SurvivalProbeError("Extraction must not call providers");
  }

  const env = loadEnv();
  const prisma = createPrismaClient(env.DATABASE_URL);
  const { artifacts } = createRepositories(prisma, {
    rawArtifactsDir: env.RAW_ARTIFACTS_DIR,
  });

  try {
    const persistedPackage = await persistCapabilityEvidencePackage({
      artifacts,
      package: rebuilt.package,
    });
    if (persistedPackage.providerCallsDuringPersist !== 0) {
      throw new SurvivalProbeError("Capability package persist must not call providers");
    }

    const timelineWithPackageId: SurvivalActionTimelineV1 = {
      ...extracted.timeline,
      capabilityEvidencePackageArtifactId: persistedPackage.packageArtifactId,
    };
    const withoutHash = { ...timelineWithPackageId };
    delete (withoutHash as { contentHash?: string }).contentHash;
    timelineWithPackageId.contentHash = hashSurvivalActionTimelinePayload(withoutHash);

    const persisted = await persistSurvivalActionTimeline({
      artifacts,
      timeline: timelineWithPackageId,
    });
    if (persisted.providerCallsDuringPersist !== 0) {
      throw new SurvivalProbeError("Persist must not call providers");
    }
    if (!persisted.storageUri.startsWith("pg://")) {
      throw new SurvivalProbeError(
        `Expected pg:// survival timeline artifact, got ${persisted.storageUri}`,
      );
    }

    const reloaded = await reloadSurvivalActionTimeline({
      artifacts,
      artifactId: persisted.artifactId,
    });
    if (reloaded.providerCallsDuringReload !== 0) {
      throw new SurvivalProbeError("Reload must use zero provider calls");
    }

    const reloadedTimeline = assertSurvivalActionTimelineV1(reloaded.timeline);
    if (reloadedTimeline.contentHash !== timelineWithPackageId.contentHash) {
      throw new SurvivalProbeError(
        `Reload contentHash mismatch: ${reloadedTimeline.contentHash} vs ${timelineWithPackageId.contentHash}`,
      );
    }

    const allSame =
      timelineWithPackageId.participants.every(
        (p) =>
          p.capabilityEvidencePackageContentHash ===
          timelineWithPackageId.capabilityEvidencePackageContentHash,
      ) && packageProof.allSamePackage;

    const report: SurvivalOneFightProbeReport = {
      schemaVersion: "wcl-survival-one-fight-v1",
      generatedAt: new Date().toISOString(),
      sourceIdentity: loaded.source,
      timeline: timelineWithPackageId,
      persistence: {
        mode: "POSTGRES_ROUND_TRIP",
        artifactId: persisted.artifactId,
        contentHash: timelineWithPackageId.contentHash,
        storageUriScheme: "pg",
        providerCallsDuringProbe: 0,
        providerCallsDuringReload: 0,
        reloadedContentHash: reloadedTimeline.contentHash,
        reloadMatched: true,
        sharedEvidencePackageContentHash:
          timelineWithPackageId.capabilityEvidencePackageContentHash,
        allParticipantsSamePackage: allSame,
      },
      providerCallsDuringProbe: 0,
      providerCallsDuringReload: 0,
      storageSchemesRead: loaded.storageSchemesRead,
    };

    await mkdir(args.outputRoot, { recursive: true });
    const runKey = `${SPIKE_FIGHT.reportCode}-${SPIKE_FIGHT.fightId}-r${SPIKE_FIGHT.reportRevision}`;
    const outputPath = join(args.outputRoot, `${runKey}.survival-probe.json`);
    await writeFile(
      outputPath,
      `${JSON.stringify(compactDiagnostic(report), null, 2)}\n`,
      "utf8",
    );

    console.log(buildSurvivalProbePrintSummary(timelineWithPackageId));
    console.log(
      `participants=${loaded.participants
        .map(
          (p) =>
            `${p.characterName}:${p.classSlug ?? "?"}/${p.specSlug ?? "?"}/${p.role ?? "?"}`,
        )
        .join(",")}`,
    );
    console.log(`storageSchemesRead=${loaded.storageSchemesRead.join(",") || "none"}`);
    console.log(`providerCallsDuringProbe=${report.providerCallsDuringProbe}`);
    console.log(`providerCallsDuringReload=${report.providerCallsDuringReload}`);
    console.log(`allParticipantsSamePackage=${allSame}`);
    console.log(`artifact=${outputPath}`);
    console.log(`persistedArtifactId=${persisted.artifactId}`);
    console.log(`capabilityPackageArtifactId=${persistedPackage.packageArtifactId}`);

    return { report, outputPath };
  } finally {
    await prisma.$disconnect();
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  await runSurvivalOneFightProbe(args);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
