import { describe, expect, it } from "vitest";
import { getAbilityCatalog } from "@mplus/abilities";
import { activeSeasonDungeonPool } from "./survival-probe-logic.js";
import {
  aggregateUtilityDungeon,
  analyzeCrowdControl,
  analyzeDispelsAndPurges,
  analyzeGroupUtility,
  analyzeInterrupts,
  buildUtilityGlobalSummary,
  emptyUtilityEventDatasets,
  normalizeUtilityRun,
} from "./utility-probe-logic.js";
import { UTILITY_EVENT_TYPES } from "./utility-probe-types.js";
import type {
  UtilityActorContext,
  UtilityEventDataType,
  UtilityNormalizedRun,
  UtilityRawEventDataset,
  UtilityRunSummary,
} from "./utility-probe-types.js";

function buildActorCtx(overrides: Partial<UtilityActorContext> = {}): UtilityActorContext {
  const actorsById: UtilityActorContext["actorsById"] = new Map([
    [1, { id: 1, name: "Wallidrixe", type: "Player", subType: null, petOwner: null }],
    [2, { id: 2, name: "Wallidrixe's Felguard", type: "Pet", subType: "Felguard", petOwner: 1 }],
    [3, { id: 3, name: "Healbot", type: "Player", subType: null, petOwner: null }],
    [100, { id: 100, name: "Training Dummy", type: "NPC", subType: "Boss", petOwner: null }],
  ]);
  return {
    playerActorId: 1,
    ownedPetActorIds: [2],
    friendlyPlayerIds: [1, 3],
    actorsById,
    hostileValidatedByDamage: new Set([100]),
    ...overrides,
  };
}

function rawDataset(
  dataType: UtilityEventDataType,
  events: Array<Record<string, unknown>> = [],
  overrides: Partial<UtilityRawEventDataset> = {},
): UtilityRawEventDataset {
  return {
    dataType,
    state: "OK",
    pageCount: 1,
    truncated: false,
    filterSourceId: null,
    events,
    pages: [],
    graphqlErrors: [],
    note: null,
    ...overrides,
  };
}

function fakeRunSummary(input: {
  runId: string;
  dungeonSlug: string;
  successfulInterrupts?: number;
  ccUses?: number;
  dispels?: number;
  purges?: number;
  externalGroupUtilityUses?: number;
  classSpecificUses?: number;
}): UtilityRunSummary {
  const normalized: UtilityNormalizedRun = {
    reportCode: input.runId,
    fightId: 1,
    dungeonSlug: input.dungeonSlug,
    keyLevel: 10,
    durationMs: 600_000,
    playerActorId: 1,
    petActorIds: [],
    specialization: "demonology",
    classSlug: "warlock",
    interruptEvents: [],
    ccEvents: [],
    dispelPurgeEvents: [],
    externalGroupUtilityEvents: [],
    classSpecificEvents: [],
    interruptOpportunities: [],
    dispelPurgeOpportunities: [],
    unmatchedAbilityIds: [],
    incompleteDatasets: [],
    datasetStates: Object.fromEntries(
      UTILITY_EVENT_TYPES.map((t) => [t, "OK"]),
    ) as Record<UtilityEventDataType, UtilityRawEventDataset["state"]>,
    truncatedDatasets: [],
  };
  return {
    runId: input.runId,
    reportCode: input.runId,
    fightId: 1,
    dungeonSlug: input.dungeonSlug,
    keyLevel: 10,
    durationMs: 600_000,
    playerActorId: 1,
    petActorIds: [],
    specialization: "demonology",
    successfulInterrupts: input.successfulInterrupts ?? 0,
    interruptOpportunityCandidates: 0,
    interruptOpportunitiesPlayerAvailable: 0,
    interruptOpportunitiesInvalidatedOtherFirst: 0,
    interruptOpportunitiesUnresolved: 0,
    ccUses: input.ccUses ?? 0,
    hardCcUses: 0,
    softCcUses: 0,
    dispels: input.dispels ?? 0,
    purges: input.purges ?? 0,
    externalGroupUtilityUses: input.externalGroupUtilityUses ?? 0,
    classSpecificUses: input.classSpecificUses ?? 0,
    unmatchedAbilityIds: [],
    incompleteDatasets: [],
    normalized,
  };
}

describe("utility-probe-logic: interrupts", () => {
  it("attributes a player interrupt", () => {
    const catalog = getAbilityCatalog({ classSlug: "warlock", specSlug: "demonology" });
    const result = analyzeInterrupts({
      interrupts: [{ timestamp: 1000, sourceID: 1, targetID: 100, abilityGameID: 19647 }],
      casts: [],
      catalog,
      classSlug: "warlock",
      specSlug: "demonology",
      actorCtx: buildActorCtx(),
      fightId: 1,
      reportCode: "PLAYER-INT",
    });

    expect(result.events).toHaveLength(1);
    expect(result.events[0]?.sourceKind).toBe("PLAYER");
    expect(result.events[0]?.unmatchedSpellId).toBe(false);
    expect(result.events[0]?.canonical?.canonicalKey).toBe("warlock.interrupt.spell-lock");
  });

  it("attributes a pet interrupt via ownedPetActorIds", () => {
    const catalog = getAbilityCatalog({ classSlug: "warlock", specSlug: "demonology" });
    const result = analyzeInterrupts({
      interrupts: [{ timestamp: 2000, sourceID: 2, targetID: 100, abilityGameID: 89766 }],
      casts: [],
      catalog,
      classSlug: "warlock",
      specSlug: "demonology",
      actorCtx: buildActorCtx(),
      fightId: 1,
      reportCode: "PET-INT",
    });

    expect(result.events).toHaveLength(1);
    expect(result.events[0]?.sourceKind).toBe("OWNED_PET");
    expect(result.events[0]?.canonical?.canonicalKey).toBe("warlock.interrupt.axe-toss");
  });

  it("invalidates an interrupt opportunity when another party member interrupts first", () => {
    const catalog = getAbilityCatalog({ classSlug: "warlock", specSlug: "demonology" });
    const result = analyzeInterrupts({
      interrupts: [{ timestamp: 1200, sourceID: 3, targetID: 100, abilityGameID: 96231 }],
      casts: [
        { timestamp: 1000, sourceID: 100, targetID: 1, abilityGameID: 5555, type: "begincast", interruptible: true },
        { timestamp: 1500, sourceID: 100, targetID: 1, abilityGameID: 5555, type: "castfailed", interruptible: true },
      ],
      catalog,
      classSlug: "warlock",
      specSlug: "demonology",
      actorCtx: buildActorCtx(),
      fightId: 1,
      reportCode: "OTHER-FIRST",
    });

    expect(result.opportunities).toHaveLength(1);
    expect(result.opportunities[0]?.status).toBe("INVALIDATED_OTHER_INTERRUPTED_FIRST");
    expect(result.opportunities[0]?.interruptedByOtherFirst).toBe(true);
  });

  it("marks a repeated player interrupt on cooldown and flags the opportunity as PLAYER_ON_COOLDOWN", () => {
    const catalog = getAbilityCatalog({ classSlug: "warlock", specSlug: "demonology" });
    const result = analyzeInterrupts({
      interrupts: [
        { timestamp: 1000, sourceID: 1, targetID: 100, abilityGameID: 19647 },
        { timestamp: 5000, sourceID: 1, targetID: 100, abilityGameID: 19647 },
      ],
      casts: [
        { timestamp: 2000, sourceID: 100, targetID: 1, abilityGameID: 4321, type: "begincast", interruptible: true },
        { timestamp: 2500, sourceID: 100, targetID: 1, abilityGameID: 4321, type: "cast", interruptible: true },
      ],
      catalog,
      classSlug: "warlock",
      specSlug: "demonology",
      actorCtx: buildActorCtx(),
      fightId: 1,
      reportCode: "ON-CD",
    });

    expect(result.events[1]?.cooldownStateAtCast).toBe("ON_COOLDOWN");
    const opportunity = result.opportunities.find((o) => o.castStart === 2000);
    expect(opportunity?.status).toBe("PLAYER_ON_COOLDOWN");
    expect(opportunity?.playerInterruptAvailable).toBe(false);
  });

  it("retains an unmatched interrupt spell ID instead of discarding it", () => {
    const catalog = getAbilityCatalog({ classSlug: "warlock", specSlug: "demonology" });
    const result = analyzeInterrupts({
      interrupts: [{ timestamp: 1000, sourceID: 1, targetID: 100, abilityGameID: 987_654 }],
      casts: [],
      catalog,
      classSlug: "warlock",
      specSlug: "demonology",
      actorCtx: buildActorCtx(),
      fightId: 1,
      reportCode: "UNMATCHED",
    });

    expect(result.unmatchedInterruptSpellIds).toContain(987_654);
    expect(result.events[0]?.unmatchedSpellId).toBe(true);
  });
});

describe("utility-probe-logic: crowd control", () => {
  it("classifies Shadowfury as a hard CC application", () => {
    const catalog = getAbilityCatalog({ classSlug: "warlock", specSlug: "demonology" });
    const result = analyzeCrowdControl({
      casts: [{ timestamp: 1000, sourceID: 1, targetID: 100, abilityGameID: 30283 }],
      buffs: [],
      debuffs: [{ timestamp: 1050, type: "apply", sourceID: 1, targetID: 100, abilityGameID: 30283 }],
      catalog,
      classSlug: "warlock",
      specSlug: "demonology",
      actorCtx: buildActorCtx(),
      fightId: 1,
      reportCode: "HARD-CC",
      fightEndTime: 60_000,
    });

    expect(result.events).toHaveLength(1);
    expect(result.events[0]?.category).toBe("HARD_CC");
    expect(result.events[0]?.debuffApplied).toBe(true);
  });

  it("classifies Fear as a soft CC application", () => {
    const catalog = getAbilityCatalog({ classSlug: "warlock", specSlug: "demonology" });
    const result = analyzeCrowdControl({
      casts: [{ timestamp: 2000, sourceID: 1, targetID: 100, abilityGameID: 5782 }],
      buffs: [],
      debuffs: [{ timestamp: 2040, type: "apply", sourceID: 1, targetID: 100, abilityGameID: 5782 }],
      catalog,
      classSlug: "warlock",
      specSlug: "demonology",
      actorCtx: buildActorCtx(),
      fightId: 1,
      reportCode: "SOFT-CC",
      fightEndTime: 60_000,
    });

    expect(result.events).toHaveLength(1);
    expect(result.events[0]?.category).toBe("SOFT_CC");
    expect(result.events[0]?.debuffApplied).toBe(true);
  });
});

describe("utility-probe-logic: dispels and purges", () => {
  it("attributes a friendly dispel via a pet (Singe Magic)", () => {
    const catalog = getAbilityCatalog({ classSlug: "warlock", specSlug: "demonology" });
    const result = analyzeDispelsAndPurges({
      dispels: [{ timestamp: 2000, sourceID: 2, targetID: 3, abilityGameID: 89808, extraAbilityGameID: 555 }],
      buffs: [],
      debuffs: [],
      catalog,
      classSlug: "warlock",
      specSlug: "demonology",
      actorCtx: buildActorCtx(),
      fightId: 1,
      reportCode: "DISPEL",
    });

    expect(result.events).toHaveLength(1);
    expect(result.events[0]?.kind).toBe("DISPEL");
    expect(result.events[0]?.targetSide).toBe("FRIENDLY");
    expect(result.events[0]?.sourceKind).toBe("OWNED_PET");
  });

  it("attributes a hostile purge (mage Spell Steal)", () => {
    const catalog = getAbilityCatalog({ classSlug: "mage", specSlug: "frost" });
    const result = analyzeDispelsAndPurges({
      dispels: [{ timestamp: 3000, sourceID: 1, targetID: 100, abilityGameID: 30449 }],
      buffs: [],
      debuffs: [],
      catalog,
      classSlug: "mage",
      specSlug: "frost",
      actorCtx: buildActorCtx(),
      fightId: 1,
      reportCode: "PURGE",
    });

    expect(result.events).toHaveLength(1);
    expect(result.events[0]?.kind).toBe("PURGE");
    expect(result.events[0]?.targetSide).toBe("HOSTILE");
    expect(result.events[0]?.sourceKind).toBe("PLAYER");
  });
});

describe("utility-probe-logic: group utility", () => {
  it("classifies an external defensive applied to an ally as possibly useful", () => {
    const catalog = getAbilityCatalog({ classSlug: "paladin", specSlug: "holy", role: "HEALER" });
    const result = analyzeGroupUtility({
      casts: [{ timestamp: 4000, sourceID: 1, targetID: 3, abilityGameID: 6940 }],
      buffs: [{ timestamp: 4040, type: "apply", sourceID: 1, targetID: 3, abilityGameID: 6940 }],
      deaths: [],
      catalog,
      classSlug: "paladin",
      specSlug: "holy",
      actorCtx: buildActorCtx(),
      fightId: 1,
      reportCode: "EXTERNAL",
    });

    const external = result.externalGroupEvents.find((e) => e.category === "EXTERNAL_DEFENSIVE");
    expect(external).toBeDefined();
    expect(external?.classification).toBe("POSSIBLY_USEFUL");
  });

  it("classifies a battle rez as confirmed useful when the target dies then is revived", () => {
    const catalog = getAbilityCatalog({ classSlug: "paladin", specSlug: "holy", role: "HEALER" });
    const result = analyzeGroupUtility({
      casts: [{ timestamp: 10_000, sourceID: 1, targetID: 3, abilityGameID: 391_054 }],
      buffs: [{ timestamp: 10_050, type: "apply", sourceID: 1, targetID: 3, abilityGameID: 391_054 }],
      deaths: [{ timestamp: 9000, sourceID: 100, targetID: 3, abilityGameID: 1 }],
      catalog,
      classSlug: "paladin",
      specSlug: "holy",
      actorCtx: buildActorCtx(),
      fightId: 1,
      reportCode: "BATTLE-REZ",
    });

    const rez = result.externalGroupEvents.find((e) => e.category === "BATTLE_REZ");
    expect(rez?.battleRezResult).toBe("REVIVED");
    expect(rez?.classification).toBe("CONFIRMED_USEFUL");
  });
});

describe("utility-probe-logic: dataset completeness", () => {
  it("keeps truncated and errored datasets explicit on the normalized run", () => {
    const catalog = getAbilityCatalog({ classSlug: "warlock", specSlug: "demonology" });
    const eventDatasets = emptyUtilityEventDatasets("unused");
    eventDatasets.Interrupts = rawDataset("Interrupts");
    eventDatasets.Casts = rawDataset("Casts");
    eventDatasets.Buffs = rawDataset("Buffs", [], { truncated: true, note: "Pagination truncated" });
    eventDatasets.Debuffs = rawDataset("Debuffs");
    eventDatasets.Dispels = rawDataset("Dispels", [], { state: "ERROR", note: "GraphQL error" });
    eventDatasets.CombatantInfo = rawDataset("CombatantInfo");

    const normalized = normalizeUtilityRun({
      reportCode: "INCOMPLETE",
      fightId: 1,
      dungeonSlug: "pit-of-saron",
      keyLevel: 10,
      durationMs: 600_000,
      specialization: "demonology",
      classSlug: "warlock",
      specSlug: "demonology",
      catalog,
      actorCtx: buildActorCtx(),
      eventDatasets,
      fightEndTime: 600_000,
    });

    expect(normalized.truncatedDatasets).toContain("Buffs");
    expect(normalized.datasetStates.Dispels).toBe("ERROR");
    expect(normalized.datasetStates.DamageDone).toBe("MISSING");
    expect(normalized.incompleteDatasets).toEqual(
      expect.arrayContaining(["Dispels", "DamageDone", "Deaths"]),
    );
  });
});

describe("utility-probe-logic: active-season dungeon pool", () => {
  it("excludes Icecrown from the active-season pool", () => {
    const pool = activeSeasonDungeonPool(["dungeon-a", "icecrown-citadel", "pit-of-saron"]);
    expect(pool).not.toContain("icecrown-citadel");
    expect(pool).toContain("pit-of-saron");
  });
});

describe("utility-probe-logic: equal-weight dungeon aggregation", () => {
  it("averages dungeon medians without weighting by run count", () => {
    const a1 = fakeRunSummary({ runId: "A1", dungeonSlug: "dungeon-a", successfulInterrupts: 10 });
    const a2 = fakeRunSummary({ runId: "A2", dungeonSlug: "dungeon-a", successfulInterrupts: 10 });
    const a3 = fakeRunSummary({ runId: "A3", dungeonSlug: "dungeon-a", successfulInterrupts: 10 });
    const b1 = fakeRunSummary({ runId: "B1", dungeonSlug: "dungeon-b", successfulInterrupts: 2 });

    const perDungeon = [
      aggregateUtilityDungeon("dungeon-a", [a1, a2, a3]),
      aggregateUtilityDungeon("dungeon-b", [b1]),
      aggregateUtilityDungeon("dungeon-c", []),
    ];
    const global = buildUtilityGlobalSummary(perDungeon, ["dungeon-a", "dungeon-b", "dungeon-c"]);

    expect(perDungeon[0]?.successfulInterruptsMedian).toBe(10);
    expect(perDungeon[1]?.successfulInterruptsMedian).toBe(2);
    // Equal-weight mean of dungeon medians (6), not run-count-weighted (would be 8).
    expect(global.equalWeightAverages.successfulInterruptsMedian).toBe(6);
    expect(global.coverage.dungeonsMissingRuns).toEqual(["dungeon-c"]);
  });
});
