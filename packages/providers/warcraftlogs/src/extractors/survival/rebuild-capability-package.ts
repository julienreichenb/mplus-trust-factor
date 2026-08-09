/**
 * Rebuild a CapabilityEvidencePackageV1 from already-persisted dataset pages.
 * Zero provider calls — used by the Survival one-fight probe.
 */
import { CURRENT_CATALOG_VERSION_ID } from "@mplus/abilities";
import {
  CAPABILITY_ACQUISITION_PLAN_VERSION,
  CAPABILITY_EVIDENCE_PACKAGE_SCHEMA_VERSION,
  WCL_GRAPHQL_QUERY_VERSION,
  buildCapabilityPackageCompatibilityKey,
  hashCapabilityEvidencePayload,
  isCapabilityCoverageComplete,
  packageCompleteFromCoverage,
  type CapabilityCoverageV1,
  type CapabilityEvidencePackageV1,
  type EvidenceCapability,
} from "@mplus/contracts";
import {
  buildCapabilityAcquisitionPlan,
  productionDefaultCapabilities,
} from "../../evidence/capability/acquisition-plan.js";
import {
  abilityFilterHashFromIds,
  actorSetHashFromIds,
} from "../../evidence/capability/filter-batching.js";
import {
  createPageProcessorState,
  processCapabilityEvidencePage,
} from "../../evidence/capability/page-processor.js";
import { extractParticipantLoadoutsFromCombatantEvents } from "../../evidence/capability/combatant-loadout.js";
import { collectProductionRelevantAbilityIds } from "../../evidence/capability/relevant-ability-ids.js";
import type { SurvivalProbeParticipant, SurvivalProbeSourceIdentity } from "./types.js";

export interface PersistedDatasetBundle {
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
}

function coverageForCapability(input: {
  capability: EvidenceCapability;
  requiredDatasets: string[];
  rows: PersistedDatasetBundle["coverageRows"];
  sourceArtifactIds: string[];
}): CapabilityCoverageV1 {
  const byKey = new Map(input.rows.map((r) => [r.datasetKey, r]));
  let pageCount = 0;
  let eventCount = 0;
  const limitations: string[] = [];
  let complete = true;
  let stopReason: CapabilityCoverageV1["stopReason"] = null;

  for (const ds of input.requiredDatasets) {
    const row = byKey.get(ds);
    if (!row || row.pageCount === 0) {
      complete = false;
      stopReason = "MISSING_REQUIRED_BATCH";
      limitations.push(`DATASET_MISSING:${ds}`);
      continue;
    }
    pageCount += row.pageCount;
    eventCount += row.eventCount;
    if (!row.complete || row.truncated) {
      complete = false;
      stopReason =
        (row.stopReason as CapabilityCoverageV1["stopReason"]) ?? "MAX_PAGES";
      limitations.push(`DATASET_INCOMPLETE:${ds}:${row.stopReason ?? "unknown"}`);
    }
  }

  return {
    capability: input.capability,
    requiredDatasets: input.requiredDatasets,
    filterIdentity: "persisted-rebuild",
    pageCount,
    eventCount,
    firstTimestampMs: null,
    lastTimestampMs: null,
    nextPageTimestamp: null,
    stopReason,
    complete,
    limitations,
    sourceArtifactIds: input.sourceArtifactIds,
  };
}

export function rebuildCapabilityPackageFromPersistedEvents(input: {
  source: SurvivalProbeSourceIdentity;
  participants: SurvivalProbeParticipant[];
  bundle: PersistedDatasetBundle;
  catalogVersion?: string;
  sourceArtifactIds?: string[];
  mode?: CapabilityEvidencePackageV1["mode"];
}): {
  package: CapabilityEvidencePackageV1;
  providerCalls: number;
} {
  const catalogVersion = input.catalogVersion ?? CURRENT_CATALOG_VERSION_ID;
  const mode = input.mode ?? "PRODUCTION_CAPABILITY_ACQUISITION";
  const plan = buildCapabilityAcquisitionPlan({
    mode,
    capabilities: productionDefaultCapabilities(),
  });

  const friendlyPlayerActorIds = input.participants.map((p) => p.playerActorId);
  const ownedPetActorIds = [
    ...new Set(input.participants.flatMap((p) => p.ownedPetActorIds)),
  ];
  const actorIds = [...new Set([...friendlyPlayerActorIds, ...ownedPetActorIds])];
  const actorSetHash = actorSetHashFromIds(actorIds);
  const abilityIds = collectProductionRelevantAbilityIds();
  const abilityFilterHash = abilityFilterHashFromIds(abilityIds);
  const ownerByActor = new Map<number, number>();
  for (const p of input.participants) {
    for (const petId of p.ownedPetActorIds) ownerByActor.set(petId, p.playerActorId);
  }

  const processor = createPageProcessorState();
  const datasetsToProcess = [
    "Casts",
    "Buffs",
    "DamageTaken",
    "Deaths",
    "Debuffs",
    "Interrupts",
    "Dispels",
    "CombatantInfo",
  ] as const;

  for (const dataset of datasetsToProcess) {
    const events = input.bundle.eventsByDataset[dataset] ?? [];
    if (events.length === 0) continue;
    processCapabilityEvidencePage({
      state: processor,
      dataset,
      rawEvents: events,
      mode,
      capabilitySet: plan.capabilities,
      friendlyPlayerActorIds,
      ownerByActor,
      relevantAbilityIds: new Set(abilityIds),
    });
  }

  const participantLoadouts = extractParticipantLoadoutsFromCombatantEvents(
    input.bundle.eventsByDataset.CombatantInfo ?? [],
    new Set(friendlyPlayerActorIds),
  );

  const sourceArtifactIds = input.sourceArtifactIds ?? [];
  const coverage = plan.entries.map((entry) =>
    coverageForCapability({
      capability: entry.capability,
      requiredDatasets: entry.datasets.map((d) => d.dataset),
      rows: input.bundle.coverageRows,
      sourceArtifactIds,
    }),
  );

  const compatibilityKey = buildCapabilityPackageCompatibilityKey({
    reportCode: input.source.reportCode,
    fightId: input.source.fightId,
    reportRevision: input.source.reportRevision,
    capabilitySet: plan.capabilities,
    actorSetHash,
    abilityFilterHash,
    catalogVersion,
    mode,
  });

  const withoutHash: Omit<CapabilityEvidencePackageV1, "contentHash"> = {
    schemaVersion: CAPABILITY_EVIDENCE_PACKAGE_SCHEMA_VERSION,
    mode,
    sourceKey: {
      reportCode: input.source.reportCode,
      fightId: input.source.fightId,
      reportRevision: input.source.reportRevision,
    },
    compatibilityIdentity: {
      reportCode: input.source.reportCode,
      fightId: input.source.fightId,
      reportRevision: input.source.reportRevision,
      dataset: "PACKAGE",
      capabilitySet: [...plan.capabilities].sort() as EvidenceCapability[],
      actorSetHash,
      abilityFilterHash,
      catalogVersion,
      packageSchemaVersion: CAPABILITY_EVIDENCE_PACKAGE_SCHEMA_VERSION,
      acquisitionPlanVersion: CAPABILITY_ACQUISITION_PLAN_VERSION,
      graphqlQueryVersion: WCL_GRAPHQL_QUERY_VERSION,
      mode,
    },
    compatibilityKey,
    acquisitionPlanVersion: CAPABILITY_ACQUISITION_PLAN_VERSION,
    catalogVersion,
    graphqlQueryVersion: WCL_GRAPHQL_QUERY_VERSION,
    friendlyPlayerActorIds,
    ownedPetActorIds,
    actorSetHash,
    abilityFilterHash,
    capabilitySet: [...plan.capabilities].sort() as EvidenceCapability[],
    coverage,
    compactEvents: processor.compactEvents,
    participantLoadouts,
    unknownAbilitySummaries: [...processor.unknownSummaries.values()].sort(
      (a, b) => b.count - a.count || a.spellId - b.spellId,
    ),
    retention: {
      rawPages: "EPHEMERAL_RAW_PAGE",
      packageClass: "CANONICAL_CAPABILITY_EVIDENCE",
      diagnosticClass: "PINNED_DIAGNOSTIC",
    },
    accounting: {
      graphqlRequestCount: 0,
      pagesFetched: input.bundle.coverageRows.reduce((s, r) => s + r.pageCount, 0),
      eventsBeforeRelevanceFilter: processor.eventsBeforeFilter,
      eventsAfterRelevanceFilter: processor.eventsAfterFilter,
      filterBatchCount: 0,
      providerCalls: 0,
    },
    verifiedFilters: [],
    sourceArtifactIds,
    complete: packageCompleteFromCoverage(coverage),
    limitations: [
      "REBUILT_FROM_PERSISTED_DATASET_PAGES",
      ...coverage
        .filter((c) => !isCapabilityCoverageComplete(c))
        .flatMap((c) => c.limitations),
    ],
  };

  return {
    package: {
      ...withoutHash,
      contentHash: hashCapabilityEvidencePayload(withoutHash),
    },
    providerCalls: 0,
  };
}
