/**
 * Map ParticipantScoringDigestV1 → existing V2 calculator fact documents.
 * No formula changes. Calculators never see raw WCL pages or providers.
 */
import {
  resolveAbilityRuleBySpellId,
  type AbilityCatalogContext,
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
import { estimateActiveCombatMs } from "../../utility/v2/active-combat.js";
import {
  UTILITY_V2_EXTRACTOR_FAMILY,
  UTILITY_V2_EXTRACTOR_VERSION,
  UTILITY_V2_INTERRUPT_CREDITS,
  UTILITY_V2_SCHEMA_VERSION,
  type UtilityV2SupportSemantic,
} from "../../utility/v2/constants.js";
import {
  utilityFamilyFromCatalogRule,
  utilityFamilyFromDigestCategory,
  type UtilityV2FamilyKey,
} from "../../utility/v2/families.js";
import { resolveUtilityToolkitFromCatalog } from "../../utility/v2/toolkit.js";
import type {
  ClassifiedInterruptAttempt,
  InterruptAttemptClass,
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
  options?: { catalog?: AbilityCatalogContext },
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

  const observedSurvivalSpellIds = new Set<number>();
  for (const a of [
    ...digest.survival.personalDefensiveActivations,
    ...digest.survival.recoveryActivations,
  ]) {
    observedSurvivalSpellIds.add(a.primarySpellId);
    for (const id of a.observedSpellIds ?? []) observedSurvivalSpellIds.add(id);
  }
  const loadoutState = digest.loadoutEvidence?.evidenceState ?? "ABSENT";
  const availabilityEvidence = {
    loadoutEvidenceState: loadoutState,
    loadoutTalentSpellIds:
      loadoutState === "PRESENT"
        ? new Set(digest.loadoutEvidence?.talentSpellIds ?? [])
        : null,
    observedSpellIds: observedSurvivalSpellIds,
  };

  const catalogTools = resolveSurvivalCatalogTools({
    classSlug: digest.classSlug,
    specSlug: digest.specSlug,
    availabilityEvidence,
    catalog: options?.catalog,
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
      availabilityEvidence,
    });
    const recoveryResponseClass = classifyRecoveryResponse({
      recoveryActivationIds: w.response.recoveryAfter,
      recoveryById,
      dangerEndMs: w.derivation.windowEndMs,
      timingObservable: recoveryTimingObservable,
      tools: catalogTools.selfHealTools,
      activations: timedRecovery,
      availabilityEvidence,
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
  // Digest completeness ≠ measured ability-catalog coverage.
  limitations.push("digest_catalog_coverage_unmeasured");

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
      // Unmeasured on digest path — fail-closed zero (confidence skips inventing coverage).
      catalogCoverage: 0,
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
    activeHealingEvents: (digest.survival.activeHealingEvents ?? []).map((e) => ({
      canonicalEventId: e.canonicalEventId,
      timestampMs: e.timestampMs,
      primarySpellId: e.primarySpellId,
      targetRelation: e.targetRelation,
      effectiveAmount: e.effectiveAmount,
      effectiveHealPctMaxHp: e.effectiveHealPctMaxHp,
      evidenceQuality: e.evidenceQuality,
    })),
    recoveryTimedActivations: timedRecovery,
    limitations,
  };
}

function supportSemanticFromAction(
  action: UtilityCanonicalAction,
  family: UtilityV2FamilyKey | null,
): UtilityV2SupportSemantic {
  if (family === "combatRes" || action.utilityCategory === "COMBAT_RES") {
    return "EMERGENCY_SUPPORT";
  }
  if (family === "movement") {
    return "PERSONAL_MOBILITY";
  }
  if (family === "bloodlust") {
    return "STRATEGIC_SUPPORT";
  }
  // Catalog GROUP_UTILITY persists as OTHER_UTILITY but resolves to groupSupport.
  // Placement by the provider is strategic group utility — not UNVERIFIED_EXTERNAL.
  if (family === "groupSupport" && action.utilityCategory === "OTHER_UTILITY") {
    return "PROVIDED_GROUP_UTILITY";
  }
  switch (action.utilityCategory) {
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

function resolveFamilyFromDigestAction(
  action: UtilityCanonicalAction,
  classSlug: string | null,
  specSlug: string | null,
  catalog?: AbilityCatalogContext,
): UtilityV2FamilyKey | null {
  const resolved = catalog
    ? catalog.resolveBySpellId({
        spellId: action.primarySpellId,
        classSlug,
        specSlug,
      })
    : resolveAbilityRuleBySpellId({
        spellId: action.primarySpellId,
        classSlug,
        specSlug,
      });
  if (resolved.status === "matched") {
    return utilityFamilyFromCatalogRule(resolved.rule);
  }
  if (resolved.status === "ambiguous" && resolved.rules[0]) {
    return utilityFamilyFromCatalogRule(resolved.rules[0]);
  }
  return utilityFamilyFromDigestCategory(action.utilityCategory);
}

function resolveToolkitFromDigest(
  digest: ParticipantScoringDigestV1,
  observedFamilies: Partial<Record<UtilityV2FamilyKey, boolean>>,
  catalog?: AbilityCatalogContext,
): ReturnType<typeof resolveUtilityToolkitFromCatalog> {
  const talentPresent = digest.loadoutEvidence.evidenceState === "PRESENT";
  if (!talentPresent) {
    // Distinct from current Blizzard profile talents — Utility gating uses
    // run-scoped WCL CombatantInfo / digest loadout evidence only.
    console.info(
      JSON.stringify({
        event: "utility.talent_source_missing",
        source: "run_scoped_combatant_info",
        loadoutEvidenceState: digest.loadoutEvidence.evidenceState,
        reportCode: digest.reportCode,
        fightId: digest.fightId,
        participantActorId: digest.participantActorId,
      }),
    );
  }
  return resolveUtilityToolkitFromCatalog({
    classSlug: digest.classSlug,
    specSlug: digest.specSlug,
    role: digest.role === "UNKNOWN" ? null : digest.role,
    knownTalentSpellIds: talentPresent
      ? digest.loadoutEvidence.talentSpellIds
      : undefined,
    talentDataAvailable: talentPresent,
    includeRacials: true,
    raceSlug:
      digest.loadoutEvidence.raceEvidenceState === "KNOWN"
        ? digest.loadoutEvidence.raceSlug
        : null,
    observedSpellIds: digest.utility.actions.map((a) => a.primarySpellId),
    observedFamilies,
    catalog,
  });
}

export function utilityRunFactSetFromDigest(
  digest: ParticipantScoringDigestV1,
  input: {
    slotId: string;
    slotIndex: 0 | 1;
    runId?: string;
    catalog?: AbilityCatalogContext;
  },
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

  const classSlug = digest.classSlug;
  const specSlug = digest.specSlug;
  const familyOf = (action: UtilityCanonicalAction) =>
    resolveFamilyFromDigestAction(action, classSlug, specSlug, input.catalog);

  const interruptAttempts: ClassifiedInterruptAttempt[] = actions
    .filter((a) => familyOf(a) === "interrupt" || a.utilityCategory === "INTERRUPT")
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
    .filter((a) => familyOf(a) === "crowdControl")
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
    .filter((a) => {
      const family = familyOf(a);
      return (
        family === "groupSupport" ||
        family === "combatRes" ||
        family === "movement"
      );
    })
    .map((a) => {
      const family = familyOf(a);
      return {
        id: a.canonicalActionId,
        timestampMs: a.rawTimestampMs,
        abilityGameId: a.primarySpellId,
        abilityName: a.canonicalName,
        sourceActorId: a.sourceActorId,
        sourceKind: sourceKindFromAction(a),
        targetActorId: a.targetActorId,
        semantic: supportSemanticFromAction(a, family),
        tier: supportEvidenceTierFromDigestAction(a),
      };
    });

  const dispelPurgeSuccessCount = actions.filter(
    (a) => familyOf(a) === "dispelPurge" && a.outcome === "SUCCESS",
  ).length;

  const bloodlustSuccessCount = actions.filter(
    (a) => familyOf(a) === "bloodlust",
  ).length;

  const fightDurationMs = digest.survival.fightDurationMs ?? 1_800_000;
  const hostileCastEvents = digest.utility.hostileCastEvents ?? [];
  const hostileTimestampsMs = hostileCastEvents.map((e) => e.fightOffsetMs);
  const hostileActiveCombat =
    hostileTimestampsMs.length > 0
      ? estimateActiveCombatMs({
          fightDurationMs,
          hostileEventTimestampsMs: hostileTimestampsMs,
        })
      : null;
  const activeCombatMs =
    hostileActiveCombat?.activeCombatMs ??
    digest.survival.activeCombatMs ??
    fightDurationMs;
  const hostileBegincastCount = hostileCastEvents.filter(
    (e) =>
      e.eventType == null ||
      e.eventType === "begincast" ||
      e.eventType === "cast",
  ).length;

  const observedFamilies: Partial<Record<UtilityV2FamilyKey, boolean>> = {
    interrupt: interruptAttempts.length > 0,
    crowdControl: ccActions.length > 0,
    dispelPurge: dispelPurgeSuccessCount > 0,
    groupSupport: supportActions.some(
      (a) =>
        a.semantic === "REACTIVE_SUPPORT" ||
        a.semantic === "STRATEGIC_SUPPORT" ||
        a.semantic === "PROVIDED_GROUP_UTILITY",
    ),
    movement: supportActions.some((a) => a.semantic === "PERSONAL_MOBILITY"),
    combatRes: supportActions.some((a) => a.semantic === "EMERGENCY_SUPPORT"),
    bloodlust: bloodlustSuccessCount > 0,
  };
  const resolvedToolkit = resolveToolkitFromDigest(
    digest,
    observedFamilies,
    input.catalog,
  );

  const limitations = [
    ...digest.utility.limitations,
    ...resolvedToolkit.limitations,
    ...(hostileCastEvents.length === 0
      ? [
          // Hostile cast windows absent — digest path cannot emit VALID_OVERLAP / MATCHED_FAILED.
          "hostile_cast_windows_not_persisted_in_digest",
        ]
      : [
          // Windows are timestamps only; interrupt↔hostile overlap classification remains limited.
          "digest_hostile_cast_timestamps_only",
        ]),
    "digest_interrupt_classes_limited_to_success_attempt_unknown",
    // Catalog coverage is not measured on the digest path — do not present
    // stand-in constants as observed evidence quality.
    "digest_catalog_coverage_unmeasured",
    ...(hostileActiveCombat == null
      ? ["utility_active_combat_from_survival_damage_taken"]
      : []),
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
    hostileBegincastCount,
    hostileObservability:
      hostileCastEvents.length > 0
        ? ("PRESENT" as const)
        : ("ABSENT" as const),
    toolkit: resolvedToolkit.toolkit,
    interruptAttempts,
    ccActions,
    supportActions,
    dispelPurgeSuccessCount,
    bloodlustSuccessCount,
    catalogCoverage: {
      // Unmeasured on digest path — fail-closed zeros (confidence skips mechanic gates).
      abilityCatalogCoverage: 0,
      mechanicCatalogCoverage: 0,
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
