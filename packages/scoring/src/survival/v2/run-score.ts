import {
  isSurvivalV2RelativeDamageWeightActive,
  relativeDamageBlendScore,
  scoreSurvivalV2RelativeDamageShadow,
} from "./relative-damage.js";
import { scoreSurvivalV2Defensive } from "./defensive.js";
import { scoreSurvivalV2Outcome } from "./outcome.js";
import {
  mergePressureClusters,
  scoreSurvivalV2EmergencyRecovery,
} from "./recovery.js";
import { resolveSurvivalV2Weights } from "./weights.js";
import {
  SURVIVAL_V2_MODEL_CONFIG,
  type SurvivalV2ModelConfig,
  type SurvivalV2RelativeDamageMode,
} from "./constants.js";
import type { SurvivalFactDocumentV2, SurvivalV2RunScore } from "./types.js";

/** Score one selected-slot Survival fact document (provider-free). */
export function scoreSurvivalV2Run(
  fact: SurvivalFactDocumentV2,
  relativeDamageMode: SurvivalV2RelativeDamageMode,
  config: SurvivalV2ModelConfig = SURVIVAL_V2_MODEL_CONFIG,
): SurvivalV2RunScore {
  const limitations = [...fact.limitations];

  if (fact.healthEvidence.mode === "TRUNCATED") {
    limitations.push("health_data_truncated");
  }
  if (fact.activeCombat.truncated) {
    limitations.push("active_combat_truncated");
  }

  const outcome = scoreSurvivalV2Outcome(fact.deaths, config);
  const defensive = scoreSurvivalV2Defensive({
    activations: fact.defensiveActivations,
    activeCombatDurationMs: fact.activeCombat.durationMs,
    dangerWindows: fact.dangerWindows,
    config,
  });

  const clusters = mergePressureClusters(fact.dangerWindows, {
    alreadyMerged: fact.pressureClustersPremerged === true,
    config,
  });
  const recovery = scoreSurvivalV2EmergencyRecovery({
    clusters,
    selfHealCatalogCoverage: fact.healthEvidence.catalogSelfHealCoverage,
    config,
  });

  const relativeDamageShadow = scoreSurvivalV2RelativeDamageShadow({
    fact: fact.relativeDamage,
    mode: relativeDamageMode,
  });
  const relativeWeightActive = isSurvivalV2RelativeDamageWeightActive(
    relativeDamageMode,
    relativeDamageShadow,
  );
  const relativeBlend = relativeDamageBlendScore(relativeDamageShadow);

  const weights = resolveSurvivalV2Weights(
    relativeDamageMode,
    {
      outcome: outcome.state === "SCORED",
      defensive: defensive.state === "SCORED",
      recovery: recovery.state === "SCORED",
      relativeDamage: relativeWeightActive,
    },
    config,
  );

  outcome.weightUsed = weights.outcome;
  defensive.weightUsed = weights.defensive;
  recovery.weightUsed = weights.recovery;

  const behavioralScore =
    (outcome.score ?? 0) * weights.outcome +
    (defensive.score ?? 0) * weights.defensive +
    (recovery.score ?? 0) * weights.recovery +
    (relativeBlend != null ? relativeBlend * weights.relativeDamage : 0);

  const healthBlocksBehavioral =
    fact.healthEvidence.mode === "MISSING" ||
    fact.healthEvidence.mode === "OUTCOME_ONLY";

  // Outcome always scores; thin health evidence still yields a valid run score
  // (confidence caps applied at season aggregate).
  const valid = outcome.state === "SCORED";

  return {
    dungeonSlug: fact.dungeonSlug,
    slotIndex: fact.slotIndex,
    identity: fact.identity,
    keyLevel: fact.keyLevel,
    behavioralScore: valid ? behavioralScore : null,
    outcome,
    defensive,
    recovery,
    relativeDamageShadow,
    weightsApplied: weights,
    healthEvidenceMode: fact.healthEvidence.mode,
    pressureClusterCount: clusters.length,
    deathCount: fact.deaths.count,
    limitations: healthBlocksBehavioral
      ? [...new Set([...limitations, `health_mode_${fact.healthEvidence.mode}`])]
      : [...new Set(limitations)],
    valid,
    invalidReason: valid ? null : "outcome_unavailable",
  };
}
