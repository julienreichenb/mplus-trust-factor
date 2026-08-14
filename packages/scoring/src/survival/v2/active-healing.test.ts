import { describe, expect, it } from "vitest";
import {
  SURVIVAL_V2_MODEL_CONFIG,
  SURVIVAL_V2_SCHEMA_VERSION,
  fingerprintSurvivalV2ModelConfig,
  parseSurvivalV2ModelConfig,
  scoreSurvivalV2Run,
  type SurvivalFactDocumentV2,
  type SurvivalV2ActiveHealingFactEvent,
  type SurvivalV2DangerWindowFact,
  type SurvivalV2ModelConfig,
} from "./index.js";
import { scoreSurvivalV2ActiveHealing } from "./active-healing.js";

function fact(
  events: SurvivalV2ActiveHealingFactEvent[],
  extra?: Partial<SurvivalFactDocumentV2>,
): SurvivalFactDocumentV2 {
  return {
    schemaVersion: SURVIVAL_V2_SCHEMA_VERSION,
    extractorFamily: "survival",
    extractorVersion: "test",
    dungeonSlug: "skyreach",
    slotIndex: 0,
    identity: { reportCode: "abc", fightId: 1, reportRevision: 1 },
    keyLevel: 15,
    deaths: { count: 0, evidenceState: "OBSERVED" },
    activeCombat: { durationMs: 1_800_000, fightDurationMs: 2_000_000 },
    defensiveActivations: {
      byCategory: { DEFENSIVE_MAJOR: 1 },
      toolkit: [{ category: "DEFENSIVE_MAJOR", state: "AVAILABLE_CONFIRMED" }],
      catalogCoverage: 1,
    },
    dangerWindows: [],
    healthEvidence: { mode: "FULL", catalogSelfHealCoverage: 1 },
    relativeDamage: null,
    activeHealingEvents: events,
    recoveryTimedActivations: extra?.recoveryTimedActivations,
    limitations: [],
    ...extra,
  };
}

function evt(
  partial: Partial<SurvivalV2ActiveHealingFactEvent> &
    Pick<SurvivalV2ActiveHealingFactEvent, "canonicalEventId" | "targetRelation">,
): SurvivalV2ActiveHealingFactEvent {
  return {
    timestampMs: 10_000,
    primarySpellId: 85673,
    effectiveAmount: 80_000,
    effectiveHealPctMaxHp: 0.2,
    evidenceQuality: "FULL",
    ...partial,
  };
}

function scoredRecoveryWindow(): SurvivalV2DangerWindowFact {
  return {
    startMs: 0,
    endMs: 2_000,
    triggerTypes: ["LOW_HP"],
    hpEvidenceQuality: "EXPLICIT",
    recoveryEligible: true,
    recoveryUseful: true,
    recoveryResponseClass: "TIMELY_RECOVERY",
  };
}

function withHealCfg(
  override: Partial<SurvivalV2ModelConfig["activeHealing"]>,
): SurvivalV2ModelConfig {
  return {
    ...SURVIVAL_V2_MODEL_CONFIG,
    activeHealing: { ...SURVIVAL_V2_MODEL_CONFIG.activeHealing, ...override },
  };
}

describe("Survival V2 active hybrid healing", () => {
  it("credits Retribution self and ally heals", () => {
    const self = scoreSurvivalV2ActiveHealing({
      events: [evt({ canonicalEventId: "s", targetRelation: "SELF" })],
    });
    const ally = scoreSurvivalV2ActiveHealing({
      events: [evt({ canonicalEventId: "a", targetRelation: "ALLY" })],
    });
    expect(self.self.creditedEventCount).toBe(1);
    expect(ally.ally.creditedEventCount).toBe(1);
    expect(ally.rawCredit).toBeGreaterThan(self.rawCredit);
  });

  it("leaves baseline Survival unchanged when there are no eligible healing events", () => {
    const before = scoreSurvivalV2Run(fact([]), "off");
    const after = scoreSurvivalV2Run(
      fact([], { activeHealingEvents: [] }),
      "off",
    );
    expect(after.behavioralScore).toBe(before.behavioralScore);
    expect(after.outcome.score).toBe(before.outcome.score);
    expect(after.defensive.score).toBe(before.defensive.score);
    expect(after.recovery.score).toBe(before.recovery.score);
    expect(after.recovery.state).toBe(before.recovery.state);
    expect(after.weightsApplied).toEqual(before.weightsApplied);
  });

  it("adds the same bonus whether recovery is SCORED or N/A", () => {
    const events = [evt({ canonicalEventId: "s", targetRelation: "SELF", effectiveHealPctMaxHp: 0.4 })];
    const heal = scoreSurvivalV2ActiveHealing({ events });
    const na = scoreSurvivalV2Run(fact(events, { dangerWindows: [] }), "off");
    const scored = scoreSurvivalV2Run(
      fact(events, { dangerWindows: [scoredRecoveryWindow()] }),
      "off",
    );
    const naBase = scoreSurvivalV2Run(fact([], { dangerWindows: [] }), "off");
    const scoredBase = scoreSurvivalV2Run(
      fact([], { dangerWindows: [scoredRecoveryWindow()] }),
      "off",
    );
    expect(heal.cappedCredit).toBeGreaterThan(0);
    expect(na.recovery.state).toBe("NOT_APPLICABLE");
    expect(scored.recovery.state).toBe("SCORED");
    expect(na.recovery.score).toBe(naBase.recovery.score);
    expect(scored.recovery.score).toBe(scoredBase.recovery.score);
    expect((na.behavioralScore ?? 0) - (naBase.behavioralScore ?? 0)).toBeCloseTo(
      heal.cappedCredit,
    );
    expect((scored.behavioralScore ?? 0) - (scoredBase.behavioralScore ?? 0)).toBeCloseTo(
      heal.cappedCredit,
    );
  });

  it("does not credit excluded or healer-origin events that never reached facts", () => {
    const scored = scoreSurvivalV2ActiveHealing({
      events: [evt({ canonicalEventId: "x", targetRelation: "EXCLUDED" })],
    });
    expect(scored.cappedCredit).toBe(0);
  });

  it("zeros 100% overheal when effective amount is 0", () => {
    expect(
      scoreSurvivalV2ActiveHealing({
        events: [
          evt({
            canonicalEventId: "oh",
            targetRelation: "SELF",
            effectiveAmount: 0,
            effectiveHealPctMaxHp: 0,
          }),
        ],
      }).cappedCredit,
    ).toBe(0);
  });

  it("zeros trivial heals below the configured threshold", () => {
    expect(
      scoreSurvivalV2ActiveHealing({
        events: [
          evt({
            canonicalEventId: "t",
            targetRelation: "SELF",
            effectiveHealPctMaxHp: 0.01,
          }),
        ],
      }).cappedCredit,
    ).toBe(0);
  });

  it("applies configured curve, weights, diminishing, and maxSurvivalBonusPoints", () => {
    const large = evt({
      canonicalEventId: "l",
      targetRelation: "SELF",
      effectiveHealPctMaxHp: 1,
    });
    const base = scoreSurvivalV2ActiveHealing({ events: [large] });
    const selfW = scoreSurvivalV2ActiveHealing({
      events: [large],
      config: withHealCfg({ selfWeight: 2 }),
    });
    const steep = scoreSurvivalV2ActiveHealing({
      events: [large, { ...large, canonicalEventId: "l2" }, { ...large, canonicalEventId: "l3" }],
      config: withHealCfg({ diminishingExponent: 0.4, maxSurvivalBonusPoints: 1 }),
    });
    expect(selfW.rawCredit).toBeCloseTo(base.rawCredit * 2);
    expect(steep.cappedCredit).toBeLessThanOrEqual(1);
    expect(fingerprintSurvivalV2ModelConfig(withHealCfg({ selfWeight: 2 }))).not.toBe(
      fingerprintSurvivalV2ModelConfig(SURVIVAL_V2_MODEL_CONFIG),
    );
  });

  it("skips amount credit when SELF or ALLY already has a recovery activation", () => {
    const activations = [
      { id: "act", timestampMs: 20_000, abilityGameId: 85673, category: "SELF_HEAL" as const },
    ];
    const self = scoreSurvivalV2ActiveHealing({
      events: [evt({ canonicalEventId: "s", targetRelation: "SELF", timestampMs: 20_400 })],
      recoveryActivations: activations,
    });
    const ally = scoreSurvivalV2ActiveHealing({
      events: [evt({ canonicalEventId: "a", targetRelation: "ALLY", timestampMs: 20_000 })],
      recoveryActivations: activations,
    });
    expect(self.skippedMatchedRecoveryActivation).toBe(1);
    expect(ally.skippedMatchedRecoveryActivation).toBe(1);
    expect(self.cappedCredit).toBe(0);
    expect(ally.cappedCredit).toBe(0);
  });

  it("raises Survival run score by the bonus without changing recovery when credited", () => {
    const before = scoreSurvivalV2Run(fact([]), "off");
    const after = scoreSurvivalV2Run(
      fact([evt({ canonicalEventId: "s", targetRelation: "SELF", effectiveHealPctMaxHp: 0.4 })]),
      "off",
    );
    expect(after.recovery.state).toBe(before.recovery.state);
    expect(after.recovery.score).toBe(before.recovery.score);
    expect(after.behavioralScore ?? 0).toBeGreaterThan(before.behavioralScore ?? 0);
  });

  it("marks max HP unavailable as non-creditable", () => {
    const scored = scoreSurvivalV2ActiveHealing({
      events: [
        evt({
          canonicalEventId: "m",
          targetRelation: "SELF",
          evidenceQuality: "MAX_HP_UNAVAILABLE",
          effectiveHealPctMaxHp: null,
        }),
      ],
    });
    expect(scored.cappedCredit).toBe(0);
    expect(scored.limitations).toContain("target_max_hp_unavailable");
  });

  it("round-trips activeHealing through parseSurvivalV2ModelConfig", () => {
    const parsed = parseSurvivalV2ModelConfig(SURVIVAL_V2_MODEL_CONFIG);
    expect(parsed.activeHealing).toEqual(SURVIVAL_V2_MODEL_CONFIG.activeHealing);
    expect(parsed.activeHealing.maxSurvivalBonusPoints).toBe(18);
  });
});
