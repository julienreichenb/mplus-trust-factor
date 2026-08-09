/**
 * Shared typed extractor contracts for Scoring V2 Phase 1 shadow facts.
 * Pure / fixture-backed — no network, no provider clients.
 */

import type {
  PerformanceProfileAggregateFactV2,
  PerformanceRunParseFactV2,
  SurvivalFactDocumentV2,
  UtilityV2RunFactSet,
} from "@mplus/scoring";
import type { PERFORMANCE_V2_EXTRACTOR_FAMILY } from "./constants.js";

export type ScoringExtractableDimension = "PERFORMANCE" | "SURVIVAL" | "UTILITY";

/**
 * Per-dimension extraction outcome for acquisition persistence.
 * WRITTEN = typed fact ready to persist; UNAVAILABLE = safe absence;
 * FAILED = extraction error isolated from other dimensions.
 */
export type DimensionFactExtractionStatus = "WRITTEN" | "UNAVAILABLE" | "FAILED";

/** Bounded failure/unavailable categories for scoring_v2.* telemetry (no high-cardinality labels). */
export type FactExtractionCategory =
  | "missing_source_dataset"
  | "incomplete_shared_evidence"
  | "incompatible_evidence"
  | "truncated_beyond_contract"
  | "identity_incomplete"
  | "parse_unavailable"
  | "analysis_failed"
  | "empty_fact"
  | "unknown";

export interface DimensionFactExtractionOutcome<T> {
  status: DimensionFactExtractionStatus;
  dimension: ScoringExtractableDimension;
  fact: T | null;
  limitations: string[];
  /** Stable category for observability — never report codes / raw payloads. */
  category: FactExtractionCategory | null;
  /** Short machine reason; never includes report codes or unbounded blobs. */
  reason: string | null;
}

/** Frozen slot binding required by every typed fact set. */
export interface FrozenSlotBindingV2 {
  slotId: string;
  dungeonSlug: string;
  slotIndex: 0 | 1;
  keyLevel: number | null;
  identity: {
    reportCode: string;
    fightId: number;
    reportRevision: number;
  };
}

/**
 * Provider-shaped ranking/parse evidence for one frozen slot.
 * Produced upstream from persisted RANKING_PARSE / discovery rows — not calculator input.
 */
export interface RankingParseEvidenceV2 {
  reportCode: string;
  fightId: number;
  reportRevision: number;
  dungeonSlug: string;
  keyLevel: number;
  /** Prefer bracketPercent for same-key semantics. */
  bracketPercent: number | null;
  rankPercent: number | null;
  amountPercent: number | null;
  /** Raw throughput amount (explanatory only). */
  amount: number | null;
  partition: number | null;
  /**
   * Character that owns this ranking row (encounterRankings / zone rankings).
   * When set, resolveRankingParseForParticipant must not apply the row to other
   * participants in the same fight.
   */
  characterId?: string | null;
  /** Optional WCL actor id when known; never invent. */
  participantActorId?: number | null;
}

/**
 * Persisted Performance fact document (RunFactSet.facts).
 * Calculator consumes the projected PerformanceRunParseFactV2 via toPerformanceRunParseFactV2.
 */
export interface PerformanceFactDocumentV2 {
  schemaVersion: string;
  extractorFamily: typeof PERFORMANCE_V2_EXTRACTOR_FAMILY;
  extractorVersion: string;
  kind: "performance_run_parse_fact_v2";
  slotId: string;
  dungeonSlug: string;
  keyLevel: number;
  parsePercentile: number | null;
  semantic: PerformanceRunParseFactV2["semantic"];
  partition: number | null;
  rawDps: number | null;
  identity: FrozenSlotBindingV2["identity"];
  limitations: string[];
}

export type PerformanceFactExtractionOutcome =
  DimensionFactExtractionOutcome<PerformanceFactDocumentV2>;

export type PerformanceProfileExtractionOutcome =
  DimensionFactExtractionOutcome<PerformanceProfileAggregateFactV2>;

export type SurvivalFactExtractionOutcome =
  DimensionFactExtractionOutcome<SurvivalFactDocumentV2>;

export type UtilityFactExtractionOutcome =
  DimensionFactExtractionOutcome<UtilityV2RunFactSet>;
