/**
 * Performance V2 fact extractors — pure, fixture-backed, provider-free at call site.
 * Ranking/parse and profile evidence must already be persisted upstream.
 */

import type {
  PerformanceProfileAggregateFactV2,
  PerformanceProfileDungeonAggregateV2,
  PerformanceRunParseFactV2,
} from "@mplus/scoring";
import {
  isPointsAndDamageSchema,
  adaptPointsAndDamagePerformance,
} from "../../discovery/points-and-damage-performance.js";
import {
  FACT_V2_MAX_LIMITATIONS,
  PERFORMANCE_V2_EXTRACTOR_FAMILY,
  PERFORMANCE_V2_EXTRACTOR_VERSION,
  PERFORMANCE_V2_FACT_SCHEMA_VERSION,
} from "./constants.js";
import type {
  FrozenSlotBindingV2,
  PerformanceFactDocumentV2,
  PerformanceFactExtractionOutcome,
  PerformanceProfileExtractionOutcome,
  RankingParseEvidenceV2,
} from "./types.js";

function clampLimitations(limitations: string[]): string[] {
  return [...new Set(limitations.filter((l) => l.length > 0))].slice(
    0,
    FACT_V2_MAX_LIMITATIONS,
  );
}

function resolveParse(
  evidence: RankingParseEvidenceV2,
): {
  parsePercentile: number | null;
  semantic: PerformanceRunParseFactV2["semantic"];
  limitations: string[];
} {
  const limitations: string[] = [];
  if (
    evidence.bracketPercent != null &&
    Number.isFinite(evidence.bracketPercent)
  ) {
    return {
      parsePercentile: Math.max(0, Math.min(100, evidence.bracketPercent)),
      semantic: "BRACKET_PERCENT",
      limitations,
    };
  }
  if (evidence.rankPercent != null && Number.isFinite(evidence.rankPercent)) {
    limitations.push("parse_semantic:rank_percent_fallback");
    return {
      parsePercentile: Math.max(0, Math.min(100, evidence.rankPercent)),
      semantic: "RANK_PERCENT",
      limitations,
    };
  }
  if (
    evidence.amountPercent != null &&
    Number.isFinite(evidence.amountPercent)
  ) {
    limitations.push("parse_semantic:amount_percent_fallback");
    return {
      parsePercentile: Math.max(0, Math.min(100, evidence.amountPercent)),
      semantic: "RANK_PERCENT",
      limitations,
    };
  }
  return {
    parsePercentile: null,
    semantic: "UNAVAILABLE",
    limitations: ["parse_percentile_unavailable"],
  };
}

function identitiesMatch(
  slot: FrozenSlotBindingV2,
  evidence: RankingParseEvidenceV2,
): boolean {
  return (
    slot.identity.reportCode === evidence.reportCode &&
    slot.identity.fightId === evidence.fightId &&
    slot.identity.reportRevision === evidence.reportRevision
  );
}

/**
 * Extract a bounded Performance fact document for one frozen manifest slot.
 */
export function extractPerformanceRunParseFactV2(input: {
  slot: FrozenSlotBindingV2;
  evidence: RankingParseEvidenceV2 | null;
  /** Explicit absent reason when evidence is null (conclusive provider blocker). */
  absentReason?: string | null;
  extractorVersion?: string;
}): PerformanceFactExtractionOutcome {
  const extractorVersion =
    input.extractorVersion ?? PERFORMANCE_V2_EXTRACTOR_VERSION;
  const { slot } = input;

  if (
    !slot.identity.reportCode ||
    !Number.isFinite(slot.identity.fightId) ||
    !Number.isFinite(slot.identity.reportRevision)
  ) {
    return {
      status: "UNAVAILABLE",
      dimension: "PERFORMANCE",
      fact: null,
      limitations: ["identity_incomplete"],
      category: "identity_incomplete",
      reason: "frozen_slot_identity_incomplete",
    };
  }

  if (input.evidence == null) {
    const reason =
      input.absentReason && input.absentReason.trim().length > 0
        ? input.absentReason.trim()
        : "ranking_parse_absent";
    return {
      status: "UNAVAILABLE",
      dimension: "PERFORMANCE",
      fact: null,
      limitations: ["missing_ranking_parse_evidence", reason],
      category: "missing_source_dataset",
      reason,
    };
  }

  if (!identitiesMatch(slot, input.evidence)) {
    return {
      status: "FAILED",
      dimension: "PERFORMANCE",
      fact: null,
      limitations: ["frozen_identity_mismatch"],
      category: "incompatible_evidence",
      reason: "evidence_identity_does_not_match_frozen_slot",
    };
  }

  const resolved = resolveParse(input.evidence);
  const keyLevel =
    slot.keyLevel ??
    (Number.isFinite(input.evidence.keyLevel) ? input.evidence.keyLevel : null);

  if (keyLevel == null || !Number.isFinite(keyLevel)) {
    return {
      status: "UNAVAILABLE",
      dimension: "PERFORMANCE",
      fact: null,
      limitations: clampLimitations([
        ...resolved.limitations,
        "key_level_missing",
      ]),
      category: "incomplete_shared_evidence",
      reason: "key_level_missing",
    };
  }

  if (resolved.semantic === "UNAVAILABLE" || resolved.parsePercentile == null) {
    const fact: PerformanceFactDocumentV2 = {
      schemaVersion: PERFORMANCE_V2_FACT_SCHEMA_VERSION,
      extractorFamily: PERFORMANCE_V2_EXTRACTOR_FAMILY,
      extractorVersion,
      kind: "performance_run_parse_fact_v2",
      slotId: slot.slotId,
      dungeonSlug: slot.dungeonSlug || input.evidence.dungeonSlug,
      keyLevel,
      parsePercentile: null,
      semantic: "UNAVAILABLE",
      partition: input.evidence.partition,
      rawDps: input.evidence.amount,
      identity: { ...slot.identity },
      limitations: clampLimitations(resolved.limitations),
    };
    return {
      status: "UNAVAILABLE",
      dimension: "PERFORMANCE",
      fact,
      limitations: fact.limitations,
      category: "parse_unavailable",
      reason: "parse_percentile_unavailable",
    };
  }

  const fact: PerformanceFactDocumentV2 = {
    schemaVersion: PERFORMANCE_V2_FACT_SCHEMA_VERSION,
    extractorFamily: PERFORMANCE_V2_EXTRACTOR_FAMILY,
    extractorVersion,
    kind: "performance_run_parse_fact_v2",
    slotId: slot.slotId,
    dungeonSlug: slot.dungeonSlug || input.evidence.dungeonSlug,
    keyLevel,
    parsePercentile: resolved.parsePercentile,
    semantic: resolved.semantic,
    partition: input.evidence.partition,
    rawDps: input.evidence.amount,
    identity: { ...slot.identity },
    limitations: clampLimitations(resolved.limitations),
  };

  return {
    status: "WRITTEN",
    dimension: "PERFORMANCE",
    fact,
    limitations: fact.limitations,
    category: null,
    reason: null,
  };
}

/** Project persisted Performance fact document → calculator run-parse fact. */
export function toPerformanceRunParseFactV2(
  doc: PerformanceFactDocumentV2,
): PerformanceRunParseFactV2 {
  return {
    slotId: doc.slotId,
    dungeonSlug: doc.dungeonSlug,
    keyLevel: doc.keyLevel,
    parsePercentile: doc.parsePercentile,
    semantic: doc.semantic,
    partition: doc.partition,
    rawDps: doc.rawDps,
    reportCode: doc.identity.reportCode,
    fightId: doc.identity.fightId,
    reportRevision: doc.identity.reportRevision,
  };
}

export function isPerformanceFactDocumentV2(
  value: unknown,
): value is PerformanceFactDocumentV2 {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const v = value as Record<string, unknown>;
  return (
    v.kind === "performance_run_parse_fact_v2" &&
    v.extractorFamily === PERFORMANCE_V2_EXTRACTOR_FAMILY &&
    typeof v.slotId === "string" &&
    typeof v.dungeonSlug === "string"
  );
}

/**
 * Extract character-level profile aggregates from persisted points_and_damage payload.
 */
export function extractPerformanceProfileAggregateFactV2(input: {
  pointsAndDamagePayload: unknown | null;
}): PerformanceProfileExtractionOutcome {
  if (input.pointsAndDamagePayload == null) {
    return {
      status: "UNAVAILABLE",
      dimension: "PERFORMANCE",
      fact: null,
      limitations: ["missing_points_and_damage_payload"],
      category: "missing_source_dataset",
      reason: "profile_payload_absent",
    };
  }

  if (!isPointsAndDamageSchema(input.pointsAndDamagePayload)) {
    return {
      status: "UNAVAILABLE",
      dimension: "PERFORMANCE",
      fact: null,
      limitations: ["points_and_damage_schema_unsupported"],
      category: "incompatible_evidence",
      reason: "profile_schema_unsupported",
    };
  }

  try {
    const adapted = adaptPointsAndDamagePerformance({
      raw: input.pointsAndDamagePayload,
    });
    if (adapted.state !== "OK" || adapted.global == null) {
      return {
        status: "UNAVAILABLE",
        dimension: "PERFORMANCE",
        fact: null,
        limitations: [`profile_adapter_state:${adapted.state}`],
        category: "incomplete_shared_evidence",
        reason: "profile_adapter_not_ok",
      };
    }

    const perDungeon: PerformanceProfileDungeonAggregateV2[] =
      adapted.dungeonAggregates.map((d) => ({
        dungeonSlug: d.dungeonSlug,
        bestParsePercentile: d.bestParsePercentile,
        medianParsePercentile: d.medianParsePercentile,
        loggedRunCount: d.loggedRunCount ?? 0,
      }));

    const fact: PerformanceProfileAggregateFactV2 = {
      bestDpsPercentileAverage: adapted.global.bestDpsPercentileAverage,
      medianDpsPercentileAverage: adapted.global.medianDpsPercentileAverage,
      perDungeon,
      partition: adapted.global.partition,
      zoneId: adapted.global.zoneId,
      totalLoggedRuns: adapted.global.totalLoggedRuns,
      latestObservedAt: null,
    };

    return {
      status: "WRITTEN",
      dimension: "PERFORMANCE",
      fact,
      limitations: [],
      category: null,
      reason: null,
    };
  } catch {
    return {
      status: "FAILED",
      dimension: "PERFORMANCE",
      fact: null,
      limitations: ["profile_extraction_failed"],
      category: "analysis_failed",
      reason: "profile_adapter_threw",
    };
  }
}
