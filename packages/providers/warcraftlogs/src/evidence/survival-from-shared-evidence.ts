/**
 * Adapt shared WCL evidence bundles into Survival canonical analyzer inputs.
 * Live refresh must call this instead of a second fetchSurvivalCanonicalDatasets path.
 */
import type { AbilityCatalog } from "@mplus/abilities";
import {
  buildCanonicalSurvivalAnalysis,
  collectCanonicalHealthSnapshots,
  diagnoseMaxHpFailure,
  emptySurvivalCanonicalDatasets,
  type CanonicalSurvivalAnalysisResult,
  type SurvivalCanonicalDatasets,
} from "../analysis/survival-canonical-analysis.js";
import type { SurvivalEventDataType, SurvivalProbeIdentity } from "../probe/survival-probe-types.js";
import { SURVIVAL_EVENT_TYPES } from "../probe/survival-probe-types.js";
import type { SurvivalRawEventDataset } from "../probe/survival-probe-types.js";
import type { WclRunEvidenceBundle, SharedEvidenceDatasetKey } from "./wcl-run-evidence-types.js";

const SURVIVAL_FROM_BUNDLE_KEYS: SharedEvidenceDatasetKey[] = [
  "Casts",
  "Deaths",
  "DamageTaken",
  "Buffs",
  "Debuffs",
  "Healing",
  "CombatantInfo",
];

function toSurvivalRawDataset(
  dataType: SurvivalEventDataType,
  bundle: WclRunEvidenceBundle,
): SurvivalRawEventDataset {
  const ds = bundle.eventDatasets[dataType as SharedEvidenceDatasetKey];
  if (!ds) {
    return {
      dataType,
      state: "MISSING",
      pageCount: 0,
      truncated: false,
      filterSourceId: null,
      events: [],
      pages: [],
      graphqlErrors: [],
      note: "missing_from_shared_evidence_bundle",
    };
  }
  const state: SurvivalRawEventDataset["state"] =
    ds.state === "OK" || ds.state === "CACHED" || ds.state === "PERSISTED"
      ? "OK"
      : ds.state === "ERROR"
        ? "ERROR"
        : "MISSING";
  return {
    dataType,
    state,
    pageCount: ds.pageCount,
    truncated: ds.truncated,
    filterSourceId: ds.filterSourceId,
    events: ds.events,
    pages: ds.pages.map((p) => ({
      pageIndex: p.pageIndex,
      startTime: p.startTime,
      nextPageTimestamp: p.nextPageTimestamp,
      eventCount: p.eventCount,
      rawResponseData: null,
      graphqlErrors: [],
    })),
    graphqlErrors: [],
    note: ds.source === "persisted" ? "from_shared_evidence_persisted" : "from_shared_evidence",
  };
}

export function survivalDatasetsFromEvidenceBundle(
  bundle: WclRunEvidenceBundle,
): SurvivalCanonicalDatasets {
  const datasets = emptySurvivalCanonicalDatasets();
  for (const dataType of SURVIVAL_EVENT_TYPES) {
    datasets[dataType] = toSurvivalRawDataset(dataType, bundle);
  }
  return datasets;
}

export function sharedEvidenceBundleHasSurvivalDatasets(bundle: WclRunEvidenceBundle): boolean {
  return SURVIVAL_FROM_BUNDLE_KEYS.every((key) => {
    const ds = bundle.eventDatasets[key];
    return ds != null && (ds.state === "OK" || ds.state === "CACHED" || ds.state === "PERSISTED");
  });
}

export function countDetailedWclEventCalls(bundle: WclRunEvidenceBundle): number {
  return Object.values(bundle.eventDatasets).reduce((sum, ds) => sum + (ds?.wclRequests ?? 0), 0);
}

export function buildSurvivalAnalysisFromSharedEvidence(input: {
  bundle: WclRunEvidenceBundle;
  characterId: string;
  identity: SurvivalProbeIdentity;
  reportCode: string;
  fightId: number;
  reportRevision: number | string;
  dungeonSlug: string;
  keyLevel: number | null;
  playerActorId: number;
  ownedPetActorIds: number[];
  fightStartTime: number;
  fightEndTime: number;
  encounterId?: number | null;
  encounterName?: string | null;
  timed?: boolean | null;
  completed?: boolean | null;
  score?: number | null;
  catalog: AbilityCatalog;
  classSlug: string | null;
  specSlug: string | null;
}): CanonicalSurvivalAnalysisResult & {
  requestCount: number;
  maxHpFailureReason: string | null;
  truncated: boolean;
  fromSharedEvidence: true;
  detailedWclEventCalls: number;
} {
  const datasets = survivalDatasetsFromEvidenceBundle(input.bundle);
  const { snapshots, snapshotSourceCounts } = collectCanonicalHealthSnapshots({
    playerActorId: input.playerActorId,
    playerName: input.identity.name,
    damageTakenEvents:
      datasets.DamageTaken.state === "OK" ? datasets.DamageTaken.events : [],
    healingEvents: datasets.Healing.state === "OK" ? datasets.Healing.events : [],
    deathsEvents: datasets.Deaths.state === "OK" ? datasets.Deaths.events : [],
    combatantInfoEvents:
      datasets.CombatantInfo.state === "OK" ? datasets.CombatantInfo.events : [],
    playerDetailsRaw: null,
  });
  const truncated = SURVIVAL_EVENT_TYPES.some((t) => datasets[t].truncated);
  const maxHpFailureReason = diagnoseMaxHpFailure({
    snapshots,
    damage: datasets.DamageTaken,
    snapshotSourceCounts,
  });
  const analyzed = buildCanonicalSurvivalAnalysis({
    characterId: input.characterId,
    identity: input.identity,
    reportCode: input.reportCode,
    fightId: input.fightId,
    reportRevision: input.reportRevision,
    dungeonSlug: input.dungeonSlug,
    keyLevel: input.keyLevel,
    playerActorId: input.playerActorId,
    ownedPetActorIds: input.ownedPetActorIds,
    fightStartTime: input.fightStartTime,
    fightEndTime: input.fightEndTime,
    encounterId: input.encounterId,
    encounterName: input.encounterName,
    timed: input.timed,
    completed: input.completed,
    score: input.score,
    datasets,
    snapshots,
    catalog: input.catalog,
    classSlug: input.classSlug,
    specSlug: input.specSlug,
    eventPagesComplete: !truncated,
    maxHpFailureReason,
    snapshotSourceCounts,
  });
  const detailedWclEventCalls = countDetailedWclEventCalls(input.bundle);
  return {
    ...analyzed,
    requestCount: detailedWclEventCalls,
    maxHpFailureReason,
    truncated,
    fromSharedEvidence: true,
    detailedWclEventCalls,
  };
}
