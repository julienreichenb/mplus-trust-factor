import type { AbilityCategory } from "@mplus/abilities";

export type OffensiveProbeDataset = "Casts" | "Buffs";

/**
 * User-facing / runtime load mode.
 * `PERSISTED_EVIDENCE` means durable DB-backed evidence (typically `pg://` payloads).
 * Do not use this label to imply legacy filesystem CAS blobs.
 */
export type OffensiveProbeDataLoadMode = "PERSISTED_EVIDENCE" | "LIVE_WCL";

export type OffensiveProbeLiveDataset = "Casts" | "Buffs" | "CombatantInfo" | "masterData";

export type OffensiveSourceKind = "PLAYER" | "OWNED_PET_OR_GUARDIAN" | "OTHER";

export interface OffensiveProbeFightSelection {
  manifestId: string;
  slotId: string;
  characterId: string;
  reportCode: string;
  fightId: number;
  reportRevision: number;
  dungeonSlug: string | null;
  keyLevel: number | null;
  playerActorId: number;
  ownedPetActorIds: number[];
  fightStartMs: number;
  fightEndMs: number | null;
  classSlug: string | null;
  specSlug: string | null;
}

export interface OffensiveProbeEventInput {
  dataset: OffensiveProbeDataset;
  row: Record<string, unknown>;
  index: number;
}

export interface OffensiveProbeCatalogMatch {
  matched: boolean;
  canonicalKey: string | null;
  canonicalName: string | null;
  catalogCategory: AbilityCategory | null;
  matchKind: "PRIMARY_SPELL_ID" | "ALIAS_SPELL_ID" | null;
}

export interface OffensiveProbeAbilityInventoryRow {
  spellId: number;
  observedRawNames: string[];
  eventStreams: OffensiveProbeDataset[];
  eventTypes: string[];
  sourceActorIds: number[];
  sourceOwnership: OffensiveSourceKind[];
  castCount: number;
  buffApplyCount: number;
  firstTimestampMs: number | null;
  lastTimestampMs: number | null;
  catalogMatch: OffensiveProbeCatalogMatch;
}

export interface OffensiveProbeTimelineEntry {
  reportCode: string;
  fightId: number;
  reportRevision: number;
  dungeonSlug: string | null;
  spellId: number;
  rawName: string | null;
  canonicalName: string | null;
  eventType: string | null;
  dataset: OffensiveProbeDataset;
  rawTimestampMs: number;
  fightOffsetMs: number;
  sourceActorId: number | null;
  sourceKind: OffensiveSourceKind;
  targetActorId: number | null;
  abilityIdSourcePath: string | null;
  eventSource: OffensiveProbeDataLoadMode;
}

export interface OffensiveProbeDataLoad {
  mode: OffensiveProbeDataLoadMode;
  datasets: OffensiveProbeLiveDataset[];
  castsSource: OffensiveProbeDataLoadMode;
  buffsSource: OffensiveProbeDataLoadMode;
  wclRequests?: number;
  maxExpectedWclRequests?: number;
  maxPagesPerDataset?: number;
  /** Storage schemes actually read while loading evidence (e.g. pg, cas). */
  storageSchemesRead?: string[];
  totalProviderCalls?: number;
  providerCallsDuringReload?: number;
}

export interface OffensiveProbeParticipantActivation {
  activationId: string;
  canonicalKey: string;
  primarySpellId: number;
  timestampMs: number;
  rawMatchedEventCount: number;
  contributingSpellIds: number[];
}

export interface OffensiveProbeParticipantReport {
  playerActorId: number;
  characterName: string;
  classSlug: string | null;
  specSlug: string | null;
  role: import("@mplus/abilities").AbilityRole | null;
  ownedPetActorIds: number[];
  rawMatchedActivationEventCount: number;
  deduplicatedActivationCount: number;
  canonicalKeysActivated: string[];
  activations: OffensiveProbeParticipantActivation[];
}

export interface OffensiveProbeEvidenceIntegrity {
  totalProviderCalls: number;
  providerCallsDuringReload: number;
  storageSchemesRead: string[];
  fillersExcluded: boolean;
  allFiveParticipantsResolved: boolean;
  participantCount: number;
}

export interface OffensiveProbeDiagnostics {
  abilityIdSourcePathCounts: Record<string, number>;
  sourceActorIdSourcePathCounts: Record<string, number>;
  targetActorIdSourcePathCounts: Record<string, number>;
  eventTypeCounts: Record<string, number>;
  unresolvedAbilityIdCount: number;
  malformedTimestampCount: number;
  playerEventCount: number;
  ownedPetOrGuardianEventCount: number;
  otherActorEventCount: number;
  unresolvedEventSamples: Array<{
    dataset: OffensiveProbeDataset;
    index: number;
    reason: string;
    shape: Record<string, unknown>;
  }>;
}

export interface OffensiveProbeReport {
  schemaVersion: "wcl-offensive-one-fight-v1";
  generatedAt: string;
  selection: OffensiveProbeFightSelection;
  dataLoad: OffensiveProbeDataLoad;
  persistence?: OffensiveProbePersistenceSection;
  rawEventCounts: {
    casts: number;
    buffs: number;
  };
  diagnostics: OffensiveProbeDiagnostics;
  abilityInventory: OffensiveProbeAbilityInventoryRow[];
  timeline: OffensiveProbeTimelineEntry[];
  participants: OffensiveProbeParticipantReport[];
  evidenceIntegrity: OffensiveProbeEvidenceIntegrity;
  summary: {
    normalizedEventCount: number;
    unresolvedEventCount: number;
    distinctObservedSpellIds: number;
    catalogMatchCount: number;
    participantCount: number;
    deduplicatedActivationCount: number;
    fillersExcluded: boolean;
    totalProviderCalls: number;
    providerCallsDuringReload: number;
  };
}

export type OffensiveProbePersistenceMode = "POSTGRES_ROUND_TRIP";

export type OffensiveProbePayloadReadability =
  | "DB_PAYLOAD_READABLE"
  | "LEGACY_EXTERNAL_ONLY"
  | "PAYLOAD_MISSING"
  | "DIGEST_MISMATCH";

export type OffensiveProbePersistenceDatasetKey =
  | "CASTS"
  | "BUFFS"
  | "COMBATANT_INFO"
  | "MASTER_DATA";

export interface OffensiveProbePersistenceDataset {
  dataset: OffensiveProbePersistenceDatasetKey;
  rawArtifactId: string;
  storageUriScheme: "pg";
  payloadReadability: OffensiveProbePayloadReadability;
  pageCount: number;
  eventCount: number;
  requestedFightStartMs?: number | null;
  requestedFightEndMs?: number | null;
  firstEventTimestampMs?: number | null;
  lastEventTimestampMs?: number | null;
  nextPageTimestamp?: number | null;
  stopReason?: string | null;
  coverageRatio?: number | null;
  complete?: boolean | null;
}

export interface OffensiveProbePersistenceSection {
  mode: OffensiveProbePersistenceMode;
  liveFetchFightCount: number;
  providerCallsDuringReload: number;
  datasets: OffensiveProbePersistenceDataset[];
}
