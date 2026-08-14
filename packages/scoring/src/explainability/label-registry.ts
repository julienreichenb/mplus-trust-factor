/**
 * Deterministic label registry for Score Explainability V1.
 * Exact codes + explicit dynamic families only — no LLM / heuristic prose.
 */

export const SCORE_EXPLAINABILITY_LABEL_CATALOG_VERSION =
  "score-explainability-labels-v1" as const;

export const SCORE_EXPLAINABILITY_MATERIALITY_POLICY_VERSION =
  "score-explainability-materiality-v1" as const;

/** Shared 0–100 component neutral point used by Performance / Survival drivers. */
export const SCORE_EXPLAINABILITY_NEUTRAL_POINT = 50;

/**
 * Product projector hides drivers whose |materiality| is below this floor.
 * Versioned with SCORE_EXPLAINABILITY_MATERIALITY_POLICY_VERSION.
 */
export const SCORE_EXPLAINABILITY_PRODUCT_MATERIALITY_FLOOR = 0.25;

export type LabelVisibility = "PUBLIC" | "AUDIT_ONLY";

export interface LabelEntry {
  labelKey: string;
  /** English default; may include `{param}` placeholders. */
  template: string;
  visibility: LabelVisibility;
}

export interface LabelPresentation {
  code: string;
  labelKey: string;
  label: string;
  visibility: LabelVisibility;
  params: Record<string, string | number | boolean | null>;
  registered: boolean;
}

type ParamMap = Record<string, string | number | boolean | null>;

const SCORE_DRIVER_ENTRIES: Record<string, LabelEntry> = {
  "performance.damage_parse": {
    labelKey: "score.performance.damage_parse",
    template: "Damage parse performance scored {value}",
    visibility: "PUBLIC",
  },
  "performance.healing_parse": {
    labelKey: "score.performance.healing_parse",
    template: "Healing parse performance scored {value}",
    visibility: "PUBLIC",
  },
  "performance.offensive_cooldown_discipline": {
    labelKey: "score.performance.offensive_cooldown_discipline",
    template: "Offensive cooldown discipline scored {value}",
    visibility: "PUBLIC",
  },
  /** Forensic / legacy — not emitted by active role-aware Performance. */
  "performance.phase1_score": {
    labelKey: "score.performance.phase1_score",
    template: "Season performance baseline scored {value}",
    visibility: "AUDIT_ONLY",
  },
  "survival.outcome": {
    labelKey: "score.survival.outcome",
    template: "Survival outcome scored {value}",
    visibility: "PUBLIC",
  },
  "survival.defensive_response": {
    labelKey: "score.survival.defensive_response",
    template: "Defensive response scored {value}",
    visibility: "PUBLIC",
  },
  "survival.emergency_recovery": {
    labelKey: "score.survival.emergency_recovery",
    template: "Emergency recovery scored {value}",
    visibility: "PUBLIC",
  },
  "survival.active_healing": {
    labelKey: "score.survival.active_healing",
    template:
      "Active healing: {selfCreditedEventCount} self, {allyCreditedEventCount} ally (capped {cappedCredit})",
    visibility: "PUBLIC",
  },
  "survival.relative_avoidable_damage": {
    labelKey: "score.survival.relative_avoidable_damage",
    template: "Relative avoidable damage scored {value}",
    visibility: "PUBLIC",
  },
  "utility.family.interrupt": {
    labelKey: "score.utility.family.interrupt",
    template: "Interrupt toolkit scored {value}",
    visibility: "PUBLIC",
  },
  "utility.family.crowdControl": {
    labelKey: "score.utility.family.crowd_control",
    template: "Crowd-control toolkit scored {value}",
    visibility: "PUBLIC",
  },
  "utility.family.dispelPurge": {
    labelKey: "score.utility.family.dispel_purge",
    template: "Dispel/purge toolkit scored {value}",
    visibility: "PUBLIC",
  },
  "utility.family.groupSupport": {
    labelKey: "score.utility.family.group_support",
    template: "External/group support scored {value}",
    visibility: "PUBLIC",
  },
  "utility.family.movement": {
    labelKey: "score.utility.family.movement",
    template: "Movement utility scored {value}",
    visibility: "PUBLIC",
  },
  "utility.family.combatRes": {
    labelKey: "score.utility.family.combat_res",
    template: "Combat resurrection usage scored {value}",
    visibility: "PUBLIC",
  },
  "utility.family.bloodlust": {
    labelKey: "score.utility.family.bloodlust",
    template: "Bloodlust/heroism usage scored {value}",
    visibility: "PUBLIC",
  },
  "utility.interrupt_attempt_credit": {
    labelKey: "score.utility.interrupt_attempt_credit",
    template:
      "Interrupt credit: {confirmedSuccess} landed, {validOverlap} overlapping attempts, {matchedFailed} misses",
    visibility: "PUBLIC",
  },
  "utility.applicability_uncertain": {
    labelKey: "score.utility.applicability_uncertain",
    template: "Utility family {domain} excluded because talent applicability is uncertain",
    visibility: "PUBLIC",
  },
  "utility.domain.castStops": {
    labelKey: "score.utility.domain.cast_stops",
    template: "Cast stops contributed {contribution}",
    visibility: "AUDIT_ONLY",
  },
  "utility.domain.support": {
    labelKey: "score.utility.domain.support",
    template: "Support contribution {contribution}",
    visibility: "AUDIT_ONLY",
  },
  "utility.domain.strategicCc": {
    labelKey: "score.utility.domain.strategic_cc",
    template: "Strategic CC contribution {contribution}",
    visibility: "AUDIT_ONLY",
  },
  "utility.reliability_attenuation": {
    labelKey: "score.utility.reliability_attenuation",
    template: "Reliability attenuated observed utility by factor {reliability}",
    visibility: "AUDIT_ONLY",
  },
  "experience.previous_standing": {
    labelKey: "score.experience.previous_standing",
    template: "Historical standing: {nativeBandLabel} in {seasonLabel}",
    visibility: "PUBLIC",
  },
  "experience.historical_standing": {
    labelKey: "score.experience.historical_standing",
    template: "Historical standing: {nativeBandLabel} in {seasonLabel}",
    visibility: "PUBLIC",
  },
  "experience.class_rank_floor": {
    labelKey: "score.experience.class_rank_floor",
    template: "Regional class rank #{classRank} provides an Experience floor of {value}",
    visibility: "PUBLIC",
  },
  "experience.elite_title_floor": {
    labelKey: "score.experience.elite_title_floor",
    template: "Historical seasonal elite title provides an Experience floor of {value}",
    visibility: "PUBLIC",
  },
  "experience.confirmed_no_activity": {
    labelKey: "score.experience.confirmed_no_activity",
    template: "No confirmed Mythic+ history for scored seasons",
    visibility: "PUBLIC",
  },
};

const CONFIDENCE_CAUSE_ENTRIES: Record<string, LabelEntry> = {
  // Performance
  performance_unavailable: {
    labelKey: "confidence.performance.unavailable",
    template: "Performance score unavailable",
    visibility: "PUBLIC",
  },
  no_performance_evidence: {
    labelKey: "confidence.performance.no_evidence",
    template: "No performance evidence available",
    visibility: "PUBLIC",
  },
  profile_only: {
    labelKey: "confidence.performance.profile_only",
    template: "Performance relies on profile aggregate only",
    visibility: "AUDIT_ONLY",
  },
  damage_parse_coverage_incomplete: {
    labelKey: "confidence.performance.damage_parse_coverage_incomplete",
    template: "Damage parse coverage is incomplete",
    visibility: "PUBLIC",
  },
  healing_parse_coverage_incomplete: {
    labelKey: "confidence.performance.healing_parse_coverage_incomplete",
    template: "Healing parse coverage is incomplete",
    visibility: "PUBLIC",
  },
  damage_parse_channel_missing: {
    labelKey: "confidence.performance.damage_parse_channel_missing",
    template: "Damage parse evidence is missing",
    visibility: "PUBLIC",
  },
  healing_parse_channel_missing: {
    labelKey: "confidence.performance.healing_parse_channel_missing",
    template: "Healing parse evidence is missing",
    visibility: "PUBLIC",
  },
  damage_parse_unavailable: {
    labelKey: "confidence.performance.damage_parse_unavailable",
    template: "Damage parse performance unavailable",
    visibility: "PUBLIC",
  },
  healing_parse_unavailable: {
    labelKey: "confidence.performance.healing_parse_unavailable",
    template: "Healing parse performance unavailable",
    visibility: "PUBLIC",
  },
  damage_parse_spec_mismatch: {
    labelKey: "confidence.performance.damage_parse_spec_mismatch",
    template: "Damage parse specialization does not match the character",
    visibility: "PUBLIC",
  },
  healing_parse_spec_mismatch: {
    labelKey: "confidence.performance.healing_parse_spec_mismatch",
    template: "Healing parse specialization does not match the character",
    visibility: "PUBLIC",
  },
  damage_parse_spec_binding_unproven: {
    labelKey: "confidence.performance.damage_parse_spec_binding_unproven",
    template: "Damage parse specialization binding is unproven from the payload",
    visibility: "PUBLIC",
  },
  healing_parse_spec_binding_unproven: {
    labelKey: "confidence.performance.healing_parse_spec_binding_unproven",
    template: "Healing parse specialization binding is unproven from the payload",
    visibility: "PUBLIC",
  },
  damage_parse_stale: {
    labelKey: "confidence.performance.damage_parse_stale",
    template: "Performance aggregate is stale",
    visibility: "PUBLIC",
  },
  healing_parse_stale: {
    labelKey: "confidence.performance.healing_parse_stale",
    template: "Performance aggregate is stale",
    visibility: "PUBLIC",
  },
  damage_parse_no_usable_percentiles: {
    labelKey: "confidence.performance.damage_parse_no_usable_percentiles",
    template: "No usable damage parse percentiles",
    visibility: "PUBLIC",
  },
  healing_parse_no_usable_percentiles: {
    labelKey: "confidence.performance.healing_parse_no_usable_percentiles",
    template: "No usable healing parse percentiles",
    visibility: "PUBLIC",
  },
  role_identity_unknown: {
    labelKey: "confidence.performance.role_identity_unknown",
    template: "Character role is unknown",
    visibility: "PUBLIC",
  },
  detailed_only: {
    labelKey: "confidence.performance.detailed_only",
    template: "Performance relies on detailed logs only",
    visibility: "PUBLIC",
  },
  one_run_dungeons_only: {
    labelKey: "confidence.performance.one_run_dungeons_only",
    template: "Only one run available per dungeon",
    visibility: "PUBLIC",
  },
  partial_one_run_dungeons: {
    labelKey: "confidence.performance.partial_one_run_dungeons",
    template: "Some dungeons have only one run",
    visibility: "PUBLIC",
  },
  incomplete_dungeon_coverage: {
    labelKey: "confidence.coverage.incomplete_dungeon_coverage",
    template: "Incomplete dungeon coverage",
    visibility: "PUBLIC",
  },
  incomplete_detailed_slot_coverage: {
    labelKey: "confidence.performance.incomplete_detailed_slot_coverage",
    template: "Incomplete detailed slot coverage",
    visibility: "PUBLIC",
  },
  incomplete_two_run_coverage: {
    labelKey: "confidence.performance.incomplete_two_run_coverage",
    template: "Incomplete two-run dungeon coverage",
    visibility: "PUBLIC",
  },
  missing_profile_aggregate: {
    labelKey: "confidence.performance.missing_profile_aggregate",
    template: "Missing profile aggregate",
    visibility: "PUBLIC",
  },
  stale_log_freshness: {
    labelKey: "confidence.performance.stale_log_freshness",
    template: "Combat logs are not fully fresh",
    visibility: "PUBLIC",
  },
  difficulty_policy_confidence_reduced: {
    labelKey: "confidence.performance.difficulty_policy_confidence_reduced",
    template: "Difficulty policy reduced confidence",
    visibility: "PUBLIC",
  },
  partition_mismatch: {
    labelKey: "confidence.performance.partition_mismatch",
    template: "Role partition mismatch reduced confidence",
    visibility: "PUBLIC",
  },
  cooldown_evidence_unavailable: {
    labelKey: "confidence.performance.cooldown_evidence_unavailable",
    template: "Offensive cooldown evidence unavailable",
    visibility: "PUBLIC",
  },
  incomplete_cooldown_run_coverage: {
    labelKey: "confidence.performance.incomplete_cooldown_run_coverage",
    template: "Incomplete cooldown run coverage",
    visibility: "PUBLIC",
  },
  no_evaluable_cooldown_abilities: {
    labelKey: "confidence.performance.no_evaluable_cooldown_abilities",
    template: "No evaluable offensive cooldown abilities",
    visibility: "PUBLIC",
  },
  cooldown_catalogue_incompatible_runs: {
    labelKey: "confidence.performance.cooldown_catalogue_incompatible_runs",
    template: "Some runs are incompatible with the cooldown catalogue",
    visibility: "PUBLIC",
  },
  cooldown_invalid_duration_runs: {
    labelKey: "confidence.performance.cooldown_invalid_duration_runs",
    template: "Some runs lack valid fight duration for cooldown scoring",
    visibility: "PUBLIC",
  },
  phase1_unavailable: {
    labelKey: "confidence.performance.phase1_unavailable",
    template: "Performance Phase 1 unavailable",
    visibility: "PUBLIC",
  },
  phase1_partial: {
    labelKey: "confidence.performance.phase1_partial",
    template: "Performance Phase 1 only partially available",
    visibility: "PUBLIC",
  },
  // Survival
  no_survival_evidence: {
    labelKey: "confidence.survival.no_evidence",
    template: "No survival evidence available",
    visibility: "PUBLIC",
  },
  incomplete_slot_coverage: {
    labelKey: "confidence.survival.incomplete_slot_coverage",
    template: "Incomplete survival slot coverage",
    visibility: "PUBLIC",
  },
  health_evidence_partial: {
    labelKey: "confidence.survival.health_evidence_partial",
    template: "Partial health evidence in scored runs",
    visibility: "PUBLIC",
  },
  max_hp_unavailable: {
    labelKey: "confidence.survival.max_hp_unavailable",
    template: "Max HP evidence unavailable for some runs",
    visibility: "PUBLIC",
  },
  health_evidence_outcome_dominated: {
    labelKey: "confidence.survival.health_evidence_outcome_dominated",
    template: "Survival confidence dominated by outcome-only health evidence",
    visibility: "PUBLIC",
  },
  incomplete_catalog_coverage: {
    labelKey: "confidence.survival.incomplete_catalog_coverage",
    template: "Incomplete defensive catalog coverage",
    visibility: "PUBLIC",
  },
  relative_damage_unreliable: {
    labelKey: "confidence.survival.relative_damage_unreliable",
    template: "Relative avoidable damage evidence is unreliable",
    visibility: "PUBLIC",
  },
  // Utility
  unavailable: {
    labelKey: "confidence.utility.unavailable",
    template: "Utility score unavailable",
    visibility: "PUBLIC",
  },
  tiny_run_sample: {
    labelKey: "confidence.utility.tiny_run_sample",
    template: "Utility sample size is very small",
    visibility: "PUBLIC",
  },
  partial_dungeon_coverage: {
    labelKey: "confidence.utility.partial_dungeon_coverage",
    template: "Partial dungeon coverage for utility",
    visibility: "PUBLIC",
  },
  zero_attributable_events: {
    labelKey: "confidence.utility.zero_attributable_events",
    template: "No attributable utility events observed",
    visibility: "PUBLIC",
  },
  no_hostile_casts_observed: {
    labelKey: "confidence.utility.no_hostile_casts_observed",
    template: "No hostile casts observed for interrupt context",
    visibility: "PUBLIC",
  },
  hostile_cast_windows_not_persisted_in_digest: {
    labelKey: "confidence.utility.hostile_cast_windows_not_persisted",
    template: "Hostile cast windows were not persisted in digests",
    visibility: "PUBLIC",
  },
  catalog_coverage_unmeasured: {
    labelKey: "confidence.utility.catalog_coverage_unmeasured",
    template: "Mechanic catalog coverage was unmeasured",
    visibility: "PUBLIC",
  },
  applicability_uncertain: {
    labelKey: "confidence.utility.applicability_uncertain",
    template:
      "Run-scoped WCL talent/loadout evidence is missing, so some utility families were not scored as unused",
    visibility: "PUBLIC",
  },
  talent_applicability_uncertain: {
    labelKey: "confidence.utility.talent_applicability_uncertain",
    template:
      "Some utility families are talent-gated and run-scoped WCL CombatantInfo talent evidence was unavailable",
    visibility: "PUBLIC",
  },
  // Experience
  previous_evidence_unavailable: {
    labelKey: "confidence.experience.previous_evidence_unavailable",
    template: "Historical Experience evidence unavailable",
    visibility: "PUBLIC",
  },
  historical_evidence_unavailable: {
    labelKey: "confidence.experience.historical_evidence_unavailable",
    template: "Historical Experience evidence unavailable",
    visibility: "PUBLIC",
  },
  elite_evidence_unavailable: {
    labelKey: "confidence.experience.elite_evidence_unavailable",
    template: "Elite title evidence unavailable",
    visibility: "PUBLIC",
  },
  no_usable_evidence: {
    labelKey: "confidence.experience.no_usable_evidence",
    template: "No usable Experience evidence",
    visibility: "PUBLIC",
  },
};

const CONFIDENCE_COMPONENT_ENTRIES: Record<string, LabelEntry> = {
  phase1Confidence: {
    labelKey: "confidence.component.phase1_confidence",
    template: "Phase 1 confidence component",
    visibility: "PUBLIC",
  },
  cooldownEvidenceConfidence: {
    labelKey: "confidence.component.cooldown_evidence_confidence",
    template: "Cooldown evidence confidence component",
    visibility: "PUBLIC",
  },
  phase1Weight: {
    labelKey: "confidence.component.phase1_weight",
    template: "Phase 1 weight in confidence blend",
    visibility: "AUDIT_ONLY",
  },
  cooldownWeight: {
    labelKey: "confidence.component.cooldown_weight",
    template: "Cooldown weight in confidence blend",
    visibility: "AUDIT_ONLY",
  },
  cooldownRunCoverage: {
    labelKey: "confidence.component.cooldown_run_coverage",
    template: "Cooldown usable-run coverage",
    visibility: "PUBLIC",
  },
  dungeonCoverage: {
    labelKey: "confidence.component.dungeon_coverage",
    template: "Dungeon coverage",
    visibility: "PUBLIC",
  },
  slotFill: {
    labelKey: "confidence.component.slot_fill",
    template: "Slot fill coverage",
    visibility: "PUBLIC",
  },
  healthFactor: {
    labelKey: "confidence.component.health_factor",
    template: "Health evidence factor",
    visibility: "PUBLIC",
  },
  catalogFactor: {
    labelKey: "confidence.component.catalog_factor",
    template: "Catalog coverage factor",
    visibility: "PUBLIC",
  },
  runCoverage: {
    labelKey: "confidence.component.run_coverage",
    template: "Run coverage",
    visibility: "PUBLIC",
  },
  combatDuration: {
    labelKey: "confidence.component.combat_duration",
    template: "Combat duration coverage",
    visibility: "PUBLIC",
  },
  attributableEvents: {
    labelKey: "confidence.component.attributable_events",
    template: "Attributable events coverage",
    visibility: "PUBLIC",
  },
  mechanicCatalogCoverageObserved: {
    labelKey: "confidence.component.mechanic_catalog_coverage",
    template: "Mechanic catalog coverage",
    visibility: "PUBLIC",
  },
  sourceCompleteness: {
    labelKey: "confidence.component.source_completeness",
    template: "Source completeness",
    visibility: "PUBLIC",
  },
};

function renderTemplate(template: string, params: ParamMap): string {
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (_match, key: string) => {
    const value = params[key];
    if (value == null) return "—";
    return String(value);
  });
}

function presentFromEntry(
  code: string,
  entry: LabelEntry | null,
  params: ParamMap,
): LabelPresentation {
  if (entry == null) {
    return {
      code,
      labelKey: `unregistered.${code}`,
      label: code,
      visibility: "AUDIT_ONLY",
      params,
      registered: false,
    };
  }
  return {
    code,
    labelKey: entry.labelKey,
    label: renderTemplate(entry.template, params),
    visibility: entry.visibility,
    params,
    registered: true,
  };
}

/** Resolve exact or dynamic-family label entry. */
export function resolveLabelEntry(
  kind: "score" | "confidence" | "component",
  code: string,
): LabelEntry | null {
  if (kind === "score") return SCORE_DRIVER_ENTRIES[code] ?? null;
  if (kind === "component") return CONFIDENCE_COMPONENT_ENTRIES[code] ?? null;

  const exact = CONFIDENCE_CAUSE_ENTRIES[code];
  if (exact) return exact;

  if (code.startsWith("role_adapter:")) {
    return {
      labelKey: "confidence.performance.role_adapter",
      template: "Role adapter limited scoring ({adapterReason})",
      visibility: "PUBLIC",
    };
  }
  if (code.startsWith("mechanic_catalog_below_")) {
    return {
      labelKey: "confidence.utility.mechanic_catalog_below",
      template: "Mechanic catalog coverage below {threshold}",
      visibility: "PUBLIC",
    };
  }
  return null;
}

export function presentScoreDriver(
  code: string,
  params: ParamMap = {},
): LabelPresentation {
  return presentFromEntry(code, resolveLabelEntry("score", code), params);
}

export function presentConfidenceCause(
  code: string,
  params: ParamMap = {},
): LabelPresentation {
  const enriched: ParamMap = { ...params };
  if (code.startsWith("role_adapter:")) {
    enriched.adapterReason = code.slice("role_adapter:".length) || "unknown";
  } else if (code.startsWith("mechanic_catalog_below_")) {
    const threshold = Number(code.slice("mechanic_catalog_below_".length));
    enriched.threshold = Number.isFinite(threshold) ? threshold : null;
  }
  return presentFromEntry(code, resolveLabelEntry("confidence", code), enriched);
}

export function presentConfidenceComponent(
  key: string,
  params: ParamMap = {},
): LabelPresentation {
  return presentFromEntry(key, resolveLabelEntry("component", key), params);
}
