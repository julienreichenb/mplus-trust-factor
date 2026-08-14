import {
  SURVIVAL_V2_MODEL_CONFIG,
  type SurvivalV2ModelConfig,
} from "./constants.js";
import type {
  SurvivalV2ActiveHealingFactEvent,
  SurvivalV2TimedActivationFact,
} from "./types.js";

const RECOVERY_ACTIVATION_DEDUP_MS = 1_500;

export interface SurvivalV2ActiveHealingScore {
  eligible: boolean;
  rawCredit: number;
  diminishedCredit: number;
  /** Survival score points added after weighted components (capped). */
  cappedCredit: number;
  self: { eventCount: number; creditedEventCount: number; totalEffectiveHealingPctMaxHp: number };
  ally: { eventCount: number; creditedEventCount: number; totalEffectiveHealingPctMaxHp: number };
  skippedMatchedRecoveryActivation: number;
  limitations: string[];
}

function interpolateCredit(
  pct: number,
  curve: ReadonlyArray<{ effectiveHealPctMaxHp: number; credit: number }>,
): number {
  if (curve.length === 0) return 0;
  if (pct <= curve[0]!.effectiveHealPctMaxHp) return curve[0]!.credit;
  const last = curve[curve.length - 1]!;
  if (pct >= last.effectiveHealPctMaxHp) return last.credit;
  for (let i = 1; i < curve.length; i += 1) {
    const a = curve[i - 1]!;
    const b = curve[i]!;
    if (pct <= b.effectiveHealPctMaxHp) {
      const span = b.effectiveHealPctMaxHp - a.effectiveHealPctMaxHp;
      const t = span <= 0 ? 0 : (pct - a.effectiveHealPctMaxHp) / span;
      return a.credit + t * (b.credit - a.credit);
    }
  }
  return last.credit;
}

function matchesRecoveryActivation(
  event: SurvivalV2ActiveHealingFactEvent,
  activations: readonly SurvivalV2TimedActivationFact[],
): boolean {
  return activations.some(
    (a) =>
      a.abilityGameId === event.primarySpellId &&
      Math.abs(a.timestampMs - event.timestampMs) <= RECOVERY_ACTIVATION_DEDUP_MS,
  );
}

export function scoreSurvivalV2ActiveHealing(input: {
  events: readonly SurvivalV2ActiveHealingFactEvent[];
  recoveryActivations?: readonly SurvivalV2TimedActivationFact[];
  config?: SurvivalV2ModelConfig;
}): SurvivalV2ActiveHealingScore {
  const cfg = (input.config ?? SURVIVAL_V2_MODEL_CONFIG).activeHealing;
  const empty = (eligible: boolean, limitations: string[]): SurvivalV2ActiveHealingScore => ({
    eligible,
    rawCredit: 0,
    diminishedCredit: 0,
    cappedCredit: 0,
    self: { eventCount: 0, creditedEventCount: 0, totalEffectiveHealingPctMaxHp: 0 },
    ally: { eventCount: 0, creditedEventCount: 0, totalEffectiveHealingPctMaxHp: 0 },
    skippedMatchedRecoveryActivation: 0,
    limitations,
  });

  if (!cfg.enabled) return empty(false, ["active_healing_disabled"]);

  const self = { eventCount: 0, creditedEventCount: 0, totalEffectiveHealingPctMaxHp: 0 };
  const ally = { eventCount: 0, creditedEventCount: 0, totalEffectiveHealingPctMaxHp: 0 };
  const limitations = new Set<string>();
  let raw = 0;
  let skippedMatched = 0;
  const activations = input.recoveryActivations ?? [];

  for (const event of input.events) {
    if (event.targetRelation === "SELF") self.eventCount += 1;
    else if (event.targetRelation === "ALLY") ally.eventCount += 1;
    else continue;

    if (event.evidenceQuality === "MAX_HP_UNAVAILABLE") {
      limitations.add("target_max_hp_unavailable");
      continue;
    }
    if (event.evidenceQuality === "EXCLUDED") continue;
    if (event.evidenceQuality === "OVERHEAL_UNOBSERVABLE") {
      limitations.add("overheal_unobservable");
    }
    const pct = event.effectiveHealPctMaxHp;
    if (pct == null || pct < cfg.minEffectiveHealPctMaxHp) continue;
    if (event.effectiveAmount != null && event.effectiveAmount <= 0) continue;

    if (matchesRecoveryActivation(event, activations)) {
      skippedMatched += 1;
      continue;
    }

    const credit = interpolateCredit(pct, cfg.eventCreditCurve);
    const weight = event.targetRelation === "SELF" ? cfg.selfWeight : cfg.allyWeight;
    raw += credit * weight;
    if (event.targetRelation === "SELF") {
      self.creditedEventCount += 1;
      self.totalEffectiveHealingPctMaxHp += pct;
    } else {
      ally.creditedEventCount += 1;
      ally.totalEffectiveHealingPctMaxHp += pct;
    }
  }

  const diminished = raw <= 0 ? 0 : Math.pow(raw, cfg.diminishingExponent);
  const capped = Math.min(cfg.maxSurvivalBonusPoints, diminished);
  return {
    eligible: true,
    rawCredit: raw,
    diminishedCredit: diminished,
    cappedCredit: capped,
    self,
    ally,
    skippedMatchedRecoveryActivation: skippedMatched,
    limitations: [...limitations].sort(),
  };
}
