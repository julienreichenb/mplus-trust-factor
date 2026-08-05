/**
 * Map ParticipantScoringDigestV1 → existing V2 calculator fact documents.
 * No formula changes. Calculators never see raw WCL pages or providers.
 */
import type {
  ParticipantScoringDigestV1,
  UtilityCanonicalAction,
} from "@mplus/contracts";
import {
  SURVIVAL_V2_EXTRACTOR_FAMILY,
  SURVIVAL_V2_SCHEMA_VERSION,
} from "../../survival/v2/constants.js";
import type {
  SurvivalFactDocumentV2,
  SurvivalV2DefensiveCategory,
} from "../../survival/v2/types.js";
import type { PerformanceRunParseFactV2 } from "../../performance/v2/types.js";
import {
  UTILITY_V2_EXTRACTOR_FAMILY,
  UTILITY_V2_EXTRACTOR_VERSION,
  UTILITY_V2_SCHEMA_VERSION,
  type UtilityV2SupportSemantic,
} from "../../utility/v2/constants.js";
import type {
  UtilityV2CcAction,
  UtilityV2RunFactSet,
  UtilityV2SupportAction,
} from "../../utility/v2/types.js";

export class DigestDimensionIncompleteError extends Error {
  readonly code = "DIGEST_DIMENSION_INCOMPLETE" as const;
  readonly dimension: "PERFORMANCE" | "UTILITY" | "SURVIVAL";
  readonly digestContentHash: string;

  constructor(
    dimension: "PERFORMANCE" | "UTILITY" | "SURVIVAL",
    digestContentHash: string,
    detail: string,
  ) {
    super(`digest_dimension_incomplete:${dimension}:${detail}`);
    this.name = "DigestDimensionIncompleteError";
    this.dimension = dimension;
    this.digestContentHash = digestContentHash;
  }
}

export function performanceRunParseFactFromDigest(
  digest: ParticipantScoringDigestV1,
  slotId: string,
): PerformanceRunParseFactV2 {
  if (digest.performance.completeness === "UNAVAILABLE") {
    throw new DigestDimensionIncompleteError(
      "PERFORMANCE",
      digest.contentHash,
      digest.performance.limitations.join(",") || "unavailable",
    );
  }
  return {
    slotId,
    dungeonSlug: digest.dungeonSlug ?? "unknown",
    keyLevel: digest.keyLevel ?? 0,
    parsePercentile: digest.performance.parsePercentile,
    semantic: digest.performance.parseSemantic,
    partition: digest.performance.partition,
    rawDps: digest.performance.rawDps,
    reportCode: digest.reportCode,
    fightId: digest.fightId,
    reportRevision: digest.reportRevision,
  };
}

function mapDefensiveCategory(
  category: string,
): SurvivalV2DefensiveCategory | null {
  switch (category) {
    case "DEFENSIVE_MAJOR":
    case "DEFENSIVE_MINOR":
    case "IMMUNITY":
      return category;
    default:
      return null;
  }
}

export function survivalFactDocumentFromDigest(
  digest: ParticipantScoringDigestV1,
  slotIndex: number,
): SurvivalFactDocumentV2 {
  if (digest.survival.completeness === "UNAVAILABLE") {
    throw new DigestDimensionIncompleteError(
      "SURVIVAL",
      digest.contentHash,
      digest.survival.limitations.join(",") || "unavailable",
    );
  }

  const byCategory: Partial<Record<SurvivalV2DefensiveCategory, number>> = {};
  for (const activation of digest.survival.personalDefensiveActivations) {
    const cat = mapDefensiveCategory(activation.defensiveCategory);
    if (!cat) continue;
    byCategory[cat] = (byCategory[cat] ?? 0) + 1;
  }

  const fightDurationMs =
    digest.survival.fightDurationMs ??
    digest.survival.activeCombatMs ??
    1_800_000;
  const activeCombatMs = digest.survival.activeCombatMs ?? fightDurationMs;

  return {
    schemaVersion: SURVIVAL_V2_SCHEMA_VERSION,
    extractorFamily: SURVIVAL_V2_EXTRACTOR_FAMILY,
    extractorVersion: digest.extractorCompatVersion,
    dungeonSlug: digest.dungeonSlug ?? "unknown",
    slotIndex,
    identity: {
      reportCode: digest.reportCode,
      fightId: digest.fightId,
      reportRevision: digest.reportRevision,
    },
    keyLevel: digest.keyLevel,
    deaths: {
      count: digest.survival.deaths.length,
      timestampsMs: digest.survival.deaths.map((d) => d.rawTimestampMs),
      causes: digest.survival.deaths
        .map((d) => d.killingAbilityName)
        .filter((n): n is string => n != null),
    },
    activeCombat: {
      durationMs: activeCombatMs,
      fightDurationMs,
      truncated: digest.survival.completeness === "PARTIAL",
    },
    defensiveActivations: {
      byCategory,
      toolkit: [],
      catalogCoverage: digest.survival.completeness === "COMPLETE" ? 1 : 0.5,
    },
    dangerWindows: digest.survival.pressureWindows.map((w) => ({
      startMs: w.derivation.windowStartMs,
      endMs: w.derivation.windowEndMs,
      triggerTypes: [w.windowClass],
      hpEvidenceQuality:
        w.derivation.maxHpUsed != null ? ("PARTIAL" as const) : ("MISSING" as const),
      damageAmount: w.derivation.totalDamage,
      recoveryUseful: w.response.recoveryAfter.length > 0,
      recoveryEligible: !w.response.noRecoveryResponse,
      deathOutcome:
        w.windowClass === "FATAL_PRESSURE" || w.response.deathEventIds.length > 0,
    })),
    pressureClustersPremerged: true,
    healthEvidence: {
      mode:
        digest.survival.completeness === "COMPLETE"
          ? "FULL"
          : digest.survival.completeness === "PARTIAL"
            ? "PARTIAL"
            : "MISSING",
    },
    relativeDamage: null,
    limitations: [...digest.survival.limitations],
  };
}

function supportSemanticFromAction(
  action: UtilityCanonicalAction,
): UtilityV2SupportSemantic {
  switch (action.utilityCategory) {
    case "COMBAT_RES":
      return "EMERGENCY_SUPPORT";
    case "EXTERNAL_SUPPORT":
      return "REACTIVE_SUPPORT";
    default:
      return "UNVERIFIED_EXTERNAL";
  }
}

function sourceKindFromAction(
  action: UtilityCanonicalAction,
): "PLAYER" | "OWNED_PET" {
  return action.attributedToPet ? "OWNED_PET" : "PLAYER";
}

export function utilityRunFactSetFromDigest(
  digest: ParticipantScoringDigestV1,
  input: { slotId: string; slotIndex: 0 | 1; runId?: string },
): UtilityV2RunFactSet {
  if (digest.utility.completeness === "UNAVAILABLE") {
    throw new DigestDimensionIncompleteError(
      "UTILITY",
      digest.contentHash,
      digest.utility.limitations.join(",") || "unavailable",
    );
  }

  const actions = digest.utility.actions;
  const interruptAttempts = actions
    .filter((a) => a.utilityCategory === "INTERRUPT")
    .map((a) => ({
      id: a.canonicalActionId,
      timestampMs: a.rawTimestampMs,
      abilityGameId: a.primarySpellId,
      sourceActorId: a.sourceActorId,
      sourceKind: sourceKindFromAction(a),
      targetActorId: a.targetActorId,
      classification:
        a.outcome === "SUCCESS"
          ? ("CONFIRMED_SUCCESS" as const)
          : a.outcome === "ATTEMPT"
            ? ("UNMATCHED_ATTEMPT" as const)
            : ("NOT_OBSERVABLE" as const),
      credit: a.outcome === "SUCCESS" ? 1 : a.outcome === "ATTEMPT" ? 0.25 : 0,
      note: a.abilityKey,
    }));

  const ccActions: UtilityV2CcAction[] = actions
    .filter(
      (a) =>
        a.utilityCategory === "CROWD_CONTROL" || a.utilityCategory === "STOP",
    )
    .map((a) => ({
      id: a.canonicalActionId,
      timestampMs: a.rawTimestampMs,
      abilityGameId: a.primarySpellId,
      sourceActorId: a.sourceActorId,
      sourceKind: sourceKindFromAction(a),
      targetActorId: a.targetActorId,
      inActiveCombat: true,
    }));

  const supportActions: UtilityV2SupportAction[] = actions
    .filter(
      (a) =>
        a.utilityCategory === "EXTERNAL_SUPPORT" ||
        a.utilityCategory === "COMBAT_RES",
    )
    .map((a) => ({
      id: a.canonicalActionId,
      timestampMs: a.rawTimestampMs,
      abilityGameId: a.primarySpellId,
      abilityName: a.canonicalName,
      sourceActorId: a.sourceActorId,
      sourceKind: sourceKindFromAction(a),
      targetActorId: a.targetActorId,
      semantic: supportSemanticFromAction(a),
      tier: "CONFIRMED_APPLICATION" as const,
    }));

  const dispelPurgeSuccessCount = actions.filter(
    (a) =>
      (a.utilityCategory === "OFFENSIVE_DISPEL" ||
        a.utilityCategory === "DEFENSIVE_DISPEL") &&
      a.outcome === "SUCCESS",
  ).length;

  const fightDurationMs = digest.survival.fightDurationMs ?? 1_800_000;
  const activeCombatMs = digest.survival.activeCombatMs ?? fightDurationMs;

  return {
    schemaVersion: UTILITY_V2_SCHEMA_VERSION,
    extractorFamily: UTILITY_V2_EXTRACTOR_FAMILY,
    extractorVersion: UTILITY_V2_EXTRACTOR_VERSION,
    slotId: input.slotId,
    runId: input.runId ?? `${digest.reportCode}:${digest.fightId}`,
    dungeonSlug: digest.dungeonSlug ?? "unknown",
    keyLevel: digest.keyLevel,
    slotIndex: input.slotIndex,
    reportCode: digest.reportCode,
    fightId: digest.fightId,
    reportRevision: digest.reportRevision,
    fightDurationMs,
    activeCombatMs,
    activeCombatHours: activeCombatMs / 3_600_000,
    hostileBegincastCount: 0,
    hostileObservability: "ABSENT",
    toolkit: {
      hasInterrupt: interruptAttempts.length > 0,
      hasSupport: supportActions.length > 0,
      hasStrategicCc: ccActions.length > 0,
    },
    interruptAttempts,
    ccActions,
    supportActions,
    dispelPurgeSuccessCount,
    catalogCoverage: {
      abilityCatalogCoverage: digest.utility.completeness === "COMPLETE" ? 1 : 0.5,
      mechanicCatalogCoverage: 0.5,
    },
    limitations: [...digest.utility.limitations],
  };
}

/** Score lineage stamp persisted alongside dimension results. */
export interface DigestScoreLineageV1 {
  digestArtifactId: string | null;
  digestContentHash: string;
  reportCode: string;
  fightId: number;
  reportRevision: number;
  scoreModelId: string;
  scoreModelVersion: string | null;
  dimension: "PERFORMANCE" | "UTILITY" | "SURVIVAL";
}

export function buildDigestScoreLineage(input: {
  digest: ParticipantScoringDigestV1;
  digestArtifactId?: string | null;
  scoreModelId: string;
  scoreModelVersion?: string | null;
  dimension: "PERFORMANCE" | "UTILITY" | "SURVIVAL";
}): DigestScoreLineageV1 {
  return {
    digestArtifactId: input.digestArtifactId ?? null,
    digestContentHash: input.digest.contentHash,
    reportCode: input.digest.reportCode,
    fightId: input.digest.fightId,
    reportRevision: input.digest.reportRevision,
    scoreModelId: input.scoreModelId,
    scoreModelVersion: input.scoreModelVersion ?? null,
    dimension: input.dimension,
  };
}
