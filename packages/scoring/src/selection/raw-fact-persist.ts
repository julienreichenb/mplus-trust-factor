import type {
  MetricObservationDTO,
  PerformanceRawInputs,
  RawFactProvenance,
  ScoringDataFoundationSnapshot,
  SurvivalRawFacts,
  UtilityRawFacts,
} from "@mplus/contracts";
import { SCORING_V3_FORMULA_VERSION } from "@mplus/contracts";
import type {
  AbilityCatalog,
  ExtractedSurvivalCounts,
  ExtractedUtilityCounts,
  ScoringMechanicCatalog,
} from "@mplus/mechanics";

export function buildProvenance(input: {
  sourceProvider: RawFactProvenance["sourceProvider"];
  canonicalRunId: string | null;
  dungeonSlug: string | null;
  abilityCatalog: AbilityCatalog;
  mechanicCatalog: ScoringMechanicCatalog;
  observedAt: string;
  formulaVersion?: string;
}): RawFactProvenance {
  return {
    sourceProvider: input.sourceProvider,
    canonicalRunId: input.canonicalRunId,
    dungeonSlug: input.dungeonSlug,
    formulaVersion: input.formulaVersion ?? SCORING_V3_FORMULA_VERSION,
    abilityCatalogVersion: input.abilityCatalog.catalogVersion,
    mechanicCatalogVersion: input.mechanicCatalog.catalogVersion,
    observedAt: input.observedAt,
  };
}

export function toSurvivalRawFacts(input: {
  provenance: RawFactProvenance;
  counts: ExtractedSurvivalCounts | null;
  detailAvailable: boolean;
  missingReasons?: string[];
}): SurvivalRawFacts {
  if (!input.detailAvailable || !input.counts) {
    const reason = input.missingReasons?.join(",") ?? "wcl_detail_unavailable";
    const blocked = { availability: "BLOCKED" as const, reason };
    return {
      provenance: input.provenance,
      deaths: null,
      totalDamageTaken: null,
      avoidableDamageTaken: null,
      avoidableDamageCoverageRatio: null,
      maxHealth: null,
      personalDefensiveCasts: null,
      selfHealEffective: null,
      selfHealOverheal: null,
      healthPotionCasts: null,
      fieldStatus: {
        deaths: blocked,
        totalDamageTaken: blocked,
        avoidableDamageTaken: blocked,
        maxHealth: { availability: "BLOCKED", reason },
        personalDefensiveCasts: blocked,
        selfHealEffective: blocked,
        healthPotionCasts: blocked,
      },
    };
  }

  const c = input.counts;
  const avoidableAvailability =
    c.damageEvents === 0
      ? ("AVAILABLE" as const)
      : c.avoidableDamageCoverageRatio >= 0.85
        ? ("AVAILABLE" as const)
        : c.avoidableDamageCoverageRatio > 0
          ? ("PARTIAL" as const)
          : ("BLOCKED" as const);

  return {
    provenance: input.provenance,
    deaths: c.deaths,
    totalDamageTaken: c.totalDamageTaken,
    avoidableDamageTaken: c.avoidableDamageTaken,
    avoidableDamageCoverageRatio: c.avoidableDamageCoverageRatio,
    maxHealth: c.maxHealth,
    personalDefensiveCasts: c.personalDefensiveCasts,
    selfHealEffective: c.selfHealEffective,
    selfHealOverheal: c.selfHealOverheal,
    healthPotionCasts: c.healthPotionCasts,
    fieldStatus: {
      deaths: { availability: "AVAILABLE", reason: null },
      totalDamageTaken: { availability: "AVAILABLE", reason: null },
      avoidableDamageTaken: {
        availability: avoidableAvailability,
        reason:
          avoidableAvailability === "AVAILABLE"
            ? null
            : "mechanic_catalog_coverage_incomplete",
      },
      maxHealth: {
        availability: c.maxHealth != null ? "AVAILABLE" : "BLOCKED",
        reason: c.maxHealth != null ? null : "max_health_not_in_combatant_snapshot",
      },
      personalDefensiveCasts: { availability: "AVAILABLE", reason: null },
      selfHealEffective: { availability: "AVAILABLE", reason: null },
      healthPotionCasts: { availability: "AVAILABLE", reason: null },
    },
  };
}

export function toUtilityRawFacts(input: {
  provenance: RawFactProvenance;
  counts: ExtractedUtilityCounts | null;
  detailAvailable: boolean;
  missingReasons?: string[];
}): UtilityRawFacts {
  if (!input.detailAvailable || !input.counts) {
    const reason = input.missingReasons?.join(",") ?? "wcl_detail_unavailable";
    const blocked = { availability: "BLOCKED" as const, reason };
    return {
      provenance: input.provenance,
      kickCasts: null,
      successfulInterrupts: null,
      effectiveKickCooldownMs: null,
      distinctCcTargets: null,
      groupSupportCasts: null,
      defensiveDispels: null,
      offensiveDispels: null,
      fieldStatus: {
        kickCasts: blocked,
        successfulInterrupts: blocked,
        effectiveKickCooldownMs: blocked,
        distinctCcTargets: blocked,
        groupSupportCasts: blocked,
        defensiveDispels: blocked,
        offensiveDispels: blocked,
      },
    };
  }

  const c = input.counts;
  const groupSupportStatus =
    c.groupSupportEvidenceMode === "confirmed_party_usage"
      ? ({ availability: "AVAILABLE" as const, reason: null })
      : c.groupSupportCasts > 0
        ? ({
            availability: "PARTIAL" as const,
            reason: "group_support_cast_only_party_usage_unconfirmed",
          })
        : ({ availability: "AVAILABLE" as const, reason: null });

  const offensiveStatus = c.capability.offensiveDispels
    ? ({ availability: "AVAILABLE" as const, reason: null })
    : ({
        availability: "BLOCKED" as const,
        reason: "offensive_dispel_not_in_spec_capability",
      });

  return {
    provenance: input.provenance,
    kickCasts: c.kickCasts,
    successfulInterrupts: c.successfulInterrupts,
    effectiveKickCooldownMs: c.effectiveKickCooldownMs,
    distinctCcTargets: c.distinctCcTargets,
    groupSupportCasts: c.groupSupportCasts,
    defensiveDispels: c.defensiveDispels,
    offensiveDispels: c.capability.offensiveDispels ? c.offensiveDispels : 0,
    fieldStatus: {
      kickCasts: {
        availability: c.capability.interrupts ? "AVAILABLE" : "BLOCKED",
        reason: c.capability.interrupts ? null : "interrupt_not_in_spec_capability",
      },
      successfulInterrupts: {
        availability: c.capability.interrupts ? "AVAILABLE" : "BLOCKED",
        reason: c.capability.interrupts ? null : "interrupt_not_in_spec_capability",
      },
      effectiveKickCooldownMs: {
        availability: c.effectiveKickCooldownMs != null ? "AVAILABLE" : "PARTIAL",
        reason:
          c.effectiveKickCooldownMs != null
            ? null
            : "interrupt_cooldown_missing_from_catalog_or_loadout",
      },
      distinctCcTargets: {
        availability: c.capability.crowdControl ? "AVAILABLE" : "BLOCKED",
        reason: c.capability.crowdControl ? null : "crowd_control_not_in_spec_capability",
      },
      groupSupportCasts: c.capability.groupSupport
        ? groupSupportStatus
        : {
            availability: "BLOCKED",
            reason: "group_support_not_in_spec_capability",
          },
      defensiveDispels: {
        availability: c.capability.defensiveDispels ? "AVAILABLE" : "BLOCKED",
        reason: c.capability.defensiveDispels
          ? null
          : "defensive_dispel_not_in_spec_capability",
      },
      offensiveDispels: offensiveStatus,
    },
  };
}

export function toPerformanceRawInputs(input: {
  provenance: RawFactProvenance;
  parsePercentile: number | null;
  keyLevel: number | null;
  timed: boolean | null;
  seasonSlug: string | null;
  region: string | null;
  detailAvailable: boolean;
}): PerformanceRawInputs {
  return {
    provenance: input.provenance,
    parsePercentile: input.parsePercentile,
    keyDifficultyInputs: {
      keyLevel: input.keyLevel,
      timed: input.timed,
      seasonSlug: input.seasonSlug,
      region: input.region,
    },
    fieldStatus: {
      parsePercentile: {
        availability: input.parsePercentile != null ? "AVAILABLE" : "BLOCKED",
        reason:
          input.parsePercentile != null
            ? null
            : input.detailAvailable
              ? "parse_percentile_not_tied_to_selected_fight"
              : "wcl_detail_unavailable",
      },
      keyDifficultyInputs: {
        availability: input.keyLevel != null ? "PARTIAL" : "BLOCKED",
        reason:
          input.keyLevel != null
            ? "season_cutoff_interpolation_not_wired"
            : "key_level_missing",
      },
    },
  };
}

/**
 * Persistable MetricObservationDTO envelopes for raw v3 facts.
 * Does not alter score model weights — stores raw values + provenance in context.
 */
export function rawFactsToMetricObservations(input: {
  survival: SurvivalRawFacts;
  utility: UtilityRawFacts;
  performance: PerformanceRawInputs;
}): MetricObservationDTO[] {
  const observedAt = input.survival.provenance.observedAt;
  const baseContext = {
    formulaVersion: input.survival.provenance.formulaVersion,
    abilityCatalogVersion: input.survival.provenance.abilityCatalogVersion,
    mechanicCatalogVersion: input.survival.provenance.mechanicCatalogVersion,
    canonicalRunId: input.survival.provenance.canonicalRunId,
    dungeonSlug: input.survival.provenance.dungeonSlug,
    fieldStatus: {
      survival: input.survival.fieldStatus,
      utility: input.utility.fieldStatus,
      performance: input.performance.fieldStatus,
    },
  };

  const rows: Array<{
    metricKey: string;
    dimension: MetricObservationDTO["dimension"];
    rawValue: number | null;
    confidence: number;
  }> = [
    {
      metricKey: "survival.v3.deaths",
      dimension: "SURVIVAL",
      rawValue: input.survival.deaths,
      confidence: input.survival.deaths == null ? 0 : 0.8,
    },
    {
      metricKey: "survival.v3.avoidable_damage",
      dimension: "SURVIVAL",
      rawValue: input.survival.avoidableDamageTaken,
      confidence: input.survival.avoidableDamageTaken == null ? 0 : 0.55,
    },
    {
      metricKey: "survival.v3.personal_defensives",
      dimension: "SURVIVAL",
      rawValue: input.survival.personalDefensiveCasts,
      confidence: input.survival.personalDefensiveCasts == null ? 0 : 0.7,
    },
    {
      metricKey: "utility.v3.kick_casts",
      dimension: "UTILITY",
      rawValue: input.utility.kickCasts,
      confidence: input.utility.kickCasts == null ? 0 : 0.75,
    },
    {
      metricKey: "utility.v3.successful_interrupts",
      dimension: "UTILITY",
      rawValue: input.utility.successfulInterrupts,
      confidence: input.utility.successfulInterrupts == null ? 0 : 0.75,
    },
    {
      metricKey: "utility.v3.distinct_cc_targets",
      dimension: "UTILITY",
      rawValue: input.utility.distinctCcTargets,
      confidence: input.utility.distinctCcTargets == null ? 0 : 0.7,
    },
    {
      metricKey: "utility.v3.group_support_casts",
      dimension: "UTILITY",
      rawValue: input.utility.groupSupportCasts,
      confidence: input.utility.groupSupportCasts == null ? 0 : 0.65,
    },
    {
      metricKey: "utility.v3.defensive_dispels",
      dimension: "UTILITY",
      rawValue: input.utility.defensiveDispels,
      confidence: input.utility.defensiveDispels == null ? 0 : 0.7,
    },
    {
      metricKey: "utility.v3.offensive_dispels",
      dimension: "UTILITY",
      rawValue: input.utility.offensiveDispels,
      confidence:
        input.utility.fieldStatus.offensiveDispels?.availability === "BLOCKED"
          ? 0
          : input.utility.offensiveDispels == null
            ? 0
            : 0.7,
    },
    {
      metricKey: "performance.v3.parse_percentile",
      dimension: "PERFORMANCE",
      rawValue: input.performance.parsePercentile,
      confidence: input.performance.parsePercentile == null ? 0 : 0.6,
    },
  ];

  return rows.map((row) => ({
    metricKey: row.metricKey,
    dimension: row.dimension,
    rawValue: row.rawValue,
    normalizedValue: null,
    confidence: row.confidence,
    observedAt,
    sourceProvider: input.survival.provenance.sourceProvider,
    coverage: null,
    context: baseContext,
  }));
}

export function summarizeFoundationSnapshot(
  snapshot: ScoringDataFoundationSnapshot,
): {
  selectedDungeonCount: number;
  detailAvailableCount: number;
  wclMatchedCount: number;
} {
  return snapshot.aggregateCoverage;
}
