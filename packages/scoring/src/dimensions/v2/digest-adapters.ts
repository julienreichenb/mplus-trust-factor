/**
 * Map ParticipantScoringDigestV1 → existing V2 calculator fact documents.
 * No formula changes. Calculators never see raw WCL pages or providers.
 */
import {
  getAbilityCatalog,
  spellIdsForCategory,
} from "@mplus/abilities";
import type {
  ParticipantScoringDigestV1,
  UtilityCanonicalAction,
  UtilityCapabilityCompleteness,
} from "@mplus/contracts";
import {
  SURVIVAL_V2_EXTRACTOR_FAMILY,
  SURVIVAL_V2_SCHEMA_VERSION,
} from "../../survival/v2/constants.js";
import {
  classifyDefensiveResponse,
  classifyRecoveryResponse,
  resolveSurvivalCatalogTools,
} from "../../survival/v2/contextual.js";
import type {
  SurvivalFactDocumentV2,
  SurvivalV2DefensiveCategory,
  SurvivalV2TimedActivationFact,
} from "../../survival/v2/types.js";
import type { PerformanceRunParseFactV2 } from "../../performance/v2/types.js";
import {
  UTILITY_V2_EXTRACTOR_FAMILY,
  UTILITY_V2_EXTRACTOR_VERSION,
  UTILITY_V2_INTERRUPT_CREDITS,
  UTILITY_V2_SCHEMA_VERSION,
  type UtilityV2SupportSemantic,
} from "../../utility/v2/constants.js";
import type {
  ClassifiedInterruptAttempt,
  InterruptAttemptClass,
  UtilityV2CcAction,
  UtilityV2RunFactSet,
  UtilityV2SupportAction,
  UtilityV2ToolkitApplicability,
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

function mapRecoveryCategory(
  category: string,
): "SELF_HEAL" | "CONSUMABLE" | null {
  switch (category) {
    case "SELF_HEAL":
    case "CONSUMABLE":
      return category;
    default:
      return null;
  }
}

function capabilityStatus(
  capabilities: ReadonlyArray<{ capability: string; status: string }>,
  key: string,
): "COMPLETE" | "INCOMPLETE" | "UNAVAILABLE" | null {
  const status = capabilities.find((c) => c.capability === key)?.status;
  if (status === "COMPLETE" || status === "INCOMPLETE" || status === "UNAVAILABLE") {
    return status;
  }
  return null;
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
  const timedDefensives: SurvivalV2TimedActivationFact[] = [];
  for (const activation of digest.survival.personalDefensiveActivations) {
    const cat = mapDefensiveCategory(activation.defensiveCategory);
    if (!cat) continue;
    byCategory[cat] = (byCategory[cat] ?? 0) + 1;
    timedDefensives.push({
      id: activation.canonicalActivationId,
      timestampMs: activation.rawTimestampMs,
      abilityGameId: activation.primarySpellId,
      category: cat,
    });
  }

  const recoveryById = new Map<string, SurvivalV2TimedActivationFact>();
  const timedRecovery: SurvivalV2TimedActivationFact[] = [];
  for (const activation of digest.survival.recoveryActivations) {
    const cat = mapRecoveryCategory(activation.defensiveCategory);
    if (!cat) continue;
    const row: SurvivalV2TimedActivationFact = {
      id: activation.canonicalActivationId,
      timestampMs: activation.rawTimestampMs,
      abilityGameId: activation.primarySpellId,
      category: cat,
    };
    timedRecovery.push(row);
    recoveryById.set(row.id, row);
  }

  const catalogTools = resolveSurvivalCatalogTools({
    classSlug: digest.classSlug,
    specSlug: digest.specSlug,
  });

  const deathsCapability = capabilityStatus(
    digest.survival.capabilityCompleteness,
    "SURVIVAL_DEATHS",
  );
  const damageCapability = capabilityStatus(
    digest.survival.capabilityCompleteness,
    "SURVIVAL_DAMAGE_TAKEN",
  );
  const defensiveCapability = capabilityStatus(
    digest.survival.capabilityCompleteness,
    "SURVIVAL_DEFENSIVE_ACTIVATIONS",
  );
  const recoveryCapability = capabilityStatus(
    digest.survival.capabilityCompleteness,
    "SURVIVAL_RECOVERY_ACTIVATIONS",
  );

  const timingObservable =
    damageCapability !== "UNAVAILABLE" &&
    defensiveCapability !== "UNAVAILABLE";

  const recoveryTimingObservable =
    timingObservable && recoveryCapability !== "UNAVAILABLE";

  const dangerWindows = digest.survival.pressureWindows.map((w) => {
    const defensiveResponseClass = classifyDefensiveResponse({
      defensivesBefore: w.response.defensivesBefore,
      defensivesDuring: w.response.defensivesDuring,
      timingObservable,
      tools: catalogTools.defensiveTools,
      activations: timedDefensives,
      dangerStartMs: w.derivation.windowStartMs,
    });
    const recoveryResponseClass = classifyRecoveryResponse({
      recoveryActivationIds: w.response.recoveryAfter,
      recoveryById,
      dangerEndMs: w.derivation.windowEndMs,
      timingObservable: recoveryTimingObservable,
      tools: catalogTools.selfHealTools,
      activations: timedRecovery,
    });

    return {
      startMs: w.derivation.windowStartMs,
      endMs: w.derivation.windowEndMs,
      triggerTypes: [w.windowClass],
      hpEvidenceQuality:
        w.derivation.maxHpUsed != null
          ? ("PARTIAL" as const)
          : ("MISSING" as const),
      damageAmount: w.derivation.totalDamage,
      recoveryUseful: w.response.recoveryAfter.length > 0,
      recoveryEligible:
        !w.response.noRecoveryResponse ||
        recoveryResponseClass === "NO_RECOVERY_AVAILABLE" ||
        recoveryResponseClass === "TIMELY_RECOVERY" ||
        recoveryResponseClass === "LATE_RECOVERY",
      deathOutcome:
        w.windowClass === "FATAL_PRESSURE" ||
        w.response.deathEventIds.length > 0,
      defensiveResponseClass,
      recoveryResponseClass,
      availabilityState:
        recoveryResponseClass === "NO_SELF_HEAL_AVAILABLE"
          ? ("NOT_APPLICABLE" as const)
          : recoveryResponseClass === "NOT_OBSERVABLE"
            ? ("UNKNOWN" as const)
            : ("AVAILABLE_CONFIRMED" as const),
    };
  });

  const fightDurationMs =
    digest.survival.fightDurationMs ??
    digest.survival.activeCombatMs ??
    1_800_000;
  const activeCombatMs = digest.survival.activeCombatMs ?? fightDurationMs;

  const limitations = [...digest.survival.limitations];
  if (!catalogTools.supported) {
    limitations.push("class_spec_identity_unknown");
    limitations.push(
      `ability_catalog:${catalogTools.unsupportedReason ?? "UNSUPPORTED"}`,
    );
  }
  limitations.push("relative_damage_omitted_unreliable_for_phase2");

  const deathEvidenceMissing = deathsCapability === "UNAVAILABLE";

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
      count: deathEvidenceMissing ? 0 : digest.survival.deaths.length,
      evidenceState: deathEvidenceMissing ? "MISSING" : "OBSERVED",
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
      toolkit: catalogTools.toolkit.filter((t) =>
        ["DEFENSIVE_MAJOR", "DEFENSIVE_MINOR", "IMMUNITY", "SELF_HEAL", "CONSUMABLE"].includes(
          t.category,
        ),
      ),
      catalogCoverage: catalogTools.supported
        ? digest.survival.completeness === "COMPLETE"
          ? 1
          : 0.5
        : 0,
      timedActivations: timedDefensives,
    },
    dangerWindows,
    pressureClustersPremerged: true,
    healthEvidence: {
      mode:
        digest.survival.completeness === "COMPLETE"
          ? "FULL"
          : digest.survival.completeness === "PARTIAL"
            ? "PARTIAL"
            : "MISSING",
      catalogSelfHealCoverage: catalogTools.selfHealTools.some(
        (t) => t.availability === "BASELINE",
      )
        ? 1
        : catalogTools.selfHealTools.length > 0
          ? 0.5
          : 0,
    },
    relativeDamage: null,
    limitations,
  };
}

function supportSemanticFromAction(
  action: UtilityCanonicalAction,
): UtilityV2SupportSemantic {
  switch (action.utilityCategory) {
    case "COMBAT_RES":
      return "EMERGENCY_SUPPORT";
    case "EXTERNAL_SUPPORT":
      if (
        action.limitations.includes("EXTERNAL_TARGET_CONTEXT_INCOMPLETE") ||
        action.outcome === "UNKNOWN"
      ) {
        return "UNVERIFIED_EXTERNAL";
      }
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

/**
 * Map persisted interrupt outcomes → V2 attempt classes.
 *
 * Digest outcomes are SUCCESS | ATTEMPT | UNKNOWN (no hostile windows persisted).
 * VALID_OVERLAP / MATCHED_FAILED require hostile cast windows and remain available
 * when richer fact sets are supplied; the digest path never invents them.
 */
export function classifyDigestInterruptOutcome(input: {
  outcome: UtilityCanonicalAction["outcome"];
  interruptsCapability: UtilityCapabilityCompleteness["status"] | null;
}): { classification: InterruptAttemptClass; credit: number; note: string } {
  if (input.outcome === "SUCCESS") {
    return {
      classification: "CONFIRMED_SUCCESS",
      credit: UTILITY_V2_INTERRUPT_CREDITS.CONFIRMED_SUCCESS,
      note: "digest_confirmed_interrupt_event",
    };
  }
  if (input.outcome === "UNKNOWN") {
    return {
      classification: "NOT_OBSERVABLE",
      credit: UTILITY_V2_INTERRUPT_CREDITS.NOT_OBSERVABLE,
      note: "digest_outcome_unknown",
    };
  }
  // ATTEMPT — kick cast without confirmed interrupt event.
  if (
    input.interruptsCapability == null ||
    input.interruptsCapability === "UNAVAILABLE" ||
    input.interruptsCapability === "INCOMPLETE"
  ) {
    return {
      classification: "NOT_OBSERVABLE",
      credit: UTILITY_V2_INTERRUPT_CREDITS.NOT_OBSERVABLE,
      note: "digest_interrupt_confirmation_not_observable",
    };
  }
  return {
    classification: "UNMATCHED_ATTEMPT",
    credit: UTILITY_V2_INTERRUPT_CREDITS.UNMATCHED_ATTEMPT,
    note: "digest_attempt_without_confirmed_interrupt",
  };
}

function hasApplicationEvidence(action: UtilityCanonicalAction): boolean {
  return action.evidenceEventTypes.some(
    (t) =>
      t === "applybuff" ||
      t === "applydebuff" ||
      t === "applybuffstack" ||
      t === "applydebuffstack" ||
      t === "apply",
  );
}

/**
 * Strongest observable support tier from persisted digest evidence.
 * Never invents mitigation impact that is not observable in the digest.
 */
export function supportEvidenceTierFromDigestAction(
  action: UtilityCanonicalAction,
): UtilityV2SupportAction["tier"] {
  if (
    action.limitations.includes("EXTERNAL_TARGET_CONTEXT_INCOMPLETE") ||
    action.outcome === "UNKNOWN"
  ) {
    return "UNVERIFIED";
  }
  if (action.utilityCategory === "COMBAT_RES" && action.outcome === "SUCCESS") {
    return "CONFIRMED_IMPACT";
  }
  if (
    (action.utilityCategory === "OFFENSIVE_DISPEL" ||
      action.utilityCategory === "DEFENSIVE_DISPEL") &&
    action.outcome === "SUCCESS"
  ) {
    return "CONFIRMED_IMPACT";
  }
  if (action.outcome === "SUCCESS" || hasApplicationEvidence(action)) {
    return "CONFIRMED_APPLICATION";
  }
  return "UNVERIFIED";
}

function resolveToolkitFromDigest(
  digest: ParticipantScoringDigestV1,
  observed: {
    hasInterrupt: boolean;
    hasSupport: boolean;
    hasStrategicCc: boolean;
  },
): { toolkit: UtilityV2ToolkitApplicability; limitations: string[] } {
  const catalog = getAbilityCatalog({
    classSlug: digest.classSlug,
    specSlug: digest.specSlug,
    includeRacials: true,
  });
  if (!catalog.supported) {
    return {
      toolkit: {
        hasInterrupt: observed.hasInterrupt,
        hasSupport: observed.hasSupport,
        hasStrategicCc: observed.hasStrategicCc,
      },
      limitations: [
        "class_spec_identity_unknown",
        `ability_catalog:${catalog.unsupportedReason ?? "UNSUPPORTED"}`,
        "toolkit_coverage_unconfirmed",
      ],
    };
  }
  const classSlug = digest.classSlug;
  const specSlug = digest.specSlug;
  return {
    toolkit: {
      hasInterrupt:
        spellIdsForCategory(catalog, "INTERRUPT", { classSlug, specSlug }).size >
          0 || observed.hasInterrupt,
      hasSupport:
        spellIdsForCategory(catalog, "DISPEL", { classSlug, specSlug }).size > 0 ||
        spellIdsForCategory(catalog, "PURGE", { classSlug, specSlug }).size > 0 ||
        spellIdsForCategory(catalog, "EXTERNAL_DEFENSIVE", {
          classSlug,
          specSlug,
        }).size > 0 ||
        spellIdsForCategory(catalog, "BATTLE_REZ", { classSlug, specSlug })
          .size > 0 ||
        observed.hasSupport,
      hasStrategicCc:
        spellIdsForCategory(catalog, "HARD_CC", { classSlug, specSlug }).size >
          0 || observed.hasStrategicCc,
    },
    limitations: [],
  };
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
  const interruptsCapability = capabilityStatus(
    digest.utility.capabilityCompleteness,
    "UTILITY_INTERRUPTS",
  );

  const interruptAttempts: ClassifiedInterruptAttempt[] = actions
    .filter((a) => a.utilityCategory === "INTERRUPT")
    .map((a) => {
      const mapped = classifyDigestInterruptOutcome({
        outcome: a.outcome,
        interruptsCapability,
      });
      return {
        id: a.canonicalActionId,
        timestampMs: a.rawTimestampMs,
        abilityGameId: a.primarySpellId,
        sourceActorId: a.sourceActorId,
        sourceKind: sourceKindFromAction(a),
        targetActorId: a.targetActorId,
        classification: mapped.classification,
        credit: mapped.credit,
        note: mapped.note,
      };
    });

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
      tier: supportEvidenceTierFromDigestAction(a),
    }));

  const dispelPurgeSuccessCount = actions.filter(
    (a) =>
      (a.utilityCategory === "OFFENSIVE_DISPEL" ||
        a.utilityCategory === "DEFENSIVE_DISPEL") &&
      a.outcome === "SUCCESS",
  ).length;

  const fightDurationMs = digest.survival.fightDurationMs ?? 1_800_000;
  const activeCombatMs = digest.survival.activeCombatMs ?? fightDurationMs;

  const observedToolkit = {
    hasInterrupt: interruptAttempts.length > 0,
    hasSupport: supportActions.length > 0 || dispelPurgeSuccessCount > 0,
    hasStrategicCc: ccActions.length > 0,
  };
  const resolvedToolkit = resolveToolkitFromDigest(digest, observedToolkit);

  const limitations = [
    ...digest.utility.limitations,
    ...resolvedToolkit.limitations,
    // Hostile cast windows are not persisted on ParticipantScoringDigestV1.
    // Digest path therefore cannot emit VALID_OVERLAP / MATCHED_FAILED.
    "hostile_cast_windows_not_persisted_in_digest",
    "digest_interrupt_classes_limited_to_success_attempt_unknown",
  ];

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
    toolkit: resolvedToolkit.toolkit,
    interruptAttempts,
    ccActions,
    supportActions,
    dispelPurgeSuccessCount,
    catalogCoverage: {
      abilityCatalogCoverage: digest.utility.completeness === "COMPLETE" ? 1 : 0.5,
      mechanicCatalogCoverage: 0.5,
    },
    limitations,
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
