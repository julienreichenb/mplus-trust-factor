import { describe, expect, it } from "vitest";
import { getAbilityCatalog } from "@mplus/abilities";
import type { SurvivalCalibrationRun } from "./survival-calibration-types.js";
import type {
  SurvivalNormalizedDataset,
  SurvivalPreservedEvent,
} from "./survival-probe-types.js";
import { scoreSurvivalV1_1Run } from "./survival-v1_1-logic.js";
import type { MaxHpResolution } from "./survival-v1_1-types.js";
import { buildTimelineForRun } from "./survival-v1_1-logic.js";

const catalog = getAbilityCatalog({ classSlug: "warlock", specSlug: "demonology" });

function event(
  partial: Partial<SurvivalPreservedEvent> & { timestamp: number; amount?: number },
): SurvivalPreservedEvent {
  return {
    timestamp: partial.timestamp,
    sourceID: partial.sourceID ?? 1,
    targetID: partial.targetID ?? 7,
    abilityGameID: partial.abilityGameID ?? 100,
    amount: partial.amount ?? 0,
    absorbed: partial.absorbed ?? 0,
    overkill: partial.overkill ?? null,
    hitType: partial.hitType ?? 1,
    additionalFields: partial.additionalFields ?? {},
    raw: partial.raw ?? {},
  };
}

function baseRun(): SurvivalCalibrationRun {
  const normalized: SurvivalNormalizedDataset = {
    probeVersion: "1",
    probedAt: "2026-07-28T00:00:00.000Z",
    identity: { region: "EU", realmSlug: "archimonde", name: "Wallidrixe" },
    run: {
      dungeonSlug: "skyreach",
      reportCode: "TestRep",
      fightId: 1,
      playerActorId: 7,
      ownedPetActorIds: [],
      startTime: 0,
      endTime: 600_000,
      durationMs: 600_000,
      keyLevel: 20,
      encounterId: 1,
      encounterName: "Skyreach",
      wclCharacterId: 1,
      wclCanonicalId: 1,
    },
    deaths: { playerDeathCount: 0, deathTimestamps: [], deaths: [] },
    damageTaken: {
      totalDamageTaken: 0,
      totalAbsorbed: 0,
      byAbility: [],
      bySource: [],
      events: [],
      avoidableClassification: null,
    },
    defensiveUsage: [],
    selfHealingAndConsumables: { healing: [], consumableAndSelfHealCasts: [] },
    combatantInfo: {
      specialization: "demonology",
      specId: 266,
      talents: null,
      gear: null,
      itemLevel: null,
      raw: { sourceID: 7, specID: 266 },
    },
    abilityCatalog: {
      catalogVersion: "test",
      classSlug: "warlock",
      specSlug: "demonology",
      supported: true,
      matchedSpellIds: [],
      unmatchedSpellIds: [],
      ambiguousSpellIds: [],
    },
  };

  return {
    runId: "TestRep:1",
    dungeonSlug: "skyreach",
    reportCode: "TestRep",
    fightId: 1,
    keyLevel: 20,
    timed: null,
    depleted: null,
    completed: true,
    durationMs: 600_000,
    playerActorId: 7,
    ownedPetActorIds: [],
    specialization: "demonology",
    specId: 266,
    itemLevel: null,
    score: null,
    encounterId: 1,
    encounterName: "Skyreach",
    deaths: {
      deathCount: 0,
      deathTimestamps: [],
      deathsPerRun: 0,
      deathsPer10Minutes: 0,
      deaths: [],
    },
    damageTaken: {
      totalDamageTaken: 0,
      damageTakenPerMinute: 0,
      absorbedAmount: 0,
      unabsorbedDamage: 0,
      unabsorbedDamagePerMinute: 0,
      absorbedRatio: null,
      byAbility: [],
      bySource: [],
      playerMaxHp: null,
      damageNormalizedByMaxHp: null,
      avoidableClassification: null,
    },
    defensives: [],
    consumablesAndSelfHealing: {
      healthstoneUses: 0,
      healingPotionUses: 0,
      selfHealingAmount: 0,
      selfHealingPerMinute: null,
      selfHealingPercentOfIncomingDamage: null,
      healingBySpell: [],
      matchedCasts: [],
    },
    normalized,
    missingDatasets: [],
    unmatchedSpellIds: [],
    ambiguousSpellIds: [],
  };
}

function maxHpRes(maxHp: number | null): MaxHpResolution {
  return {
    runId: "TestRep:1",
    reportCode: "TestRep",
    fightId: 1,
    dungeonSlug: "skyreach",
    maxHp,
    maxHpSource: maxHp != null ? "DamageTaken" : null,
    maxHpConfidence: maxHp != null ? "HIGH" : "NONE",
    sourcePayloadPath: maxHp != null ? "DamageTaken.event.targetResources" : null,
    corroboratingEventCount: maxHp != null ? 10 : 0,
    allObservedMaxHpValues: maxHp != null ? [maxHp] : [],
    modalStableValue: maxHp,
    temporaryMaxHpValues: [],
    conflictingValues: [],
    resolutionFailureReason: maxHp == null ? "none" : null,
  };
}

describe("survival-v1.1 reaction windows", () => {
  it("marks death-only windows as recovery NOT_APPLICABLE", () => {
    const run = baseRun();
    run.deaths.deaths = [
      {
        timestamp: 50_000,
        killingAbilityGameId: 1,
        killingSourceId: 1,
        overkill: null,
        event: {
          timestamp: 50_000,
          sourceID: 1,
          targetID: 7,
          abilityGameID: 1,
          amount: 0,
          absorbed: 0,
          overkill: null,
          hitType: 1,
          additionalFields: {},
          raw: {},
        },
      },
    ];
    run.deaths.deathCount = 1;
    run.deaths.deathTimestamps = [50_000];
    run.normalized.deaths.deaths = run.deaths.deaths;
    run.normalized.deaths.playerDeathCount = 1;
    run.normalized.deaths.deathTimestamps = [50_000];
    const { dangerWindows, runScore } = scoreSurvivalV1_1Run({
      run,
      catalog,
      classSlug: "warlock",
      maxHpResolution: maxHpRes(null),
      healthTimeline: null,
      eventPagesComplete: false,
    });
    expect(dangerWindows[0]?.windowClass).toBe("DEATH_ONLY_HEALTH_CONTEXT_UNAVAILABLE");
    expect(dangerWindows[0]?.recoveryCoverageKind).toBe(
      "death_only_health_context_unavailable",
    );
    expect(runScore.emergencyRecovery.state).toBe("NOT_APPLICABLE");
  });

  it("rejects defensive miss when death is faster than 1.5s reaction interval", () => {
    const run = baseRun();
    run.normalized.damageTaken.events = [event({ timestamp: 50_000, amount: 800_000 })];
    run.deaths.deaths = [
      {
        timestamp: 50_800,
        killingAbilityGameId: 1,
        killingSourceId: 1,
        overkill: null,
        event: {
          timestamp: 50_800,
          sourceID: 1,
          targetID: 7,
          abilityGameID: 1,
          amount: 0,
          absorbed: 0,
          overkill: null,
          hitType: 1,
          additionalFields: {},
          raw: {},
        },
      },
    ];
    run.deaths.deathCount = 1;
    run.deaths.deathTimestamps = [50_800];
    run.normalized.deaths.deaths = run.deaths.deaths;
    run.normalized.deaths.playerDeathCount = 1;
    run.normalized.deaths.deathTimestamps = [50_800];
    const snapshots = [
      {
        timestamp: 50_000,
        currentHp: 200_000,
        maxHp: 1_000_000,
        absorb: null,
        path: "DamageTaken.event.targetResources",
        dataType: "DamageTaken",
        abilityGameID: 100,
        sourceID: 1,
        targetID: 7,
        eventType: "damage",
        rawFragment: {},
      },
    ];
    const timeline = buildTimelineForRun(run, 1_000_000, snapshots, true);
    const { dangerWindows } = scoreSurvivalV1_1Run({
      run,
      catalog,
      classSlug: "warlock",
      maxHpResolution: maxHpRes(1_000_000),
      healthTimeline: timeline,
      eventPagesComplete: true,
    });
    const fatal = dangerWindows.find((w) => w.deathOutcome);
    expect(fatal).toBeTruthy();
    expect(fatal!.reactionEligible).toBe(false);
    expect(fatal!.reactionIneligibilityReason).toBe("insufficient_reaction_time");
  });

  it("opens a non-fatal low-HP window from explicit health snapshots", () => {
    const run = baseRun();
    run.normalized.damageTaken.events = [event({ timestamp: 50_000, amount: 700_000 })];
    const snapshots = [
      {
        timestamp: 0,
        currentHp: 1_000_000,
        maxHp: 1_000_000,
        absorb: null,
        path: "DamageTaken.event.targetResources",
        dataType: "DamageTaken",
        abilityGameID: null,
        sourceID: 1,
        targetID: 7,
        eventType: "damage",
        rawFragment: {},
      },
      {
        timestamp: 50_000,
        currentHp: 300_000,
        maxHp: 1_000_000,
        absorb: null,
        path: "DamageTaken.event.targetResources",
        dataType: "DamageTaken",
        abilityGameID: 100,
        sourceID: 1,
        targetID: 7,
        eventType: "damage",
        rawFragment: {},
      },
    ];
    const timeline = buildTimelineForRun(run, 1_000_000, snapshots, true);
    const { dangerWindows, runScore } = scoreSurvivalV1_1Run({
      run,
      catalog,
      classSlug: "warlock",
      maxHpResolution: maxHpRes(1_000_000),
      healthTimeline: timeline,
      eventPagesComplete: true,
    });
    expect(dangerWindows.some((w) => w.windowClass === "NON_FATAL_PRESSURE")).toBe(true);
    expect(runScore.nonFatalWindowCount).toBeGreaterThan(0);
  });
});
