import { describe, expect, it } from "vitest";
import { getAbilityCatalog } from "@mplus/abilities";
import { buildActorMap, resolveOwnedPetActorIds } from "../discovery/run-matching.js";
import type { WclRankingObservation } from "../types.js";
import {
  activeSeasonDungeonPool,
  classSlugFromWclClassId,
  compareSurvivalCandidates,
  flattenCandidateInspectionOrder,
  matchSpellIdsAgainstCatalog,
  normalizeSurvivalDataset,
  preserveEventFields,
  rankingsToSurvivalCandidates,
} from "./survival-probe-logic.js";
import type { SurvivalRawEventDataset, SurvivalRunCandidate } from "./survival-probe-types.js";
import { SURVIVAL_EVENT_TYPES } from "./survival-probe-types.js";

function emptyDataset(
  dataType: (typeof SURVIVAL_EVENT_TYPES)[number],
  events: Array<Record<string, unknown>> = [],
): SurvivalRawEventDataset {
  return {
    dataType,
    state: "OK",
    pageCount: 1,
    truncated: false,
    filterSourceId: 7,
    events,
    pages: [
      {
        pageIndex: 0,
        startTime: null,
        nextPageTimestamp: null,
        eventCount: events.length,
        rawResponseData: { events },
        graphqlErrors: [],
      },
    ],
    graphqlErrors: [],
    note: null,
  };
}

describe("survival-probe-logic", () => {
  it("excludes Icecrown from the active-season dungeon pool", () => {
    const pool = activeSeasonDungeonPool([
      "algethar-academy",
      "icecrown",
      "pit-of-saron",
      "The-Icecrown-Citadel",
    ]);
    expect(pool).toEqual(["algethar-academy", "pit-of-saron"]);
    expect(pool.some((s) => s.includes("icecrown"))).toBe(false);
  });

  it("orders candidates highest score first within each dungeon", () => {
    const rankings: WclRankingObservation[] = [
      {
        reportCode: "LowScore",
        fightId: 1,
        encounterId: 112526,
        zoneId: 47,
        bracket: 10,
        keyLevel: 10,
        score: 100,
        amount: null,
        percentile: null,
        rankPercent: null,
        bracketPercent: null,
        specSlug: "Demonology",
        roleSlug: "dps",
        durationMs: 1_800_000,
        startTimeMs: 1000,
        reportStartTimeMs: 1_700_000_000_000,
        timed: null,
        metric: "playerscore",
      },
      {
        reportCode: "HighScore",
        fightId: 2,
        encounterId: 112526,
        zoneId: 47,
        bracket: 12,
        keyLevel: 12,
        score: 250,
        amount: null,
        percentile: null,
        rankPercent: null,
        bracketPercent: null,
        specSlug: "Demonology",
        roleSlug: "dps",
        durationMs: 1_700_000,
        startTimeMs: 2000,
        reportStartTimeMs: 1_700_000_000_000,
        timed: null,
        metric: "playerscore",
      },
      {
        reportCode: "IcecrownSkip",
        fightId: 9,
        encounterId: 999999,
        zoneId: 47,
        bracket: 20,
        keyLevel: 20,
        score: 999,
        amount: null,
        percentile: null,
        rankPercent: null,
        bracketPercent: null,
        specSlug: "Demonology",
        roleSlug: "dps",
        durationMs: 1_000_000,
        startTimeMs: 3000,
        reportStartTimeMs: 1_700_000_000_000,
        timed: null,
        metric: "playerscore",
      },
    ];

    const byDungeon = rankingsToSurvivalCandidates(rankings);
    const academy = byDungeon.get("algethar-academy");
    expect(academy?.map((c) => c.reportCode)).toEqual(["HighScore", "LowScore"]);
    expect(byDungeon.has("icecrown")).toBe(false);

    const flat = flattenCandidateInspectionOrder(byDungeon);
    expect(flat[0]?.reportCode).toBe("HighScore");
  });

  it("compares candidates by key then score then recency", () => {
    const a: SurvivalRunCandidate = {
      reportCode: "A",
      fightId: 1,
      encounterId: 1,
      dungeonSlug: "skyreach",
      keyLevel: 10,
      score: 200,
      durationMs: null,
      startTimeMs: 1,
      completedAt: "2026-01-01T00:00:00.000Z",
      specSlug: null,
      roleSlug: null,
      rank: 1,
    };
    const b: SurvivalRunCandidate = {
      ...a,
      reportCode: "B",
      score: 100,
      keyLevel: 15,
    };
    expect(compareSurvivalCandidates(a, b)).toBeGreaterThan(0);
  });

  it("maps WCL classID 10 to warlock", () => {
    expect(classSlugFromWclClassId(10)).toBe("warlock");
    expect(classSlugFromWclClassId(9)).toBe("shaman");
  });

  it("preserves unknown event fields in additionalFields", () => {
    const preserved = preserveEventFields({
      timestamp: 100,
      sourceID: 3,
      targetID: 7,
      abilityGameID: 104773,
      amount: 5000,
      absorbed: 200,
      overkill: 50,
      hitType: 1,
      mysteryFlag: true,
      unmitigatedAmount: 5200,
    });
    expect(preserved.amount).toBe(5000);
    expect(preserved.absorbed).toBe(200);
    expect(preserved.overkill).toBe(50);
    expect(preserved.hitType).toBe(1);
    expect(preserved.additionalFields.mysteryFlag).toBe(true);
    expect(preserved.additionalFields.unmitigatedAmount).toBe(5200);
    expect(preserved.raw.mysteryFlag).toBe(true);
  });

  it("extracts actor/ability IDs from nested WCL objects", () => {
    const preserved = preserveEventFields({
      timestamp: 100,
      source: { id: 3, name: "NPC" },
      target: { id: 7, name: "Wallidrixe", type: "Warlock" },
      ability: { guid: 104773, name: "Unending Resolve" },
      amount: 5000,
      absorbed: 200,
      hitType: 1,
    });
    expect(preserved.sourceID).toBe(3);
    expect(preserved.targetID).toBe(7);
    expect(preserved.abilityGameID).toBe(104773);
    expect(preserved.additionalFields.sourceExtras).toEqual({ name: "NPC" });
    expect(preserved.additionalFields.targetExtras).toMatchObject({ name: "Wallidrixe" });
  });

  it("resolves owned pets via petOwner before heuristics", () => {
    const map = buildActorMap([
      { id: 7, name: "Wallidrixe", type: "Player", server: "Archimonde" },
      { id: 20, name: "Felguard", type: "Pet", subType: "Felguard", petOwner: 7 },
      { id: 21, name: "OtherPet", type: "Pet", subType: "Imp", petOwner: 99 },
      { id: 22, name: "Wallidrixe-Imp", type: "Pet", subType: "Imp" },
    ]);
    expect(resolveOwnedPetActorIds(map, 7, "Wallidrixe").sort((a, b) => a - b)).toEqual([20, 22]);
  });

  it("matches warlock defensives / consumables against @mplus/abilities", () => {
    const catalog = getAbilityCatalog({ classSlug: "warlock", specSlug: "demonology" });
    const match = matchSpellIdsAgainstCatalog(catalog, [104773, 108416, 6262, 999001]);
    expect(match.matched.map((m) => m.spellId).sort((a, b) => a - b)).toEqual([
      6262, 104773, 108416,
    ]);
    expect(match.unmatchedSpellIds).toEqual([999001]);
  });

  it("normalizes deaths, damage taken, defensives, and keeps avoidableClassification null", () => {
    const catalog = getAbilityCatalog({ classSlug: "warlock", specSlug: "demonology" });
    const datasets = Object.fromEntries(
      SURVIVAL_EVENT_TYPES.map((t) => [t, emptyDataset(t)]),
    ) as Record<(typeof SURVIVAL_EVENT_TYPES)[number], SurvivalRawEventDataset>;

    datasets.Deaths = emptyDataset("Deaths", [
      {
        timestamp: 50_000,
        sourceID: 100,
        targetID: 7,
        killerID: 100,
        abilityGameID: 12345,
        overkill: 800,
      },
    ]);
    datasets.DamageTaken = emptyDataset("DamageTaken", [
      {
        timestamp: 40_000,
        sourceID: 100,
        targetID: 7,
        abilityGameID: 222,
        amount: 10_000,
        absorbed: 1500,
        hitType: 1,
        customField: "kept",
      },
    ]);
    datasets.Casts = emptyDataset("Casts", [
      { timestamp: 30_000, sourceID: 7, targetID: 7, abilityGameID: 104773 },
      { timestamp: 31_000, sourceID: 7, targetID: 7, abilityGameID: 6262 },
    ]);
    datasets.Buffs = emptyDataset("Buffs", [
      { timestamp: 30_100, type: "apply", sourceID: 7, targetID: 7, abilityGameID: 104773 },
      { timestamp: 35_000, type: "remove", sourceID: 7, targetID: 7, abilityGameID: 104773 },
    ]);
    datasets.Healing = emptyDataset("Healing", [
      {
        timestamp: 32_000,
        sourceID: 7,
        targetID: 7,
        abilityGameID: 234153,
        amount: 4000,
        overheal: 200,
      },
    ]);
    datasets.CombatantInfo = emptyDataset("CombatantInfo", [
      {
        sourceID: 7,
        specID: 266,
        gear: [{ id: 1, itemLevel: 668 }, { id: 2, itemLevel: 670 }],
        talents: [{ id: 1 }],
      },
    ]);

    const normalized = normalizeSurvivalDataset({
      identity: { region: "EU", realmSlug: "archimonde", name: "Wallidrixe" },
      probedAt: "2026-07-28T00:00:00.000Z",
      candidate: {
        reportCode: "Abc123",
        fightId: 4,
        encounterId: 112526,
        dungeonSlug: "algethar-academy",
        keyLevel: 12,
        score: 250,
        durationMs: 1_800_000,
        startTimeMs: 0,
        completedAt: null,
        specSlug: "Demonology",
        roleSlug: "dps",
        rank: 1,
      },
      wclCharacterId: 999,
      wclCanonicalId: 888,
      playerActorId: 7,
      ownedPetActorIds: [20],
      fightStartTime: 10_000,
      fightEndTime: 1_810_000,
      keyLevel: 12,
      encounterId: 112526,
      encounterName: "Algeth'ar Academy",
      eventDatasets: datasets,
      catalog,
      classSlug: "warlock",
      specSlug: "demonology",
    });

    expect(normalized.run.playerActorId).toBe(7);
    expect(normalized.run.wclCharacterId).toBe(999);
    expect(normalized.run.durationMs).toBe(1_800_000);
    expect(normalized.deaths.playerDeathCount).toBe(1);
    expect(normalized.deaths.deaths[0]?.overkill).toBe(800);
    expect(normalized.damageTaken.totalDamageTaken).toBe(10_000);
    expect(normalized.damageTaken.totalAbsorbed).toBe(1500);
    expect(normalized.damageTaken.avoidableClassification).toBeNull();
    expect(normalized.damageTaken.events[0]?.additionalFields.customField).toBe("kept");
    expect(normalized.defensiveUsage.some((u) => u.canonicalKey.includes("unending-resolve"))).toBe(
      true,
    );
    expect(
      normalized.selfHealingAndConsumables.consumableAndSelfHealCasts.some(
        (u) => u.canonicalKey === "shared.consumable.healthstone",
      ),
    ).toBe(true);
    expect(normalized.selfHealingAndConsumables.healing[0]?.spellId).toBe(234153);
    expect(normalized.combatantInfo.itemLevel).toBe(669);
    expect(normalized.abilityCatalog.matchedSpellIds).toContain(104773);
  });
});
