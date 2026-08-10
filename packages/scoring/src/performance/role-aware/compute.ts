import { createHash } from "node:crypto";
import { clamp, clamp01 } from "../../math.js";
import {
  buildDimensionConfidenceBreakdown,
  uniqueCauses,
} from "../../confidence/dimension-confidence.js";
import { stableStringify } from "../../model-config/stable-hash.js";
import { computeOffensiveCooldownDiscipline } from "../phase2/cooldown-discipline.js";
import {
  DPS_PERFORMANCE_WEIGHTS,
  HEALER_PERFORMANCE_WEIGHTS,
  PERFORMANCE_ROLE_AWARE_ALGORITHM_VERSION,
  PERFORMANCE_ROLE_AWARE_MODEL_LABEL,
} from "./constants.js";
import { computeParseChannelScore } from "./parse-channel.js";
import type {
  RoleAwarePerformanceComputeInput,
  RoleAwarePerformanceComputeResult,
  RoleAwarePerformanceWeightsApplied,
} from "./types.js";

export function computeRoleAwarePerformanceInputFingerprint(
  input: RoleAwarePerformanceComputeInput,
): string {
  return createHash("sha256")
    .update(
      stableStringify({
        algorithmVersion: PERFORMANCE_ROLE_AWARE_ALGORITHM_VERSION,
        role: input.role,
        specSlug: input.specSlug,
        activeDungeonSlugs: [...input.activeDungeonSlugs].sort(),
        damage: input.damage
          ? {
              metric: input.damage.metric,
              best: input.damage.bestPercentileAverage,
              median: input.damage.medianPercentileAverage,
              binding: input.damage.specBinding,
              perDungeon: [...input.damage.perDungeon]
                .map((d) => ({
                  slug: d.dungeonSlug,
                  best: d.bestParsePercentile,
                  median: d.medianParsePercentile,
                }))
                .sort((a, b) => a.slug.localeCompare(b.slug)),
            }
          : null,
        healing: input.healing
          ? {
              metric: input.healing.metric,
              best: input.healing.bestPercentileAverage,
              median: input.healing.medianPercentileAverage,
              binding: input.healing.specBinding,
              perDungeon: [...input.healing.perDungeon]
                .map((d) => ({
                  slug: d.dungeonSlug,
                  best: d.bestParsePercentile,
                  median: d.medianParsePercentile,
                }))
                .sort((a, b) => a.slug.localeCompare(b.slug)),
            }
          : null,
        cooldownRuns:
          input.role === "DPS"
            ? [...input.cooldownRuns]
                .map((r) => ({
                  slotId: r.slotId,
                  reportCode: r.reportCode,
                  fightId: r.fightId,
                  activations: r.offensiveActivations.length,
                }))
                .sort((a, b) => a.slotId.localeCompare(b.slotId))
            : [],
      }),
    )
    .digest("hex");
}

/**
 * Provider-free role-aware Performance calculator.
 * Does not use detailed playerscore parse facts.
 */
export function computeRoleAwarePerformance(
  input: RoleAwarePerformanceComputeInput,
): RoleAwarePerformanceComputeResult {
  const inputFingerprint = computeRoleAwarePerformanceInputFingerprint(input);
  const active = input.activeDungeonSlugs;
  const expectedPartition = input.expectedPartition ?? null;
  const logFreshness = input.logFreshness ?? 1;

  if (input.role === "UNKNOWN") {
    const causes = ["role_identity_unknown"];
    return unavailableResult(input, inputFingerprint, causes);
  }

  const damageParse = computeParseChannelScore(input.damage, active, {
    expectedPartition,
    logFreshness,
    causePrefix: "damage_parse",
  });
  const healingParse =
    input.role === "HEALER"
      ? computeParseChannelScore(input.healing, active, {
          expectedPartition,
          logFreshness,
          causePrefix: "healing_parse",
        })
      : null;

  // --- TANK ---
  if (input.role === "TANK") {
    if (damageParse.state !== "AVAILABLE" || damageParse.score == null) {
      return unavailableResult(input, inputFingerprint, [
        "damage_parse_unavailable",
        ...damageParse.causes,
      ]);
    }
    const weights: RoleAwarePerformanceWeightsApplied = {
      damageParse: 1,
      healingParse: 0,
      cooldown: 0,
    };
    const causes = uniqueCauses([...damageParse.causes]);
    const confidence = clamp01(damageParse.confidence);
    return {
      state: damageParse.evidenceCoverage < 1 ? "PARTIAL" : "AVAILABLE",
      score: clamp(damageParse.score, 0, 100),
      confidence,
      confidenceBreakdown: buildDimensionConfidenceBreakdown({
        value: confidence,
        causes,
        components: {
          damageParseConfidence: damageParse.confidence,
          damageEvidenceCoverage: damageParse.evidenceCoverage,
        },
      }),
      role: input.role,
      damageParse,
      healingParse: null,
      offensiveCooldownDiscipline: null,
      cooldown: null,
      weightsApplied: weights,
      limitations: causes,
      algorithmVersion: PERFORMANCE_ROLE_AWARE_ALGORITHM_VERSION,
      modelLabel: PERFORMANCE_ROLE_AWARE_MODEL_LABEL,
      inputFingerprint,
      coverage: coverageFrom(input, damageParse, null, null),
      contributors: [
        {
          key: "performance.damage_parse",
          value: damageParse.score,
          weight: 1,
          note: null,
        },
      ],
    };
  }

  // --- HEALER ---
  if (input.role === "HEALER") {
    if (healingParse == null || healingParse.state !== "AVAILABLE" || healingParse.score == null) {
      return unavailableResult(input, inputFingerprint, [
        "healing_parse_unavailable",
        ...(healingParse?.causes ?? []),
      ]);
    }
    if (damageParse.state !== "AVAILABLE" || damageParse.score == null) {
      return unavailableResult(input, inputFingerprint, [
        "damage_parse_unavailable",
        ...damageParse.causes,
      ]);
    }
    const score =
      HEALER_PERFORMANCE_WEIGHTS.healingParse * healingParse.score +
      HEALER_PERFORMANCE_WEIGHTS.damageParse * damageParse.score;
    const confidence = clamp01(
      HEALER_PERFORMANCE_WEIGHTS.healingParse * healingParse.confidence +
        HEALER_PERFORMANCE_WEIGHTS.damageParse * damageParse.confidence,
    );
    const causes = uniqueCauses([
      ...healingParse.causes,
      ...damageParse.causes,
    ]);
    const weights: RoleAwarePerformanceWeightsApplied = {
      damageParse: HEALER_PERFORMANCE_WEIGHTS.damageParse,
      healingParse: HEALER_PERFORMANCE_WEIGHTS.healingParse,
      cooldown: 0,
    };
    const partial =
      healingParse.evidenceCoverage < 1 || damageParse.evidenceCoverage < 1;
    return {
      state: partial ? "PARTIAL" : "AVAILABLE",
      score: clamp(score, 0, 100),
      confidence,
      confidenceBreakdown: buildDimensionConfidenceBreakdown({
        value: confidence,
        causes,
        components: {
          healingParseConfidence: healingParse.confidence,
          damageParseConfidence: damageParse.confidence,
          healingEvidenceCoverage: healingParse.evidenceCoverage,
          damageEvidenceCoverage: damageParse.evidenceCoverage,
        },
      }),
      role: input.role,
      damageParse,
      healingParse,
      offensiveCooldownDiscipline: null,
      cooldown: null,
      weightsApplied: weights,
      limitations: causes,
      algorithmVersion: PERFORMANCE_ROLE_AWARE_ALGORITHM_VERSION,
      modelLabel: PERFORMANCE_ROLE_AWARE_MODEL_LABEL,
      inputFingerprint,
      coverage: coverageFrom(input, damageParse, healingParse, null),
      contributors: [
        {
          key: "performance.healing_parse",
          value: healingParse.score,
          weight: HEALER_PERFORMANCE_WEIGHTS.healingParse,
          note: null,
        },
        {
          key: "performance.damage_parse",
          value: damageParse.score,
          weight: HEALER_PERFORMANCE_WEIGHTS.damageParse,
          note: null,
        },
      ],
    };
  }

  // --- DPS ---
  if (damageParse.state !== "AVAILABLE" || damageParse.score == null) {
    return unavailableResult(input, inputFingerprint, [
      "damage_parse_unavailable",
      ...damageParse.causes,
    ]);
  }

  const cooldown = computeOffensiveCooldownDiscipline(input.cooldownRuns);
  const cooldownOk = cooldown.score != null && Number.isFinite(cooldown.score);
  const causes = uniqueCauses([...damageParse.causes]);

  let score: number;
  let weights: RoleAwarePerformanceWeightsApplied;
  let state: "AVAILABLE" | "PARTIAL" | "UNAVAILABLE";
  let cooldownEvidenceConfidence = 0;

  if (!cooldownOk) {
    score = damageParse.score;
    weights = { damageParse: 1, healingParse: 0, cooldown: 0 };
    state = "PARTIAL";
    causes.push("cooldown_evidence_unavailable");
    cooldownEvidenceConfidence = 0;
  } else {
    score =
      DPS_PERFORMANCE_WEIGHTS.damageParse * damageParse.score +
      DPS_PERFORMANCE_WEIGHTS.cooldown * cooldown.score!;
    weights = {
      damageParse: DPS_PERFORMANCE_WEIGHTS.damageParse,
      healingParse: 0,
      cooldown: DPS_PERFORMANCE_WEIGHTS.cooldown,
    };
    const selected = cooldown.selectedRunCount;
    const usable = cooldown.cooldownUsableRunCount;
    cooldownEvidenceConfidence =
      selected <= 0 ? 0 : clamp01(usable / Math.max(1, selected));
    if (usable < selected) causes.push("incomplete_cooldown_run_coverage");
    if (usable === 0) causes.push("no_evaluable_cooldown_abilities");
    if (cooldown.catalogueIncompatibleRuns.length > 0) {
      causes.push("cooldown_catalogue_incompatible_runs");
    }
    if (cooldown.runsWithoutValidDuration.length > 0) {
      causes.push("cooldown_invalid_duration_runs");
    }
    state =
      damageParse.evidenceCoverage < 1 || usable < selected
        ? "PARTIAL"
        : "AVAILABLE";
  }

  const confidence = clamp01(
    weights.cooldown <= 0
      ? weights.damageParse * damageParse.confidence
      : (weights.damageParse * damageParse.confidence +
          weights.cooldown * cooldownEvidenceConfidence) /
          (weights.damageParse + weights.cooldown),
  );

  const finalCauses = uniqueCauses(causes);
  return {
    state,
    score: clamp(score, 0, 100),
    confidence,
    confidenceBreakdown: buildDimensionConfidenceBreakdown({
      value: confidence,
      causes: finalCauses,
      components: {
        damageParseConfidence: damageParse.confidence,
        cooldownEvidenceConfidence,
        damageParseWeight: weights.damageParse,
        cooldownWeight: weights.cooldown,
        damageEvidenceCoverage: damageParse.evidenceCoverage,
      },
    }),
    role: input.role,
    damageParse,
    healingParse: null,
    offensiveCooldownDiscipline: cooldown.score,
    cooldown,
    weightsApplied: weights,
    limitations: finalCauses,
    algorithmVersion: PERFORMANCE_ROLE_AWARE_ALGORITHM_VERSION,
    modelLabel: PERFORMANCE_ROLE_AWARE_MODEL_LABEL,
    inputFingerprint,
    coverage: coverageFrom(input, damageParse, null, cooldown),
    contributors: [
      {
        key: "performance.damage_parse",
        value: damageParse.score,
        weight: weights.damageParse,
        note: null,
      },
      {
        key: "performance.offensive_cooldown_discipline",
        value: cooldown.score,
        weight: weights.cooldown,
        note: cooldown.score == null ? "cooldown_evidence_unavailable" : null,
      },
    ],
  };
}

function coverageFrom(
  input: RoleAwarePerformanceComputeInput,
  damageParse: { dungeonsUsed: number; availableCells: number } | null,
  healingParse: { dungeonsUsed: number; availableCells: number } | null,
  cooldown: ReturnType<typeof computeOffensiveCooldownDiscipline> | null,
) {
  return {
    activeDungeonCount: input.activeDungeonSlugs.length,
    damageDungeonCount: damageParse?.dungeonsUsed ?? 0,
    healingDungeonCount: healingParse?.dungeonsUsed ?? 0,
    damageAvailableCells: damageParse?.availableCells ?? 0,
    healingAvailableCells: healingParse?.availableCells ?? 0,
    cooldownUsableRunCount: cooldown?.cooldownUsableRunCount ?? 0,
    evaluatedAbilityCount: cooldown?.evaluatedAbilityCount ?? 0,
    selectedRunCount: cooldown?.selectedRunCount ?? input.cooldownRuns.length,
  };
}

function unavailableResult(
  input: RoleAwarePerformanceComputeInput,
  inputFingerprint: string,
  causes: string[],
): RoleAwarePerformanceComputeResult {
  const finalCauses = uniqueCauses(causes);
  return {
    state: "UNAVAILABLE",
    score: null,
    confidence: 0,
    confidenceBreakdown: buildDimensionConfidenceBreakdown({
      value: 0,
      causes: finalCauses,
      components: {},
    }),
    role: input.role,
    damageParse: null,
    healingParse: null,
    offensiveCooldownDiscipline: null,
    cooldown: null,
    weightsApplied: { damageParse: 0, healingParse: 0, cooldown: 0 },
    limitations: finalCauses,
    algorithmVersion: PERFORMANCE_ROLE_AWARE_ALGORITHM_VERSION,
    modelLabel: PERFORMANCE_ROLE_AWARE_MODEL_LABEL,
    inputFingerprint,
    coverage: coverageFrom(input, null, null, null),
    contributors: [],
  };
}
