import { describe, expect, it } from "vitest";
import type { RunCombatFacts } from "@mplus/provider-warcraftlogs";
import { extractMetricsFromCombatFacts } from "./combat-metrics.js";

const baseFacts: RunCombatFacts = {
  reportCode: "AbCdEf12XyZ3",
  fightId: 1,
  revision: 1,
  targetSourceId: 42,
  actorMap: {},
  casts: [],
  interrupts: [{ timestamp: 1, abilityGameId: 1, sourceId: 42, targetId: 99, interruptedAbilityGameId: 2 }],
  deaths: [{ timestamp: 2, sourceId: 99, targetId: 42, killerId: 99, abilityGameId: 3 }],
  damageTaken: [],
  auras: [],
  dispels: [],
  healing: [],
  combatantInfo: null,
  coverage: {
    casts: false,
    interrupts: true,
    deaths: true,
    damageTaken: false,
    auras: false,
    dispels: false,
    healing: false,
    combatantInfo: false,
  },
  limitations: { missingCategories: [], truncatedPages: [], notes: [] },
};

describe("extractMetricsFromCombatFacts", () => {
  it("derives survival and utility metrics from WCL combat facts", () => {
    const observations = extractMetricsFromCombatFacts(baseFacts, "2026-07-27T12:00:00.000Z");
    const survival = observations.find((obs) => obs.metricKey === "survival.death_rate");
    const utility = observations.find((obs) => obs.metricKey === "utility.interrupt_success");

    expect(survival?.rawValue).toBe(1);
    expect(survival?.sourceProvider).toBe("warcraftlogs");
    expect(utility?.rawValue).toBe(1);
    expect(utility?.normalizedValue).toBe(100);
  });
});
