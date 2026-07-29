import type { RegionCode } from "@mplus/contracts";
import type { AbilityAvailability, AbilityCategory, SourceOwnership } from "@mplus/abilities";
import type { MplusZoneConfig } from "../discovery/mplus-zone.js";
import type { WclRateLimitSnapshot } from "../types.js";
import type { GraphQlErrorRecord, ProbeCharacterRecord, ProbeRateLimitRecord, ProbeZoneRecord } from "./types.js";

export type SurvivalProbeIdentity = {
  region: RegionCode;
  realmSlug: string;
  name: string;
};

export type SurvivalEventDataType =
  | "Deaths"
  | "DamageTaken"
  | "Casts"
  | "Buffs"
  | "Healing"
  | "CombatantInfo";

export const SURVIVAL_EVENT_TYPES: SurvivalEventDataType[] = [
  "Deaths",
  "DamageTaken",
  "Casts",
  "Buffs",
  "Healing",
  "CombatantInfo",
];

export interface SurvivalRunCandidate {
  reportCode: string;
  fightId: number;
  encounterId: number;
  dungeonSlug: string;
  keyLevel: number | null;
  score: number | null;
  durationMs: number | null;
  startTimeMs: number | null;
  completedAt: string | null;
  specSlug: string | null;
  roleSlug: string | null;
  rank: number;
}

export interface SurvivalCandidateRejection {
  reportCode: string;
  fightId: number;
  dungeonSlug: string | null;
  reason: string;
}

export interface SurvivalRawEventPage {
  pageIndex: number;
  startTime: number | null;
  nextPageTimestamp: number | null;
  eventCount: number;
  /** Full GraphQL `data` payload for this page (preserved before normalization). */
  rawResponseData: unknown;
  graphqlErrors: string[];
}

export interface SurvivalRawEventDataset {
  dataType: SurvivalEventDataType;
  state: "OK" | "ERROR" | "MISSING";
  pageCount: number;
  truncated: boolean;
  filterSourceId: number | null;
  events: Array<Record<string, unknown>>;
  pages: SurvivalRawEventPage[];
  graphqlErrors: string[];
  note: string | null;
}

export interface SurvivalPreservedEvent {
  timestamp: number | null;
  sourceID: number | null;
  targetID: number | null;
  abilityGameID: number | null;
  amount: number | null;
  absorbed: number | null;
  overkill: number | null;
  hitType: number | null;
  /** All event fields not mapped above — never silently discarded. */
  additionalFields: Record<string, unknown>;
  raw: Record<string, unknown>;
}

export interface SurvivalDeathFact {
  timestamp: number | null;
  killingAbilityGameId: number | null;
  killingSourceId: number | null;
  overkill: number | null;
  event: SurvivalPreservedEvent;
}

export interface SurvivalDamageByAbility {
  abilityGameID: number;
  eventCount: number;
  totalAmount: number;
  totalAbsorbed: number;
  totalOverkill: number;
}

export interface SurvivalDamageBySource {
  sourceID: number | null;
  eventCount: number;
  totalAmount: number;
  totalAbsorbed: number;
}

export interface SurvivalMatchedAbilityUsage {
  canonicalKey: string;
  category: AbilityCategory;
  spellId: number;
  name: string;
  sourceOwnership: SourceOwnership;
  cooldownSeconds: number | null;
  availability: AbilityAvailability;
  talentDependentOrUncertain: boolean;
  castTimestamps: number[];
  buffApplications: Array<{ timestamp: number | null; type: string | null; sourceID: number | null; targetID: number | null }>;
  buffRemovals: Array<{ timestamp: number | null; type: string | null; sourceID: number | null; targetID: number | null }>;
  sourceActorIds: number[];
}

export interface SurvivalHealingFact {
  spellId: number;
  canonicalKey: string | null;
  category: AbilityCategory | null;
  catalogMatched: boolean;
  ambiguous: boolean;
  eventCount: number;
  totalAmount: number;
  totalOverheal: number;
  timestamps: number[];
}

export interface SurvivalNormalizedDataset {
  probeVersion: "1";
  probedAt: string;
  identity: SurvivalProbeIdentity;
  run: {
    dungeonSlug: string;
    reportCode: string;
    fightId: number;
    /** Report-local player actor ID — never confuse with global WCL character ID. */
    playerActorId: number;
    ownedPetActorIds: number[];
    startTime: number;
    endTime: number;
    durationMs: number;
    keyLevel: number | null;
    encounterId: number | null;
    encounterName: string | null;
    wclCharacterId: number;
    wclCanonicalId: number;
  };
  deaths: {
    playerDeathCount: number;
    deathTimestamps: number[];
    deaths: SurvivalDeathFact[];
  };
  damageTaken: {
    totalDamageTaken: number;
    totalAbsorbed: number;
    byAbility: SurvivalDamageByAbility[];
    bySource: SurvivalDamageBySource[];
    events: SurvivalPreservedEvent[];
    /** Avoidable classification deferred — always null in this probe. */
    avoidableClassification: null;
  };
  defensiveUsage: SurvivalMatchedAbilityUsage[];
  selfHealingAndConsumables: {
    healing: SurvivalHealingFact[];
    consumableAndSelfHealCasts: SurvivalMatchedAbilityUsage[];
  };
  combatantInfo: {
    specialization: string | null;
    specId: number | null;
    talents: unknown;
    gear: unknown;
    itemLevel: number | null;
    raw: Record<string, unknown> | null;
  };
  abilityCatalog: {
    catalogVersion: string;
    classSlug: string | null;
    specSlug: string | null;
    supported: boolean;
    matchedSpellIds: number[];
    unmatchedSpellIds: number[];
    ambiguousSpellIds: number[];
  };
}

export interface SurvivalProbeDiagnostics {
  reportsInspected: string[];
  fightsInspected: Array<{ reportCode: string; fightId: number }>;
  candidateRunsRejected: SurvivalCandidateRejection[];
  paginationPageCount: Record<SurvivalEventDataType, number>;
  actorResolution: {
    wclCharacterId: number | null;
    playerActorId: number | null;
    method: string | null;
    ok: boolean;
    message: string | null;
  };
  petOwnershipResolution: {
    ownedPetActorIds: number[];
    method: string;
    pets: Array<{ id: number; name: string; subType: string | null; petOwner: number | null; reason: string }>;
  };
  matchedAbilityCatalogRules: Array<{
    spellId: number;
    canonicalKey: string;
    category: AbilityCategory;
    availability: AbilityAvailability;
    supportCertainty: string | null;
  }>;
  unmatchedSpellIds: number[];
  ambiguousSpellIds: number[];
  missingDatasets: SurvivalEventDataType[];
  graphqlErrors: GraphQlErrorRecord[];
  schemaWarnings: string[];
  activeDungeonPool: string[];
  selectedCandidate: SurvivalRunCandidate | null;
  note: string;
}

export interface SurvivalProbeDataset {
  probeVersion: "1";
  probedAt: string;
  identity: SurvivalProbeIdentity;
  state: "OK" | "ERROR";
  character: ProbeCharacterRecord | null;
  zone: ProbeZoneRecord;
  selectedRun: SurvivalNormalizedDataset["run"] | null;
  normalized: SurvivalNormalizedDataset | null;
  diagnostics: SurvivalProbeDiagnostics;
  graphqlErrors: GraphQlErrorRecord[];
  rateLimit: {
    initial: WclRateLimitSnapshot | null;
    final: WclRateLimitSnapshot | null;
    perOperation: ProbeRateLimitRecord[];
  };
  zoneConfig: MplusZoneConfig;
}
