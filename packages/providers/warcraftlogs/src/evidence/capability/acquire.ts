/**
 * Shared capability-scoped WCL evidence acquisition.
 * One run/revision job for all friendly participants — never five refreshes.
 */
import { CURRENT_CATALOG_VERSION_ID } from "@mplus/abilities";
import {
  CAPABILITY_ACQUISITION_PLAN_VERSION,
  CAPABILITY_EVIDENCE_PACKAGE_SCHEMA_VERSION,
  WCL_GRAPHQL_QUERY_VERSION,
  buildCapabilityEvidenceCompatibilityIdentity,
  buildCapabilityPackageCompatibilityKey,
  capabilityEvidenceCompatibilityKeyString,
  hashCapabilityEvidencePayload,
  isCapabilityCoverageComplete,
  type AcquisitionMode,
  type CapabilityCompactEvent,
  type CapabilityCoverageV1,
  type CapabilityEvidencePackageV1,
  type CapabilityPaginationStopReason,
  type EvidenceCapability,
} from "@mplus/contracts";
import type { WclGraphQlClient } from "../../client/graphql-client.js";
import { participantsFromBundleMasterData } from "../../extractors/participants/from-master-data.js";
import type { SharedEvidenceStore } from "../shared-evidence-ingest.js";
import {
  fetchSharedEventDataset,
  fetchSharedMasterData,
  isRealMasterData,
} from "../wcl-run-evidence.js";
import {
  WCL_RUN_EVIDENCE_PROVIDER_CONTRACT,
  buildSharedEvidenceCompatibilityKey,
  type SharedEvidenceDatasetKey,
  type WclRunEvidenceDataset,
} from "../wcl-run-evidence-types.js";
import {
  buildCapabilityAcquisitionPlan,
  type CapabilityFetchUnit,
} from "./acquisition-plan.js";
import {
  abilityFilterHashFromIds,
  actorSetHashFromIds,
  buildDeterministicAbilityFilterBatches,
  buildDeterministicSourceIdActorBatches,
  type FilterBatch,
} from "./filter-batching.js";
import {
  createPageProcessorState,
  processCapabilityEvidencePage,
} from "./page-processor.js";
import { extractParticipantLoadoutsFromCombatantEvents } from "./combatant-loadout.js";
import { collectProductionRelevantAbilityIds } from "./relevant-ability-ids.js";

export const CAPABILITY_ACQUISITION_MAX_PAGES = 40;

export class CapabilityEvidenceAcquisitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CapabilityEvidenceAcquisitionError";
  }
}

function mapStopReason(
  reason: string | null | undefined,
): CapabilityPaginationStopReason | null {
  if (reason == null) return null;
  const allowed: CapabilityPaginationStopReason[] = [
    "NEXT_PAGE_NULL",
    "CURSOR_REACHED_FIGHT_END",
    "MAX_PAGES",
    "NON_PROGRESSING_CURSOR",
    "EMPTY_PAGE",
    "GRAPHQL_ERROR",
    "FILTER_BATCH_FAILED",
    "MISSING_REQUIRED_BATCH",
    "FIGHT_BOUNDS_NOT_RESPECTED",
  ];
  return (allowed as string[]).includes(reason)
    ? (reason as CapabilityPaginationStopReason)
    : "GRAPHQL_ERROR";
}

function datasetFilterTag(input: {
  strategy: string;
  filterExpression: string | null;
  abilityFilterHash: string;
  actorSetHash: string;
  batchIndex?: number;
  batchCount?: number;
}): string {
  const batch =
    input.batchIndex != null && input.batchCount != null
      ? `|b${input.batchIndex}/${input.batchCount}`
      : "";
  return `cap:${input.strategy}|ab:${input.abilityFilterHash}|ac:${input.actorSetHash}${batch}|fe:${input.filterExpression ?? "none"}`;
}

async function loadOrFetchDataset(input: {
  client: WclGraphQlClient | null;
  store: SharedEvidenceStore;
  reportCode: string;
  reportRevision: number;
  fightId: number;
  dataset: SharedEvidenceDatasetKey;
  filterExpression: string | null;
  filterTag: string;
  sourceId?: number | null;
  includeResources: boolean;
  hostilityType: "Friendlies" | "Enemies" | null;
  startTime: number;
  endTime: number;
  maxPages: number;
  region?: string;
  forceRefetch?: boolean;
  localOnly?: boolean;
}): Promise<{
  dataset: WclRunEvidenceDataset;
  providerCalls: number;
  fromCache: boolean;
}> {
  const compatibilityKey = buildSharedEvidenceCompatibilityKey({
    reportCode: input.reportCode,
    reportRevision: input.reportRevision,
    fightId: input.fightId,
    actorId: input.sourceId ?? null,
    dataset: input.dataset,
    startTime: input.startTime,
    endTime: input.endTime,
    filterExpression: input.filterTag,
    providerContractVersion: WCL_RUN_EVIDENCE_PROVIDER_CONTRACT,
    payloadFingerprint: null,
  });

  if (!input.forceRefetch) {
    const persisted = await input.store.loadDataset(compatibilityKey);
    if (
      persisted &&
      (persisted.state === "OK" ||
        persisted.state === "CACHED" ||
        persisted.state === "PERSISTED") &&
      persisted.pageCount > 0
    ) {
      return {
        dataset: {
          ...persisted,
          source: "persisted",
          state: "PERSISTED",
          wclRequests: 0,
          pointsConsumed: 0,
          costSource: "measured",
        },
        providerCalls: 0,
        fromCache: true,
      };
    }
  }

  if (input.localOnly || !input.client) {
    const missing: WclRunEvidenceDataset = {
      key: input.dataset,
      state: "MISSING",
      truncated: false,
      pageCount: 0,
      eventCount: 0,
      filterSourceId: null,
      filterExpression: input.filterExpression,
      pages: [],
      events: [],
      consumers: ["survival", "utility"],
      pointsConsumed: null,
      costSource: "unknown",
      requestCostUnits: [],
      wclRequests: 0,
      fetchedAt: null,
      source: "missing",
    };
    return { dataset: missing, providerCalls: 0, fromCache: false };
  }

  const fetched = await fetchSharedEventDataset({
    client: input.client,
    reportCode: input.reportCode,
    fightId: input.fightId,
    dataset: input.dataset,
    sourceId: input.sourceId ?? null,
    filterExpression: input.filterExpression,
    hostilityType: input.hostilityType,
    includeResources: input.includeResources,
    maxPages: input.maxPages,
    region: input.region,
    startTime: input.startTime,
    endTime: input.endTime,
  });

  await input.store.saveDataset(compatibilityKey, fetched.dataset, {
    reportCode: input.reportCode,
    reportRevision: input.reportRevision,
    fightId: input.fightId,
    dataset: input.dataset,
  });

  return {
    dataset: fetched.dataset,
    providerCalls: fetched.wclRequests,
    fromCache: false,
  };
}

function mergeCoverageForCapability(input: {
  capability: EvidenceCapability;
  requiredDatasets: string[];
  filterIdentity: string;
  datasets: WclRunEvidenceDataset[];
  sourceArtifactIds: string[];
  batchMissing: boolean;
  batchFailed: boolean;
}): CapabilityCoverageV1 {
  let pageCount = 0;
  let eventCount = 0;
  let firstTimestampMs: number | null = null;
  let lastTimestampMs: number | null = null;
  let nextPageTimestamp: number | null = null;
  const limitations: string[] = [];
  let stopReason: CapabilityPaginationStopReason | null = null;
  let complete = true;

  if (input.batchMissing) {
    complete = false;
    stopReason = "MISSING_REQUIRED_BATCH";
    limitations.push("MISSING_REQUIRED_BATCH");
  }
  if (input.batchFailed) {
    complete = false;
    stopReason = "FILTER_BATCH_FAILED";
    limitations.push("FILTER_BATCH_FAILED");
  }

  for (const ds of input.datasets) {
    pageCount += ds.pageCount;
    eventCount += ds.eventCount;
    const p = ds.pagination;
    if (p?.firstEventTimestampMs != null) {
      firstTimestampMs =
        firstTimestampMs == null
          ? p.firstEventTimestampMs
          : Math.min(firstTimestampMs, p.firstEventTimestampMs);
    }
    if (p?.lastEventTimestampMs != null) {
      lastTimestampMs =
        lastTimestampMs == null
          ? p.lastEventTimestampMs
          : Math.max(lastTimestampMs, p.lastEventTimestampMs);
    }
    if (p?.nextPageTimestamp != null) {
      nextPageTimestamp = p.nextPageTimestamp;
      complete = false;
    }
    const mapped = mapStopReason(p?.stopReason ?? null);
    if (p && !p.complete) {
      complete = false;
      stopReason = mapped ?? stopReason;
      limitations.push(`DATASET_INCOMPLETE:${ds.key}:${p.stopReason}`);
    }
    if (ds.state === "MISSING" || ds.state === "ERROR") {
      complete = false;
      stopReason =
        ds.state === "ERROR" ? "GRAPHQL_ERROR" : (stopReason ?? "MISSING_REQUIRED_BATCH");
      limitations.push(`DATASET_${ds.state}:${ds.key}`);
    }
    if (ds.truncated) {
      complete = false;
      limitations.push(`DATASET_TRUNCATED:${ds.key}`);
    }
  }

  if (nextPageTimestamp != null) {
    complete = false;
  }

  return {
    capability: input.capability,
    requiredDatasets: input.requiredDatasets,
    filterIdentity: input.filterIdentity,
    pageCount,
    eventCount,
    firstTimestampMs,
    lastTimestampMs,
    nextPageTimestamp,
    stopReason,
    complete,
    limitations,
    sourceArtifactIds: input.sourceArtifactIds,
  };
}

function resolveBatchesForUnit(input: {
  unit: CapabilityFetchUnit;
  abilityIds: number[];
  actorIds: number[];
  friendlyPlayerActorIds: number[];
}): FilterBatch[] {
  switch (input.unit.filterStrategy) {
    case "CATALOG_ABILITY_AND_FRIENDLY_ACTORS":
      // Ability-only filterExpression; friendly actor scope applied client-side.
      return buildDeterministicAbilityFilterBatches({
        abilityIds: input.abilityIds,
      });
    case "FRIENDLY_DAMAGE_TAKEN":
    case "FRIENDLY_DEATHS":
      // Verified: DamageTaken/Deaths need GraphQL sourceID batches (≤5 players).
      return buildDeterministicSourceIdActorBatches({
        actorIds: input.friendlyPlayerActorIds,
      });
    case "NONE":
    case "METADATA_ONLY":
      return [
        {
          batchIndex: 0,
          batchCount: 1,
          abilityIds: [],
          sourceID: null,
          filterExpression: null,
          filterIdentity: `none|actors:${actorSetHashFromIds(input.actorIds)}`,
        },
      ];
    default:
      return [
        {
          batchIndex: 0,
          batchCount: 1,
          abilityIds: [],
          sourceID: null,
          filterExpression: null,
          filterIdentity: "none",
        },
      ];
  }
}

export async function acquireCapabilityEvidencePackage(input: {
  mode: AcquisitionMode;
  client: WclGraphQlClient | null;
  store: SharedEvidenceStore;
  reportCode: string;
  reportRevision: number;
  fightId: number;
  dungeonSlug: string;
  fightStartMs: number;
  fightEndMs: number;
  region?: string;
  capabilities?: readonly EvidenceCapability[];
  catalogVersion?: string;
  maxPagesPerDataset?: number;
  forceRefetch?: boolean;
  localOnly?: boolean;
  /** When masterData already known (tests / reuse). */
  masterData?: unknown;
  friendlyPlayerActorIds?: number[];
  ownedPetActorIds?: number[];
}): Promise<{
  package: CapabilityEvidencePackageV1;
  providerCalls: number;
  /** Raw CombatantInfo events used for roster/loadout (when fetched). */
  combatantInfoEvents: Array<Record<string, unknown>> | null;
}> {
  const catalogVersion = input.catalogVersion ?? CURRENT_CATALOG_VERSION_ID;
  const maxPages = input.maxPagesPerDataset ?? CAPABILITY_ACQUISITION_MAX_PAGES;
  const plan = buildCapabilityAcquisitionPlan({
    mode: input.mode,
    capabilities: input.capabilities,
  });

  let masterData = input.masterData ?? null;
  let providerCalls = 0;

  if (masterData == null || !isRealMasterData(masterData)) {
    if (!input.localOnly && input.client) {
      const master = await fetchSharedMasterData({
        client: input.client,
        reportCode: input.reportCode,
        fightId: input.fightId,
        region: input.region,
      });
      masterData = master.masterData;
      providerCalls += master.wclRequests;
    }
  }

  if (masterData == null || !isRealMasterData(masterData)) {
    throw new CapabilityEvidenceAcquisitionError(
      "capability_acquisition_requires_masterData",
    );
  }

  // Resolve party via CombatantInfo when needed.
  let combatantDataset: WclRunEvidenceDataset | null = null;
  const needsCombatant = plan.fetchUnits.some((u) => u.dataset === "CombatantInfo");
  if (needsCombatant) {
    const fetched = await loadOrFetchDataset({
      client: input.client,
      store: input.store,
      reportCode: input.reportCode,
      reportRevision: input.reportRevision,
      fightId: input.fightId,
      dataset: "CombatantInfo",
      filterExpression: null,
      filterTag: datasetFilterTag({
        strategy: "NONE",
        filterExpression: null,
        abilityFilterHash: "none",
        actorSetHash: "pending",
      }),
      includeResources: false,
      hostilityType: null,
      startTime: input.fightStartMs,
      endTime: input.fightEndMs,
      maxPages,
      region: input.region,
      forceRefetch: input.forceRefetch,
      localOnly: input.localOnly,
    });
    combatantDataset = fetched.dataset;
    providerCalls += fetched.providerCalls;
  }

  const stubBundle = {
    reportCode: input.reportCode,
    fightId: input.fightId,
    reportRevision: input.reportRevision,
    masterData,
    eventDatasets: {
      ...(combatantDataset ? { CombatantInfo: combatantDataset } : {}),
    },
  };
  const participants =
    input.friendlyPlayerActorIds != null && input.friendlyPlayerActorIds.length > 0
      ? input.friendlyPlayerActorIds.map((id) => ({
          playerActorId: id,
          ownedPetActorIds: input.ownedPetActorIds ?? [],
        }))
      : participantsFromBundleMasterData(
          stubBundle as never,
          (input.region ?? "EU").toUpperCase(),
        );

  const friendlyPlayerActorIds = participants.map((p) => p.playerActorId).slice(0, 5);
  if (friendlyPlayerActorIds.length === 0) {
    throw new CapabilityEvidenceAcquisitionError(
      "capability_acquisition_requires_friendly_players",
    );
  }

  const ownedPetActorIds =
    input.ownedPetActorIds ??
    participants.flatMap((p) => ("ownedPetActorIds" in p ? p.ownedPetActorIds : []));
  const actorIds = [...new Set([...friendlyPlayerActorIds, ...ownedPetActorIds])];
  const actorSetHash = actorSetHashFromIds(actorIds);
  const ownerByActor = new Map<number, number>();
  for (const p of participants) {
    const pets = "ownedPetActorIds" in p ? p.ownedPetActorIds : [];
    for (const petId of pets) ownerByActor.set(petId, p.playerActorId);
  }

  const abilityIds =
    input.mode === "PRODUCTION_CAPABILITY_ACQUISITION"
      ? collectProductionRelevantAbilityIds()
      : [];
  const abilityFilterHash =
    input.mode === "PRODUCTION_CAPABILITY_ACQUISITION"
      ? abilityFilterHashFromIds(abilityIds)
      : "probe-unfiltered";
  const relevantAbilityIdSet = new Set(abilityIds);

  const processor = createPageProcessorState();
  const participantLoadouts: Array<{
    actorId: number;
    blizzardSpecId: number | null;
    talentSpellIds: number[];
    talentTreeNodeIds: number[];
    evidenceState: "PRESENT" | "ABSENT" | "UNPARSEABLE";
  }> = [];
  const verifiedFilters: CapabilityEvidencePackageV1["verifiedFilters"] = [];
  const datasetsByCapability = new Map<EvidenceCapability, WclRunEvidenceDataset[]>();
  const filterIdentityByCapability = new Map<EvidenceCapability, string>();
  const requiredDatasetsByCapability = new Map<EvidenceCapability, string[]>();
  let batchMissing = false;
  let batchFailed = false;
  let filterBatchCount = 0;
  let pagesFetched = 0;
  const sourceArtifactIds: string[] = [];

  for (const e of plan.entries) {
    requiredDatasetsByCapability.set(
      e.capability,
      e.datasets.map((d) => d.dataset),
    );
  }

  for (const unit of plan.fetchUnits) {
    if (unit.dataset === "masterData") {
      for (const cap of unit.capabilities) {
        const list = datasetsByCapability.get(cap) ?? [];
        list.push({
          key: "masterData",
          state: "OK",
          truncated: false,
          pageCount: 1,
          eventCount: 1,
          filterSourceId: null,
          filterExpression: null,
          pages: [],
          events: [],
          consumers: ["survival", "utility"],
          pointsConsumed: 0,
          costSource: "measured",
          requestCostUnits: [],
          wclRequests: 0,
          fetchedAt: new Date().toISOString(),
          source: "provider",
          pagination: {
            requestedFightStartMs: input.fightStartMs,
            requestedFightEndMs: input.fightEndMs,
            firstEventTimestampMs: null,
            lastEventTimestampMs: null,
            nextPageTimestamp: null,
            pageCount: 1,
            stopReason: "NEXT_PAGE_NULL",
            coverageRatio: 1,
            complete: true,
          },
        });
        datasetsByCapability.set(cap, list);
        filterIdentityByCapability.set(cap, "metadata");
      }
      continue;
    }

    if (unit.dataset === "CombatantInfo" && combatantDataset) {
      for (const cap of unit.capabilities) {
        const list = datasetsByCapability.get(cap) ?? [];
        list.push(combatantDataset);
        datasetsByCapability.set(cap, list);
        filterIdentityByCapability.set(cap, "none");
      }
      if (combatantDataset.events.length > 0) {
        processCapabilityEvidencePage({
          state: processor,
          dataset: "CombatantInfo",
          rawEvents: combatantDataset.events,
          mode: input.mode,
          capabilitySet: plan.capabilities,
          friendlyPlayerActorIds,
          ownerByActor,
          relevantAbilityIds: relevantAbilityIdSet,
        });
        // Loadouts are projected separately — CombatantInfo has no cast spellId.
        const extracted = extractParticipantLoadoutsFromCombatantEvents(
          combatantDataset.events,
          new Set(friendlyPlayerActorIds),
        );
        for (const row of extracted) {
          const prior = participantLoadouts.find((p) => p.actorId === row.actorId);
          if (prior == null) {
            participantLoadouts.push(row);
          } else {
            const spells = new Set([...prior.talentSpellIds, ...row.talentSpellIds]);
            const nodes = new Set([
              ...prior.talentTreeNodeIds,
              ...row.talentTreeNodeIds,
            ]);
            prior.talentSpellIds = [...spells].sort((a, b) => a - b);
            prior.talentTreeNodeIds = [...nodes].sort((a, b) => a - b);
            prior.blizzardSpecId = prior.blizzardSpecId ?? row.blizzardSpecId;
            prior.evidenceState =
              spells.size > 0 || nodes.size > 0
                ? "PRESENT"
                : row.evidenceState === "UNPARSEABLE" ||
                    prior.evidenceState === "UNPARSEABLE"
                  ? "UNPARSEABLE"
                  : "ABSENT";
          }
        }
      }
      continue;
    }

    let batches: FilterBatch[];
    try {
      batches = resolveBatchesForUnit({
        unit,
        abilityIds,
        actorIds,
        friendlyPlayerActorIds,
      });
    } catch (err) {
      batchFailed = true;
      throw new CapabilityEvidenceAcquisitionError(
        `filter_batch_build_failed:${unit.unitId}:${err instanceof Error ? err.message : String(err)}`,
      );
    }

    filterBatchCount += batches.length;
    const unitDatasets: WclRunEvidenceDataset[] = [];

    for (const batch of batches) {
      const filterExpression =
        batch.filterExpression && batch.filterExpression.length > 0
          ? batch.filterExpression
          : null;
      const filterTag = datasetFilterTag({
        strategy: unit.filterStrategy,
        filterExpression:
          filterExpression ??
          (batch.sourceID != null ? `sourceID=${batch.sourceID}` : null),
        abilityFilterHash,
        actorSetHash,
        batchIndex: batch.batchIndex,
        batchCount: batch.batchCount,
      });

      verifiedFilters.push({
        dataset: unit.dataset,
        filterExpression,
        sourceID: batch.sourceID,
        hostilityType: unit.hostilityType,
        includeResources: unit.includeResources,
        batchIndex: batch.batchIndex,
        batchCount: batch.batchCount,
      });

      const result = await loadOrFetchDataset({
        client: input.client,
        store: input.store,
        reportCode: input.reportCode,
        reportRevision: input.reportRevision,
        fightId: input.fightId,
        dataset: unit.dataset,
        filterExpression,
        filterTag,
        sourceId: batch.sourceID,
        includeResources: unit.includeResources,
        hostilityType: unit.hostilityType,
        startTime: input.fightStartMs,
        endTime: input.fightEndMs,
        maxPages,
        region: input.region,
        forceRefetch: input.forceRefetch,
        localOnly: input.localOnly,
      });

      providerCalls += result.providerCalls;
      pagesFetched += result.dataset.pageCount;
      unitDatasets.push(result.dataset);

      if (result.dataset.state === "MISSING") {
        batchMissing = true;
      }
      if (result.dataset.state === "ERROR") {
        batchFailed = true;
      }

      // Incremental relevance filtering on a local view; store already persisted pages.
      const pageEvents = result.dataset.events;
      if (pageEvents.length > 0) {
        processCapabilityEvidencePage({
          state: processor,
          dataset: unit.dataset,
          rawEvents: pageEvents,
          mode: input.mode,
          capabilitySet: plan.capabilities,
          friendlyPlayerActorIds,
          ownerByActor,
          relevantAbilityIds: relevantAbilityIdSet,
        });
      }
    }

    for (const cap of unit.capabilities) {
      const list = datasetsByCapability.get(cap) ?? [];
      list.push(...unitDatasets);
      datasetsByCapability.set(cap, list);
      filterIdentityByCapability.set(
        cap,
        batches.map((b) => b.filterIdentity).join(";"),
      );
    }
  }

  const coverage: CapabilityCoverageV1[] = plan.capabilities.map((capability) =>
    mergeCoverageForCapability({
      capability,
      requiredDatasets: requiredDatasetsByCapability.get(capability) ?? [],
      filterIdentity: filterIdentityByCapability.get(capability) ?? "none",
      datasets: datasetsByCapability.get(capability) ?? [],
      sourceArtifactIds,
      batchMissing,
      batchFailed,
    }),
  );

  // Capability-scoped completeness: incomplete DamageTaken must not mark Interrupts incomplete.
  for (const row of coverage) {
    const required = new Set(row.requiredDatasets);
    const unitDatasets = (datasetsByCapability.get(row.capability) ?? []).filter((d) =>
      required.has(d.key),
    );
    const recomputed = mergeCoverageForCapability({
      capability: row.capability,
      requiredDatasets: row.requiredDatasets,
      filterIdentity: row.filterIdentity,
      datasets: unitDatasets,
      sourceArtifactIds,
      batchMissing: unitDatasets.some((d) => d.state === "MISSING"),
      batchFailed: unitDatasets.some((d) => d.state === "ERROR"),
    });
    Object.assign(row, recomputed);
  }

  const compactEvents: CapabilityCompactEvent[] = processor.compactEvents.sort(
    (a, b) => a.timestampMs - b.timestampMs || a.eventId.localeCompare(b.eventId),
  );

  const limitations: string[] = [];
  for (const row of coverage) {
    if (!isCapabilityCoverageComplete(row)) {
      limitations.push(`CAPABILITY_INCOMPLETE:${row.capability}`);
    }
  }

  const compatibilityIdentity = buildCapabilityEvidenceCompatibilityIdentity({
    reportCode: input.reportCode,
    fightId: input.fightId,
    reportRevision: input.reportRevision,
    dataset: "PACKAGE",
    capabilitySet: plan.capabilities,
    actorSetHash,
    abilityFilterHash,
    catalogVersion,
    mode: input.mode,
  });

  const withoutHash: Omit<CapabilityEvidencePackageV1, "contentHash"> = {
    schemaVersion: CAPABILITY_EVIDENCE_PACKAGE_SCHEMA_VERSION,
    mode: input.mode,
    sourceKey: {
      reportCode: input.reportCode,
      fightId: input.fightId,
      reportRevision: input.reportRevision,
    },
    compatibilityIdentity,
    compatibilityKey: capabilityEvidenceCompatibilityKeyString(compatibilityIdentity),
    acquisitionPlanVersion: CAPABILITY_ACQUISITION_PLAN_VERSION,
    catalogVersion,
    graphqlQueryVersion: WCL_GRAPHQL_QUERY_VERSION,
    friendlyPlayerActorIds,
    ownedPetActorIds,
    actorSetHash,
    abilityFilterHash,
    capabilitySet: plan.capabilities,
    coverage,
    compactEvents,
    participantLoadouts: participantLoadouts.sort((a, b) => a.actorId - b.actorId),
    unknownAbilitySummaries: [...processor.unknownSummaries.values()].sort(
      (a, b) => b.count - a.count,
    ),
    retention: {
      rawPages: "EPHEMERAL_RAW_PAGE",
      packageClass: "CANONICAL_CAPABILITY_EVIDENCE",
      diagnosticClass: "PINNED_DIAGNOSTIC",
    },
    accounting: {
      graphqlRequestCount: providerCalls,
      pagesFetched,
      eventsBeforeRelevanceFilter: processor.eventsBeforeFilter,
      eventsAfterRelevanceFilter: processor.eventsAfterFilter,
      filterBatchCount,
      providerCalls,
    },
    verifiedFilters,
    sourceArtifactIds,
    complete: coverage.every(isCapabilityCoverageComplete),
    limitations,
  };

  const pkg: CapabilityEvidencePackageV1 = {
    ...withoutHash,
    contentHash: hashCapabilityEvidencePayload(withoutHash),
  };

  void buildCapabilityPackageCompatibilityKey;

  return {
    package: pkg,
    providerCalls,
    combatantInfoEvents: combatantDataset?.events ?? null,
  };
}
