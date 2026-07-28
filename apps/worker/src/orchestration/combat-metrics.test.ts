import { describe, expect, it } from "vitest";
import type { RunCombatFacts } from "@mplus/provider-warcraftlogs";
import { getAbilityCatalog, WARLOCK_DEMONOLOGY_CATALOG } from "@mplus/abilities";
import { extractMetricsFromCombatFacts } from "./combat-metrics.js";

const baseFacts: RunCombatFacts = {
  reportCode: "AbCdEf12XyZ3",
  fightId: 1,
  revision: 1,
  targetSourceId: 42,
  attributedSourceIds: [42, 99],
  actorMap: { byId: new Map(), byName: new Map() },
  casts: [
    { timestamp: 1, abilityGameId: 19647, sourceId: 99, targetId: 50 },
    { timestamp: 2, abilityGameId: 108416, sourceId: 42, targetId: 42 },
  ],
  interrupts: [
    { timestamp: 1, abilityGameId: 19647, sourceId: 99, targetId: 50, interruptedAbilityGameId: 2 },
  ],
  deaths: [{ timestamp: 2, sourceId: 99, targetId: 42, killerId: 99, abilityGameId: 3 }],
  damageTaken: [],
  auras: [],
  dispels: [],
  healing: [],
  combatantInfo: null,
  coverage: {
    casts: true,
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
  it("derives survival and utility metrics from WCL combat facts with pet attribution", () => {
    const observations = extractMetricsFromCombatFacts(baseFacts, "2026-07-27T12:00:00.000Z", {
      catalog: WARLOCK_DEMONOLOGY_CATALOG,
      classSlug: "warlock",
      specSlug: "demonology",
      runDurationMs: 1_800_000,
    });
    const survival = observations.find((obs) => obs.metricKey === "survival.death_rate");
    const interrupts = observations.find((obs) => obs.metricKey === "utility.interrupts");
    const defensives = observations.find((obs) => obs.metricKey === "survival.defensive_usage");

    expect(survival?.rawValue).toBe(1);
    expect(interrupts?.context).toMatchObject({ kickCasts: 1, successfulInterrupts: 1 });
    expect(defensives?.rawValue).toBe(1);
  });

  it("does not invent zeros for unsupported class catalogs", () => {
    const catalog = getAbilityCatalog({ classSlug: "mage", specSlug: "frost" });
    const observations = extractMetricsFromCombatFacts(baseFacts, "2026-07-27T12:00:00.000Z", {
      catalog,
      classSlug: "mage",
      specSlug: "frost",
    });
    expect(observations).toHaveLength(1);
    expect(observations[0]?.context).toMatchObject({
      reason: "ABILITY_CATALOG_UNSUPPORTED",
    });
  });
});
