/**
 * Utility V2 Phase 1 — fact-set and computation types.
 *
 * Facts are provider-free normalized inputs (Layer 5). Scoring never calls
 * providers and never reseeds the EvidenceManifestV2 slot selection.
 */

import type {
  UtilityV2DomainKey,
  UtilityV2SupportSemantic,
  UtilityV2ModelConfig,
} from "./constants.js";

export type InterruptAttemptClass =
  | "CONFIRMED_SUCCESS"
  | "VALID_OVERLAP"
  | "MATCHED_FAILED"
  | "UNMATCHED_ATTEMPT"
  | "NOT_OBSERVABLE";

export type UtilityV2ActorKind = "PLAYER" | "OWNED_PET" | "OTHER" | "NPC" | "UNKNOWN";

export type UtilityV2AvailabilityState = "AVAILABLE" | "PARTIAL" | "UNAVAILABLE";

/** Frozen identity for one EvidenceManifestV2 selected slot. */
export interface UtilityV2FrozenSlotIdentity {
  reportCode: string;
  fightId: number;
  reportRevision: number;
}

/**
 * Manifest slot identity stamp — structural subset of EvidenceSlotV2.
 * Accepts a frozen EvidenceManifestV2.slots entry or equivalent.
 */
export interface UtilityV2ManifestSlotRef {
  slotId: string;
  dungeonSlug: string;
  slotIndex: 0 | 1;
  state: string;
  identity: UtilityV2FrozenSlotIdentity | null;
}

/**
 * Frozen EvidenceManifestV2 identity stamps required for binding.
 * Does not re-select runs.
 */
export interface UtilityV2FrozenManifestRef {
  contentHash: string;
  schemaVersion: string;
  selectorVersion?: string;
  expectedSlotCount: number;
  selectedSlotCount: number;
  activeDungeonSlugs: string[];
  slots: UtilityV2ManifestSlotRef[];
}

/** Raw interrupt ability cast used as an attempt seed. */
export interface UtilityV2InterruptAttemptSeed {
  id: string;
  timestampMs: number;
  abilityGameId: number;
  sourceActorId: number;
  sourceKind: UtilityV2ActorKind;
  targetActorId: number | null;
}

/** Confirmed WCL Interrupts-table event. */
export interface UtilityV2ConfirmedInterruptEvent {
  timestampMs: number;
  sourceActorId: number;
  sourceKind: UtilityV2ActorKind;
  targetActorId: number | null;
  abilityGameId: number | null;
  interruptedSpellId: number | null;
}

/** Hostile cast window for attempt matching. */
export interface UtilityV2HostileCastWindow {
  startMs: number;
  endMs: number;
  sourceActorId: number;
  abilityGameId: number | null;
  completed: boolean;
  interrupted: boolean;
  interruptedByActorId: number | null;
  interruptedByKind: UtilityV2ActorKind | null;
}

export interface ClassifiedInterruptAttempt {
  id: string;
  timestampMs: number;
  abilityGameId: number;
  sourceActorId: number;
  sourceKind: UtilityV2ActorKind;
  targetActorId: number | null;
  classification: InterruptAttemptClass;
  credit: number;
  note: string;
}

export interface UtilityV2CcAction {
  id: string;
  timestampMs: number;
  abilityGameId: number;
  sourceActorId: number;
  sourceKind: UtilityV2ActorKind;
  targetActorId: number | null;
  inActiveCombat: boolean;
}

export interface UtilityV2SupportAction {
  id: string;
  timestampMs: number;
  abilityGameId: number | null;
  abilityName: string | null;
  sourceActorId: number;
  sourceKind: UtilityV2ActorKind;
  targetActorId: number | null;
  semantic: UtilityV2SupportSemantic;
  tier: "CONFIRMED_IMPACT" | "CONFIRMED_APPLICATION" | "INFERRED" | "UNVERIFIED";
}

export interface UtilityV2ToolkitApplicability {
  hasInterrupt: boolean;
  hasSupport: boolean;
  hasStrategicCc: boolean;
}

/**
 * Per-slot Utility fact set document (persisted on RunFactSet.facts).
 * Must carry frozen slot identity for manifest binding.
 */
export interface UtilityV2RunFactSet {
  schemaVersion: string;
  extractorFamily: string;
  extractorVersion: string;
  /** Matches EvidenceManifestV2 slotId when bound. */
  slotId: string;
  runId: string;
  dungeonSlug: string;
  keyLevel: number | null;
  slotIndex: 0 | 1 | null;
  reportCode: string | null;
  fightId: number | null;
  reportRevision: number | null;
  fightDurationMs: number;
  activeCombatMs: number;
  activeCombatHours: number;
  hostileBegincastCount: number;
  hostileObservability: "PRESENT" | "ABSENT" | "PARTIAL";
  toolkit: UtilityV2ToolkitApplicability;
  interruptAttempts: ClassifiedInterruptAttempt[];
  ccActions: UtilityV2CcAction[];
  supportActions: UtilityV2SupportAction[];
  dispelPurgeSuccessCount: number;
  catalogCoverage: {
    abilityCatalogCoverage: number;
    mechanicCatalogCoverage: number;
  };
  limitations: string[];
}

export interface UtilityV2DomainBreakdown {
  domain: UtilityV2DomainKey;
  applicable: boolean;
  rawScore: number | null;
  weight: number;
  weightShare: number;
  uncappedContribution: number;
  cappedContribution: number;
  capApplied: boolean;
  events: number;
  creditedEvents: number;
  perCombatHour: number | null;
  notes: string[];
}

export interface UtilityV2InterruptCounts {
  CONFIRMED_SUCCESS: number;
  VALID_OVERLAP: number;
  MATCHED_FAILED: number;
  UNMATCHED_ATTEMPT: number;
  NOT_OBSERVABLE: number;
  creditedTotal: number;
  unmatchedCreditBeforeCap: number;
  unmatchedCreditAfterCap: number;
  unmatchedCapApplied: boolean;
}

export interface UtilityV2ComputeInput {
  /** Frozen EvidenceManifestV2 (or equivalent slot identity stamps). */
  manifest: UtilityV2FrozenManifestRef;
  /** Fact sets claimed for selected slots (validated by binder). */
  factSets: UtilityV2RunFactSet[];
  /** Explicit extraction failure → UNAVAILABLE. */
  extractionFailed?: boolean;
  mechanicCatalogCoverageObserved?: number;
}

export interface UtilityV2ComputeOptions {
  /** Explicit frozen model config. Defaults to canonical UTILITY_V2_MODEL_CONFIG. */
  modelConfig?: UtilityV2ModelConfig | unknown;
}

export interface UtilityV2BindingResult {
  ok: boolean;
  boundFactSets: UtilityV2RunFactSet[];
  selectedSlotCount: number;
  boundSelectedSlotCount: number;
  reasons: string[];
}

export interface UtilityV2ComputeResult {
  mode: "OBSERVED_CONTRIBUTION";
  phase: 1 | 2;
  opportunityMode: "off";
  algorithmVersion: string;
  scoreSemantics: string;
  modelConfigFingerprint: string;
  availabilityState: UtilityV2AvailabilityState;
  /** Reliability-adjusted score in [50, 100], or null when UNAVAILABLE. */
  score: number | null;
  rawBehaviorEstimate: number | null;
  confidence: number;
  confidenceComponents: Record<string, number>;
  reliability: number | null;
  inputFingerprint: string;
  domainBreakdown: UtilityV2DomainBreakdown[];
  interruptCounts: UtilityV2InterruptCounts;
  support: {
    rawCredit: number;
    diminishedCredit: number;
    bySemantic: Record<UtilityV2SupportSemantic, number>;
    passiveOrRotationalIgnored: number;
  };
  strategicCc: {
    rawActions: number;
    dedupedActions: number;
  };
  context: {
    runCount: number;
    dungeonCount: number;
    dungeons: string[];
    combatHours: number;
    fightDurationHours: number;
    hostileBegincastCount: number;
    attributableEvents: number;
    selectedSlotCount: number;
    boundSelectedSlotCount: number;
    expectedSlotCount: number;
    toolkit: UtilityV2ToolkitApplicability;
    catalogCoverage: {
      abilityCatalogCoverage: number;
      mechanicCatalogCoverage: number;
    };
  };
  explanation: UtilityV2Explanation;
  /** Shadow DimensionComputation metrics document. */
  metrics: Record<string, unknown>;
}

export interface UtilityV2Explanation {
  mode: "OBSERVED_CONTRIBUTION";
  publicationBlocked: true;
  availabilityState: UtilityV2AvailabilityState;
  scoreFloor: number;
  domainWeights: Record<UtilityV2DomainKey, number>;
  interruptClassification: UtilityV2InterruptCounts;
  domainCurves: {
    castStops: string;
    support: string;
    strategicCc: string;
  };
  caps: {
    domainContributionCap: number;
    unmatchedCreditShareCap: number;
    unmatchedOnlyMaxDomainScore: number;
  };
  applicableDomains: UtilityV2DomainKey[];
  excludedDomains: Array<{ domain: UtilityV2DomainKey; reason: string }>;
  notes: string[];
  selectedRuns: Array<{
    slotId: string;
    runId: string;
    dungeonSlug: string;
    slotIndex: 0 | 1 | null;
    reportCode: string | null;
    fightId: number | null;
    reportRevision: number | null;
  }>;
  confidenceReasons: string[];
  bindingReasons: string[];
}

export interface UtilityV2ShadowDimensionPayload {
  characterId: string;
  seasonId: string;
  manifestId: string;
  scoreModelId: string;
  dimension: "UTILITY";
  algorithmVersion: string;
  inputFingerprint: string;
  score: number | null;
  confidence: number;
  state: "SHADOW";
  metrics: Record<string, unknown>;
  explanation: UtilityV2Explanation;
  computedAt: Date;
}

export interface UtilityV2CalibrationExport {
  schemaVersion: "utility-v2-facts";
  algorithmVersion: string;
  modelConfig: UtilityV2ModelConfig;
  input: UtilityV2ComputeInput;
  result: Pick<
    UtilityV2ComputeResult,
    | "score"
    | "confidence"
    | "availabilityState"
    | "inputFingerprint"
    | "rawBehaviorEstimate"
    | "reliability"
  >;
  contributors: UtilityV2DomainBreakdown[];
}

/** @deprecated Prefer UtilityV2ShadowDimensionPayload via toUtilityV2ShadowDimensionPayload. */
export type UtilityV2ShadowDimensionRecord = UtilityV2ShadowDimensionPayload;
