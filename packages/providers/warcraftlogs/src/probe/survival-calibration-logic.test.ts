import { describe, expect, it } from "vitest";
import { getAbilityCatalog } from "@mplus/abilities";
import { normalizeSurvivalDataset } from "./survival-probe-logic.js";
import { SURVIVAL_EVENT_TYPES } from "./survival-probe-types.js";
import type { SurvivalRawEventDataset } from "./survival-probe-types.js";
import {
  aggregateDungeonCalibration,
  buildGlobalCalibrationSummary,
  computeBuffActiveDurationMs,
  enrichSurvivalCalibrationRun,
  equalWeightMean,
  median,
  theoreticalMaxUses,
} from "./survival-calibration-logic.js";

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
    pages: [],
    graphqlErrors: [],
    note: null,
  };
}

describe("survival-calibration-logic", () => {
  it("computes median and equal-weight means", () => {
    expect(median([1, 3, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(equalWeightMean([10, null, 20])).toBe(15);
  });

  it("computes theoretical max uses and buff active duration", () => {
    expect(theoreticalMaxUses(180_000, 60)).toBe(4);
    expect(theoreticalMaxUses(180_000, null)).toBeNull();
    expect(
      computeBuffActiveDurationMs(
        [{ timestamp: 1000 }, { timestamp: 5000 }],
        [{ timestamp: 2000 }, { timestamp: 7000 }],
        10_000,
      ),
    ).toBe(3000);
  });

  it("enriches a normalized run with calibration rates", () => {
    const catalog = getAbilityCatalog({ classSlug: "warlock", specSlug: "demonology" });
    const datasets = Object.fromEntries(
      SURVIVAL_EVENT_TYPES.map((t) => [t, emptyDataset(t)]),
    ) as Record<(typeof SURVIVAL_EVENT_TYPES)[number], SurvivalRawEventDataset>;

    datasets.DamageTaken = emptyDataset("DamageTaken", [
      {
        timestamp: 40_000,
        sourceID: 100,
        targetID: 7,
        abilityGameID: 222,
        amount: 10_000,
        absorbed: 2500,
      },
    ]);
    datasets.Casts = emptyDataset("Casts", [
      { timestamp: 30_000, sourceID: 7, targetID: 7, abilityGameID: 104773 },
      { timestamp: 31_000, sourceID: 7, targetID: 7, abilityGameID: 6262 },
    ]);
    datasets.Buffs = emptyDataset("Buffs", [
      { timestamp: 30_000, type: "apply", sourceID: 7, targetID: 7, abilityGameID: 104773 },
      { timestamp: 60_000, type: "remove", sourceID: 7, targetID: 7, abilityGameID: 104773 },
    ]);
    datasets.Healing = emptyDataset("Healing", [
      {
        timestamp: 32_000,
        sourceID: 7,
        targetID: 7,
        abilityGameID: 234153,
        amount: 2000,
        overheal: 0,
      },
    ]);
    datasets.CombatantInfo = emptyDataset("CombatantInfo", [
      { sourceID: 7, specID: 266, maxHitPoints: 500_000, gear: [{ itemLevel: 670 }] },
    ]);

    const normalized = normalizeSurvivalDataset({
      identity: { region: "EU", realmSlug: "archimonde", name: "Wallidrixe" },
      probedAt: "2026-07-28T00:00:00.000Z",
      candidate: {
        reportCode: "Abc",
        fightId: 1,
        encounterId: 12811,
        dungeonSlug: "magisters-terrace",
        keyLevel: 20,
        score: 500,
        durationMs: 1_800_000,
        startTimeMs: 0,
        completedAt: null,
        specSlug: "Demonology",
        roleSlug: "dps",
        rank: 1,
      },
      wclCharacterId: 1,
      wclCanonicalId: 1,
      playerActorId: 7,
      ownedPetActorIds: [],
      fightStartTime: 0,
      fightEndTime: 1_800_000,
      keyLevel: 20,
      encounterId: 12811,
      encounterName: "Magisters' Terrace",
      eventDatasets: datasets,
      catalog,
      classSlug: "warlock",
      specSlug: "demonology",
    });

    const run = enrichSurvivalCalibrationRun({
      normalized,
      timed: null,
      depleted: null,
      completed: true,
      score: 500,
      missingDatasets: [],
    });

    expect(run.damageTaken.damageTakenPerMinute).toBeCloseTo(10_000 / 30, 5);
    expect(run.damageTaken.absorbedRatio).toBeCloseTo(2500 / 12_500, 5);
    expect(run.damageTaken.playerMaxHp).toBe(500_000);
    expect(run.damageTaken.damageNormalizedByMaxHp).toBeCloseTo(10_000 / 500_000, 8);
    expect(run.damageTaken.avoidableClassification).toBeNull();
    expect(run.consumablesAndSelfHealing.healthstoneUses).toBeGreaterThanOrEqual(1);
    expect(run.defensives[0]?.theoreticalMaxUses).toBe(
      theoreticalMaxUses(1_800_000, run.defensives[0]!.cooldownSeconds),
    );
    expect(run.defensives[0]?.note).toContain("not a valid opportunity score");
  });

  it("aggregates per dungeon with equal-weight global means (not run-count weighted)", () => {
    const catalog = getAbilityCatalog({ classSlug: "warlock", specSlug: "demonology" });
    const mk = (dungeon: string, dpm: number, deathsPer10: number, report: string) => {
      const datasets = Object.fromEntries(
        SURVIVAL_EVENT_TYPES.map((t) => [t, emptyDataset(t)]),
      ) as Record<(typeof SURVIVAL_EVENT_TYPES)[number], SurvivalRawEventDataset>;
      const durationMs = 600_000;
      datasets.DamageTaken = emptyDataset("DamageTaken", [
        {
          timestamp: 1,
          sourceID: 1,
          targetID: 7,
          abilityGameID: 1,
          amount: dpm * (durationMs / 60_000),
          absorbed: 0,
        },
      ]);
      const deathCount = Math.round(deathsPer10 * (durationMs / 600_000));
      datasets.Deaths = emptyDataset(
        "Deaths",
        Array.from({ length: deathCount }, (_, i) => ({
          timestamp: i * 1000,
          sourceID: 1,
          targetID: 7,
          abilityGameID: 9,
        })),
      );
      const normalized = normalizeSurvivalDataset({
        identity: { region: "EU", realmSlug: "archimonde", name: "Wallidrixe" },
        probedAt: "2026-07-28T00:00:00.000Z",
        candidate: {
          reportCode: report,
          fightId: 1,
          encounterId: 1,
          dungeonSlug: dungeon,
          keyLevel: 10,
          score: 1,
          durationMs,
          startTimeMs: 0,
          completedAt: null,
          specSlug: "demonology",
          roleSlug: "dps",
          rank: 1,
        },
        wclCharacterId: 1,
        wclCanonicalId: 1,
        playerActorId: 7,
        ownedPetActorIds: [],
        fightStartTime: 0,
        fightEndTime: durationMs,
        keyLevel: 10,
        encounterId: 1,
        encounterName: dungeon,
        eventDatasets: datasets,
        catalog,
        classSlug: "warlock",
        specSlug: "demonology",
      });
      return enrichSurvivalCalibrationRun({
        normalized,
        timed: null,
        depleted: null,
        completed: true,
        score: 1,
        missingDatasets: [],
      });
    };

    // Dungeon A: 3 runs with high DPM; dungeon B: 1 run with low DPM.
    // Equal-weight average of dungeon medians must not be pulled toward A by run count.
    const a1 = mk("skyreach", 100, 0, "A1");
    const a2 = mk("skyreach", 100, 0, "A2");
    const a3 = mk("skyreach", 100, 0, "A3");
    const b1 = mk("pit-of-saron", 10, 2, "B1");

    const perDungeon = [
      aggregateDungeonCalibration("skyreach", [a1, a2, a3]),
      aggregateDungeonCalibration("pit-of-saron", [b1]),
      aggregateDungeonCalibration("algethar-academy", []),
    ];
    const global = buildGlobalCalibrationSummary(perDungeon, [
      "skyreach",
      "pit-of-saron",
      "algethar-academy",
    ]);

    expect(perDungeon[0]?.runCount).toBe(3);
    expect(perDungeon[0]?.damageTakenPerMinuteMedian).toBeCloseTo(100, 5);
    expect(perDungeon[1]?.deathRateMedian).toBeCloseTo(2, 5);
    expect(global.equalWeightAverages.damageTakenPerMinuteMedian).toBeCloseTo(55, 5);
    expect(global.coverage.dungeonsMissingRuns).toEqual(["algethar-academy"]);
    expect(global.coverage.sampleSizeByDungeon.skyreach).toBe(3);
  });
});
