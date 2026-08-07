import { describe, expect, it } from "vitest";
import {
  PERFORMANCE_PHASE2_WEIGHTS,
} from "../performance/phase2/constants.js";
import { PERFORMANCE_V2_MODEL_CONFIG } from "../performance/v2/constants.js";
import {
  SURVIVAL_V2_MODEL_CONFIG,
  SURVIVAL_V2_WEIGHTS_SHADOW_OR_OFF,
} from "../survival/v2/constants.js";
import {
  UTILITY_V2_DOMAIN_WEIGHTS,
  UTILITY_V2_MODEL_CONFIG,
} from "../utility/v2/constants.js";
import {
  EXPERIENCE_V3_COMPONENT_WEIGHTS,
  EXPERIENCE_V3_MODEL_CONFIG,
} from "../experience/v3/constants.js";
import { createDefaultModelV6 } from "../model/defaults.js";
import {
  applyTunableWeightsToExperienceConfig,
  applyTunableWeightsToPerformanceConfig,
  applyTunableWeightsToSurvivalConfig,
  applyTunableWeightsToUtilityConfig,
  buildScoringDimensionConfigsFromTunable,
  createDefaultTunableWeights,
  effectiveWeightPercent,
  normalizeRelativeWeights,
  parseTunableWeights,
  resolvePerformancePhase2CombineWeights,
  resolveTunableWeights,
  trustDimensionWeightsFromTunable,
  validateTunableWeights,
  withTunableWeights,
} from "./tunable-weights.js";

describe("tunable weights", () => {
  it("rejects negative weights", () => {
    const bad = createDefaultTunableWeights();
    bad.dimensions.performance = -1;
    expect(validateTunableWeights(bad).some((e) => e.includes(">= 0"))).toBe(true);
    expect(() => parseTunableWeights(bad)).toThrow(/MODEL_CONFIG_INVALID/);
  });

  it("normalizes relative weights including zeros", () => {
    expect(normalizeRelativeWeights({ a: 35, b: 35, c: 30 })).toEqual({
      a: 0.35,
      b: 0.35,
      c: 0.3,
    });
    expect(normalizeRelativeWeights({ a: 0, b: 50, c: 50 })).toEqual({
      a: 0,
      b: 0.5,
      c: 0.5,
    });
    expect(normalizeRelativeWeights({ a: 0, b: 0 })).toEqual({ a: 0, b: 0 });
  });

  it("computes effective percentages from relatives", () => {
    const dims = { performance: 35, survival: 30, utility: 25, experience: 10 };
    expect(effectiveWeightPercent(35, dims)).toBe(35);
    expect(effectiveWeightPercent(30, dims)).toBe(30);
  });

  it("default dimension weights match production Trust v6", () => {
    const w = trustDimensionWeightsFromTunable(createDefaultTunableWeights());
    expect(w.performance).toBeCloseTo(0.35, 10);
    expect(w.survival).toBeCloseTo(0.3, 10);
    expect(w.utility).toBeCloseTo(0.25, 10);
    expect(w.experienceConsistency).toBeCloseTo(0.1, 10);
    expect(w.mythicRaid).toBe(0);
  });

  it("default component weights preserve production P/U/S calculator defaults", () => {
    const tunable = createDefaultTunableWeights();
    const combine = resolvePerformancePhase2CombineWeights(tunable);
    expect(combine.phase1).toBeCloseTo(PERFORMANCE_PHASE2_WEIGHTS.phase1, 10);
    expect(combine.cooldown).toBeCloseTo(PERFORMANCE_PHASE2_WEIGHTS.cooldown, 10);

    const perf = applyTunableWeightsToPerformanceConfig(tunable);
    expect(perf.dungeonWeights).toEqual(PERFORMANCE_V2_MODEL_CONFIG.dungeonWeights);
    expect(perf.profileWeights).toEqual(PERFORMANCE_V2_MODEL_CONFIG.profileWeights);

    const surv = applyTunableWeightsToSurvivalConfig(tunable);
    expect(surv.weightsShadowOrOff.outcome).toBeCloseTo(
      SURVIVAL_V2_WEIGHTS_SHADOW_OR_OFF.outcome,
      10,
    );
    expect(surv.weightsShadowOrOff.defensive).toBeCloseTo(
      SURVIVAL_V2_WEIGHTS_SHADOW_OR_OFF.defensive,
      10,
    );
    expect(surv.weightsShadowOrOff.recovery).toBeCloseTo(
      SURVIVAL_V2_WEIGHTS_SHADOW_OR_OFF.recovery,
      10,
    );
    expect(surv.weightsShadowOrOff.relativeDamage).toBe(0);

    const util = applyTunableWeightsToUtilityConfig(tunable);
    expect(util.domainWeights.castStops).toBeCloseTo(UTILITY_V2_DOMAIN_WEIGHTS.castStops, 10);
    expect(util.domainWeights.support).toBeCloseTo(UTILITY_V2_DOMAIN_WEIGHTS.support, 10);
    expect(util.domainWeights.strategicCc).toBeCloseTo(UTILITY_V2_DOMAIN_WEIGHTS.strategicCc, 10);

    // Untouched model configs stay bit-identical on non-weight fields of interest.
    expect(surv.algorithmVersion).toBe(SURVIVAL_V2_MODEL_CONFIG.algorithmVersion);
    expect(util.algorithmVersion).toBe(UTILITY_V2_MODEL_CONFIG.algorithmVersion);
  });

  it("Experience Phase 1 product weights map onto V3 with preserved exposure share", () => {
    const exp = applyTunableWeightsToExperienceConfig(createDefaultTunableWeights());
    expect(exp.componentWeights.currentExposure).toBeCloseTo(
      EXPERIENCE_V3_COMPONENT_WEIGHTS.currentExposure,
      10,
    );
    expect(exp.componentWeights.previousSeasonStrength).toBeCloseTo(
      EXPERIENCE_V3_COMPONENT_WEIGHTS.previousSeasonStrength,
      10,
    );
    expect(exp.componentWeights.eliteHistory).toBeCloseTo(
      EXPERIENCE_V3_COMPONENT_WEIGHTS.eliteHistory,
      10,
    );
    expect(exp.componentWeights.historicalRank).toBeCloseTo(
      EXPERIENCE_V3_COMPONENT_WEIGHTS.historicalRank,
      10,
    );
    expect(exp.algorithmVersion).toBe(EXPERIENCE_V3_MODEL_CONFIG.algorithmVersion);
  });

  it("createDefaultModelV6 embeds tunableWeights matching production defaults", () => {
    const model = createDefaultModelV6();
    const { weights, fromPersistedDocument } = resolveTunableWeights(model);
    expect(fromPersistedDocument).toBe(true);
    expect(weights.dimensions).toEqual(createDefaultTunableWeights().dimensions);
    expect(model.weights.performance).toBeCloseTo(0.35, 10);
  });

  it("withTunableWeights syncs Trust weights and scoring document", () => {
    const base = createDefaultModelV6({ version: 99 } as never);
    // Strip and re-apply
    const stripped = { ...base } as typeof base;
    delete (stripped as { tunableWeights?: unknown }).tunableWeights;
    const tunable = createDefaultTunableWeights();
    tunable.dimensions.performance = 50;
    tunable.dimensions.survival = 20;
    tunable.dimensions.utility = 20;
    tunable.dimensions.experience = 10;
    const next = withTunableWeights(stripped, tunable);
    expect(next.weights.performance).toBeCloseTo(0.5, 10);
    expect(next.scoring.performance.dungeonWeights.peak).toBeCloseTo(0.4, 10);
    expect(buildScoringDimensionConfigsFromTunable(tunable).utility.domainWeights).toEqual(
      next.scoring.utility.domainWeights,
    );
  });

  it("missing tunableWeights resolves to production defaults without throwing", () => {
    const { weights, fromPersistedDocument } = resolveTunableWeights({
      key: "default",
      version: 6,
      weights: {
        performance: 0.35,
        survival: 0.3,
        utility: 0.25,
        experienceConsistency: 0.1,
        mythicRaid: 0,
      },
      authenticityBlend: { skillWeight: 0.6, authenticityWeight: 0.4 },
      confidenceNeutralScore: 50,
      gradeThresholds: { S: 90, A: 80, B: 65, C: 50 },
    });
    expect(fromPersistedDocument).toBe(false);
    expect(weights.dimensions.performance).toBe(35);
  });
});
