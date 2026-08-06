import type { CharacterSeasonEvidenceManifestV2 } from "@mplus/contracts";
import type {
  SURVIVAL_V2_CALIBRATION_SCHEMA_VERSION,
  SURVIVAL_V2_DEFENSIVE_RATE,
  SURVIVAL_V2_EXTRACTOR_FAMILY,
  SURVIVAL_V2_SCHEMA_VERSION,
  SurvivalV2CalibrationStatus,
  SurvivalV2ModelConfig,
  SurvivalV2RelativeDamageMode,
} from "./constants.js";

export type SurvivalV2DefensiveCategory =
  (typeof SURVIVAL_V2_DEFENSIVE_RATE.applicableCategories)[number];

/** Toolkit availability for Survival Phase 1 (catalog interface). */
export type SurvivalV2ToolkitAvailabilityState =
  | "AVAILABLE_CONFIRMED"
  | "AVAILABLE_INFERRED"
  | "NOT_TALENTED_CONFIRMED"
  | "REPLACED"
  | "UNKNOWN"
  | "NOT_APPLICABLE";

export type SurvivalV2HealthEvidenceMode =
  | "FULL"
  | "PARTIAL"
  | "OUTCOME_ONLY"
  | "TRUNCATED"
  | "MISSING";

export type SurvivalV2HpEvidenceQuality =
  | "EXPLICIT"
  | "RECONSTRUCTED"
  | "PARTIAL"
  | "MISSING";

export type SurvivalV2ComponentState = "SCORED" | "NOT_APPLICABLE" | "UNAVAILABLE";

export type SurvivalV2RelativeReliability =
  | "RELIABLE"
  | "UNRELIABLE"
  | "INSUFFICIENT"
  | "EXCLUDED_ROLE";

export interface SurvivalV2ToolkitEntry {
  category: SurvivalV2DefensiveCategory | "SELF_HEAL" | "CONSUMABLE";
  state: SurvivalV2ToolkitAvailabilityState;
  reason?: string | null;
  spellIds?: number[];
}

export interface SurvivalV2DeathFact {
  count: number;
  /**
   * OBSERVED: death dataset present (zero deaths is valid evidence).
   * MISSING: death capability unavailable — must not score as zero deaths.
   */
  evidenceState?: "OBSERVED" | "MISSING";
  timestampsMs?: number[];
  /** Compact cause labels — never raw event dumps. */
  causes?: string[];
}

export interface SurvivalV2ActiveCombatFact {
  /** Milliseconds of active combat (preferred denominator). */
  durationMs: number;
  fightDurationMs: number;
  truncated?: boolean;
}

export interface SurvivalV2TimedActivationFact {
  id: string;
  timestampMs: number;
  abilityGameId: number;
  category: SurvivalV2DefensiveCategory | "SELF_HEAL" | "CONSUMABLE";
}

export interface SurvivalV2DefensiveActivationFact {
  byCategory: Partial<Record<SurvivalV2DefensiveCategory, number>>;
  toolkit: SurvivalV2ToolkitEntry[];
  /** 0–1 fraction of expected defensive rules with catalog coverage. */
  catalogCoverage: number;
  /** Timed personal defensive activations for CD availability reconstruction. */
  timedActivations?: SurvivalV2TimedActivationFact[];
}

/**
 * Compact danger / pressure window fact.
 * Extractors may emit pre-merge windows; scoring applies pressure-cluster dedupe.
 */
export interface SurvivalV2DangerWindowFact {
  startMs: number;
  endMs: number;
  triggerTypes: string[];
  hpEvidenceQuality: SurvivalV2HpEvidenceQuality;
  damageAmount?: number | null;
  /** Recovery useful within this window (self-heal / healthstone / potion observed). */
  recoveryUseful?: boolean;
  /** Window is eligible for recovery scoring (low HP / large hit with health context). */
  recoveryEligible?: boolean;
  deathOutcome?: boolean;
  availabilityState?: SurvivalV2ToolkitAvailabilityState | null;
  /** Phase 2 contextual defensive response (strongest supported state). */
  defensiveResponseClass?:
    | "ANTICIPATED"
    | "REACTIVE"
    | "NO_RESPONSE_AVAILABLE"
    | "NO_TOOL_AVAILABLE"
    | "NOT_OBSERVABLE";
  /** Phase 2 contextual emergency recovery response. */
  recoveryResponseClass?:
    | "TIMELY_RECOVERY"
    | "LATE_RECOVERY"
    | "NO_RECOVERY_AVAILABLE"
    | "NO_SELF_HEAL_AVAILABLE"
    | "NOT_OBSERVABLE";
}

export interface SurvivalV2RelativeDamageFact {
  role: "DPS" | "TANK" | "HEALER";
  /** Target avoidable damage per active-combat second (after exclusions). */
  targetDamagePerActiveSecond: number | null;
  nonTankGroupMedianPerActiveSecond: number | null;
  selfDamageExcluded: boolean;
  mandatoryDamageExcluded: boolean;
  mechanicExclusionCoverage: number;
  passiveMitigationCaveat?: string | null;
  limitations?: string[];
}

/** Bounded Survival fact document persisted on RunFactSet.facts. */
export interface SurvivalFactDocumentV2 {
  schemaVersion: typeof SURVIVAL_V2_SCHEMA_VERSION;
  extractorFamily: typeof SURVIVAL_V2_EXTRACTOR_FAMILY;
  extractorVersion: string;
  dungeonSlug: string;
  slotIndex: number;
  identity: {
    reportCode: string;
    fightId: number;
    reportRevision: number;
  };
  keyLevel: number | null;
  deaths: SurvivalV2DeathFact;
  activeCombat: SurvivalV2ActiveCombatFact;
  defensiveActivations: SurvivalV2DefensiveActivationFact;
  /** Pre-dedupe or already-deduped danger windows (bounded). */
  dangerWindows: SurvivalV2DangerWindowFact[];
  /** When true, dangerWindows are already pressure-cluster merged. */
  pressureClustersPremerged?: boolean;
  healthEvidence: {
    mode: SurvivalV2HealthEvidenceMode;
    catalogSelfHealCoverage?: number;
  };
  relativeDamage?: SurvivalV2RelativeDamageFact | null;
  limitations: string[];
}

export interface SurvivalV2ComponentResult {
  metricKey: string;
  state: SurvivalV2ComponentState;
  score: number | null;
  weightUsed: number;
  reason: string | null;
  evidence: Record<string, unknown>;
}

export interface SurvivalV2RelativeDamageShadow {
  mode: SurvivalV2RelativeDamageMode;
  reliability: SurvivalV2RelativeReliability;
  /** Diagnostic ratio only — never contributes when mode !== active. */
  score: number | null;
  publicContribution: 0;
  reasons: string[];
  evidence: Record<string, unknown>;
}

export interface SurvivalV2RunScore {
  dungeonSlug: string;
  slotIndex: number;
  identity: SurvivalFactDocumentV2["identity"];
  keyLevel: number | null;
  behavioralScore: number | null;
  outcome: SurvivalV2ComponentResult;
  defensive: SurvivalV2ComponentResult;
  recovery: SurvivalV2ComponentResult;
  relativeDamageShadow: SurvivalV2RelativeDamageShadow;
  weightsApplied: {
    outcome: number;
    defensive: number;
    recovery: number;
    relativeDamage: number;
  };
  healthEvidenceMode: SurvivalV2HealthEvidenceMode;
  pressureClusterCount: number;
  deathCount: number;
  limitations: string[];
  valid: boolean;
  invalidReason: string | null;
}

export interface SurvivalV2DungeonAggregate {
  dungeonSlug: string;
  runCount: number;
  medianBehavioralScore: number | null;
  medianOutcome: number | null;
  medianDefensive: number | null;
  medianRecovery: number | null;
  runs: SurvivalV2RunScore[];
}

export interface SurvivalV2ComputeInput {
  /** Frozen EvidenceManifestV2 — sole selected-run authority. */
  manifest: CharacterSeasonEvidenceManifestV2;
  /** One Survival fact document per selected/valid slot (keyed by dungeon+slotIndex). */
  factSets: SurvivalFactDocumentV2[];
  relativeDamageMode?: SurvivalV2RelativeDamageMode;
  /** Optional score model id for explanation/fingerprint only. */
  scoreModelId?: string | null;
}

/** Dimension availability — never includes SHADOW (lifecycle-only). */
export type SurvivalV2AvailabilityState = "AVAILABLE" | "PARTIAL" | "UNAVAILABLE";

export interface SurvivalV2ContributorDiagnostic {
  metricKey: string;
  score: number | null;
  weight: number | null;
  state: SurvivalV2ComponentState | "SHADOW_DIAGNOSTIC";
  detail: Record<string, unknown>;
}

export interface SurvivalV2ComputeResult {
  algorithmVersion: string;
  modelLabel: string;
  calibrationStatus: SurvivalV2CalibrationStatus;
  modelConfigFingerprint: string;
  inputFingerprint: string;
  score: number | null;
  confidence: number;
  /** Availability vocabulary only — SHADOW is DimensionComputation lifecycle. */
  state: SurvivalV2AvailabilityState;
  dungeons: SurvivalV2DungeonAggregate[];
  components: {
    outcome: number | null;
    defensive: number | null;
    recovery: number | null;
    relativeDamage: number | null;
  };
  observations: {
    "survival.outcome": number | null;
    "survival.defensive_response": number | null;
    "survival.emergency_recovery": number | null;
    "survival.relative_avoidable_damage": number | null;
  };
  relativeDamageMode: SurvivalV2RelativeDamageMode;
  /** Mean relative score when weight-active across runs; else null. */
  relativeDamagePublicContribution: number | null;
  explanation: {
    selectedSlotCount: number;
    expectedSlotCount: number;
    scoredRunCount: number;
    pressureClusterCount: number;
    deathCount: number;
    healthModes: Record<string, number>;
    notes: string[];
    limitations: string[];
    contributors: SurvivalV2ContributorDiagnostic[];
    perDungeon: Array<{
      dungeonSlug: string;
      medianBehavioralScore: number | null;
      runCount: number;
      slotIndexes: number[];
    }>;
  };
  /** Shadow DimensionComputation metrics document. */
  metrics: Record<string, unknown>;
}

/** Replayable calibration export (provider-free). */
export interface SurvivalV2CalibrationExport {
  schemaVersion: typeof SURVIVAL_V2_CALIBRATION_SCHEMA_VERSION;
  algorithmVersion: string;
  modelConfig: SurvivalV2ModelConfig;
  input: SurvivalV2ComputeInput;
  result: Pick<
    SurvivalV2ComputeResult,
    | "score"
    | "confidence"
    | "state"
    | "inputFingerprint"
    | "components"
    | "observations"
    | "relativeDamageMode"
  >;
  contributors: SurvivalV2ContributorDiagnostic[];
}

/** Shadow DimensionComputation payload (persistence wiring is worker-owned). */
export interface SurvivalV2ShadowDimensionPayload {
  characterId: string;
  seasonId: string;
  manifestId: string;
  scoreModelId: string;
  dimension: "SURVIVAL";
  algorithmVersion: string;
  inputFingerprint: string;
  score: number | null;
  confidence: number;
  state: "SHADOW";
  metrics: Record<string, unknown>;
  explanation: SurvivalV2ComputeResult["explanation"];
  computedAt: Date;
}
