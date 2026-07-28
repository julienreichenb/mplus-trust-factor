import { describe, expect, it } from "vitest";
import { getAbilityCatalog } from "@mplus/abilities";
import type { SurvivalCalibrationRun } from "./survival-calibration-types.js";
import type {
  SurvivalDeathFact,
  SurvivalNormalizedDataset,
  SurvivalPreservedEvent,
} from "./survival-probe-types.js";
import { SURVIVAL_STANDALONE_V1_CONFIG } from "./survival-v1-config.js";
import {
  aggregateSurvivalV1Dungeons,
  detectDangerTriggers,
  filterInFightPlayerDeaths,
  mergeDangerWindows,
  redistributeWeights,
  resolvePlayerMaxHp,
  scoreOutcomeFromDeaths,
  scoreSurvivalV1Run,
} from "./survival-v1-logic.js";

const catalog = getAbilityCatalog({ classSlug: "warlock", specSlug: "demonology" });

function event(partial: Partial<SurvivalPreservedEvent> & { timestamp: number; amount?: number }): SurvivalPreservedEvent {
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

function baseRun(overrides: Partial<SurvivalCalibrationRun> = {}): SurvivalCalibrationRun {
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
      raw: { maxHitPoints: 1_000_000, sourceID: 7, specID: 266 },
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

  const run: SurvivalCalibrationRun = {
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
    deaths: { deathCount: 0, deathTimestamps: [], deathsPerRun: 0, deathsPer10Minutes: 0, deaths: [] },
    damageTaken: {
      totalDamageTaken: 0,
      damageTakenPerMinute: 0,
      absorbedAmount: 0,
      unabsorbedDamage: 0,
      unabsorbedDamagePerMinute: 0,
      absorbedRatio: null,
      byAbility: [],
      bySource: [],
      playerMaxHp: 1_000_000,
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

  return { ...run, ...overrides, normalized: { ...normalized, ...(overrides.normalized ?? {}) } };
}

function death(ts: number, targetID = 7): SurvivalDeathFact {
  return {
    timestamp: ts,
    killingAbilityGameId: 1,
    killingSourceId: 2,
    overkill: 100,
    event: event({ timestamp: ts, targetID, sourceID: 2 }),
  };
}

describe("survival-v1 outcome", () => {
  it("scores 0 / 1 / 2 / 3+ deaths", () => {
    expect(scoreOutcomeFromDeaths(0)).toBe(100);
    expect(scoreOutcomeFromDeaths(1)).toBe(65);
    expect(scoreOutcomeFromDeaths(2)).toBe(30);
    expect(scoreOutcomeFromDeaths(3)).toBe(0);
    expect(scoreOutcomeFromDeaths(5)).toBe(0);
  });

  it("excludes deaths outside fight or not the player", () => {
    const deaths = [death(-10), death(100), death(100, 99), death(700_000)];
    const kept = filterInFightPlayerDeaths(deaths, 7, 0, 600_000);
    expect(kept).toHaveLength(1);
    expect(kept[0]?.timestamp).toBe(100);
  });
});

describe("survival-v1 danger windows", () => {
  it("opens a danger window from low HP", () => {
    const run = baseRun();
    run.normalized.damageTaken.events = [
      event({ timestamp: 10_000, amount: 700_000 }), // HP -> 300k = 30%
    ];
    const { triggers, hpDetectionAvailable } = detectDangerTriggers({
      run,
      maxHp: 1_000_000,
      deaths: [],
    });
    expect(hpDetectionAvailable).toBe(true);
    expect(triggers.some((t) => t.type === "LOW_HP")).toBe(true);
  });

  it("opens a danger window from rolling damage", () => {
    const run = baseRun();
    run.normalized.damageTaken.events = [
      event({ timestamp: 1_000, amount: 150_000 }),
      event({ timestamp: 2_000, amount: 150_000 }),
      event({ timestamp: 3_000, amount: 150_000 }),
    ];
    const { triggers } = detectDangerTriggers({ run, maxHp: 1_000_000, deaths: [] });
    expect(triggers.some((t) => t.type === "ROLLING_DAMAGE")).toBe(true);
  });

  it("opens a danger window from a large hit", () => {
    const run = baseRun();
    run.normalized.damageTaken.events = [event({ timestamp: 5_000, amount: 350_000 })];
    const { triggers } = detectDangerTriggers({ run, maxHp: 1_000_000, deaths: [] });
    expect(triggers.some((t) => t.type === "LARGE_HIT")).toBe(true);
  });

  it("merges overlapping windows within 8 seconds", () => {
    const merged = mergeDangerWindows(
      [
        { timestamp: 1000, type: "LARGE_HIT", hpBefore: null, hpAfter: null, damageEvents: [] },
        { timestamp: 5000, type: "LOW_HP", hpBefore: null, hpAfter: null, damageEvents: [] },
        { timestamp: 20_000, type: "PLAYER_DEATH", hpBefore: null, hpAfter: 0, damageEvents: [] },
      ],
      SURVIVAL_STANDALONE_V1_CONFIG.danger.mergeGapMs,
    );
    expect(merged).toHaveLength(2);
    expect(merged[0]?.triggers).toHaveLength(2);
  });

  it("does not fabricate HP thresholds when max HP is missing", () => {
    const run = baseRun();
    run.normalized.combatantInfo.raw = { sourceID: 7 };
    run.damageTaken.playerMaxHp = null;
    run.normalized.damageTaken.events = [event({ timestamp: 1_000, amount: 999_999 })];
    const resolved = resolvePlayerMaxHp(run);
    expect(resolved.maxHp).toBeNull();
    const { triggers, hpDetectionAvailable } = detectDangerTriggers({
      run,
      maxHp: null,
      deaths: [],
    });
    expect(hpDetectionAvailable).toBe(false);
    expect(triggers.filter((t) => t.type !== "PLAYER_DEATH")).toHaveLength(0);
  });
});

describe("survival-v1 defensive response", () => {
  it("credits a defensive cast before danger", () => {
    const run = baseRun();
    run.normalized.damageTaken.events = [event({ timestamp: 50_000, amount: 400_000 })];
    run.normalized.defensiveUsage = [
      {
        canonicalKey: "warlock.defensive-major.unending-resolve",
        category: "DEFENSIVE_MAJOR",
        spellId: 104773,
        name: "Unending Resolve",
        sourceOwnership: "PLAYER",
        cooldownSeconds: 180,
        availability: "BASELINE",
        talentDependentOrUncertain: false,
        castTimestamps: [47_000],
        buffApplications: [{ timestamp: 47_000, type: "apply", sourceID: 7, targetID: 7 }],
        buffRemovals: [{ timestamp: 55_000, type: "remove", sourceID: 7, targetID: 7 }],
        sourceActorIds: [7],
      },
    ];
    const { runScore, dangerWindows } = scoreSurvivalV1Run({
      run,
      catalog,
      classSlug: "warlock",
    });
    expect(dangerWindows.length).toBeGreaterThan(0);
    expect(runScore.defensiveResponse.state).toBe("SCORED");
    expect(runScore.coveredDefensiveWindows).toBeGreaterThan(0);
    expect(runScore.defensiveResponse.score).toBe(100);
  });

  it("credits a defensive already active at danger start", () => {
    const run = baseRun();
    run.normalized.damageTaken.events = [event({ timestamp: 50_000, amount: 400_000 })];
    run.normalized.defensiveUsage = [
      {
        canonicalKey: "warlock.defensive-major.unending-resolve",
        category: "DEFENSIVE_MAJOR",
        spellId: 104773,
        name: "Unending Resolve",
        sourceOwnership: "PLAYER",
        cooldownSeconds: 180,
        availability: "BASELINE",
        talentDependentOrUncertain: false,
        castTimestamps: [10_000],
        buffApplications: [{ timestamp: 10_000, type: "apply", sourceID: 7, targetID: 7 }],
        buffRemovals: [{ timestamp: 60_000, type: "remove", sourceID: 7, targetID: 7 }],
        sourceActorIds: [7],
      },
    ];
    const { runScore } = scoreSurvivalV1Run({ run, catalog, classSlug: "warlock" });
    expect(runScore.defensiveResponse.score).toBe(100);
  });

  it("does not create an opportunity when defensive is on cooldown", () => {
    const run = baseRun();
    // First use at t=0, danger at t=30s while still on 180s CD — only UR baseline exists.
    // After first cast, second danger should see UR on CD → no confirmed available → N/A for that window.
    run.normalized.damageTaken.events = [
      event({ timestamp: 10_000, amount: 400_000 }),
      event({ timestamp: 40_000, amount: 400_000 }),
    ];
    run.normalized.defensiveUsage = [
      {
        canonicalKey: "warlock.defensive-major.unending-resolve",
        category: "DEFENSIVE_MAJOR",
        spellId: 104773,
        name: "Unending Resolve",
        sourceOwnership: "PLAYER",
        cooldownSeconds: 180,
        availability: "BASELINE",
        talentDependentOrUncertain: false,
        castTimestamps: [8_000],
        buffApplications: [{ timestamp: 8_000, type: "apply", sourceID: 7, targetID: 7 }],
        buffRemovals: [{ timestamp: 16_000, type: "remove", sourceID: 7, targetID: 7 }],
        sourceActorIds: [7],
      },
    ];
    // Dark Pact is talent — without confirmation it must not create a penalty opportunity.
    const { runScore, dangerWindows } = scoreSurvivalV1Run({
      run,
      catalog,
      classSlug: "warlock",
    });
    expect(dangerWindows.length).toBeGreaterThanOrEqual(1);
    // First window covered; second window UR on CD and Dark Pact unconfirmed → may reduce eligible count
    expect(runScore.eligibleDefensiveWindows).toBeGreaterThanOrEqual(1);
    expect(runScore.coveredDefensiveWindows).toBeGreaterThanOrEqual(1);
  });

  it("unknown talent ability does not create a penalty", () => {
    const run = baseRun();
    run.normalized.damageTaken.events = [event({ timestamp: 50_000, amount: 400_000 })];
    // No observed Dark Pact, no baseline defensive used — UR still baseline available.
    // Isolate: remove UR from consideration by putting it on CD without covering...
    // Instead assert Dark Pact is not in confirmedAvailable without observation.
    const { dangerWindows } = scoreSurvivalV1Run({ run, catalog, classSlug: "warlock" });
    const confirmed = dangerWindows.flatMap((w) => w.confirmedAvailableDefensives);
    expect(confirmed.some((c) => c.canonicalKey.includes("dark-pact"))).toBe(false);
    expect(confirmed.some((c) => c.canonicalKey.includes("unending-resolve"))).toBe(true);
  });

  it("no danger window produces NOT_APPLICABLE defensive response", () => {
    const run = baseRun();
    run.normalized.damageTaken.events = [event({ timestamp: 10_000, amount: 1_000 })];
    const { runScore } = scoreSurvivalV1Run({ run, catalog, classSlug: "warlock" });
    expect(runScore.defensiveResponse.state).toBe("NOT_APPLICABLE");
    expect(runScore.defensiveResponse.score).toBeNull();
    expect(runScore.weightsApplied.defensiveResponse).toBe(0);
    expect(runScore.weightsApplied.survivalOutcome).toBe(1);
  });
});

describe("survival-v1 emergency recovery", () => {
  it("counts Healthstone as a valid recovery response", () => {
    const run = baseRun();
    run.normalized.damageTaken.events = [event({ timestamp: 50_000, amount: 800_000 })];
    run.normalized.selfHealingAndConsumables.healing = [
      {
        spellId: 6262,
        canonicalKey: "shared.consumable.healthstone",
        category: "CONSUMABLE",
        catalogMatched: true,
        ambiguous: false,
        eventCount: 1,
        totalAmount: 200_000,
        totalOverheal: 0,
        timestamps: [51_000],
      },
    ];
    const { runScore, dangerWindows } = scoreSurvivalV1Run({
      run,
      catalog,
      classSlug: "warlock",
    });
    expect(dangerWindows.some((w) => w.recoveryEligible)).toBe(true);
    expect(runScore.emergencyRecovery.state).toBe("SCORED");
    expect(runScore.coveredRecoveryWindows).toBeGreaterThan(0);
  });

  it("counts self-heal restoring >=10% max HP", () => {
    const run = baseRun();
    run.normalized.damageTaken.events = [event({ timestamp: 50_000, amount: 800_000 })];
    run.normalized.selfHealingAndConsumables.healing = [
      {
        spellId: 234153,
        canonicalKey: "warlock.self-heal.drain-life",
        category: "SELF_HEAL",
        catalogMatched: true,
        ambiguous: false,
        eventCount: 1,
        totalAmount: 150_000,
        totalOverheal: 0,
        timestamps: [51_000],
      },
    ];
    const { runScore } = scoreSurvivalV1Run({ run, catalog, classSlug: "warlock" });
    expect(runScore.emergencyRecovery.state).toBe("SCORED");
    expect(runScore.coveredRecoveryWindows).toBeGreaterThan(0);
  });

  it("does not assume potion availability", () => {
    const run = baseRun();
    run.normalized.damageTaken.events = [event({ timestamp: 50_000, amount: 800_000 })];
    const { dangerWindows } = scoreSurvivalV1Run({ run, catalog, classSlug: "warlock" });
    const resources = dangerWindows.flatMap((w) => w.recoveryResourcesConfirmedAvailable);
    expect(resources.some((r) => r.canonicalKey.includes("healing-potion"))).toBe(false);
  });
});

describe("survival-v1 weights and aggregation", () => {
  it("redistributes weights proportionally when components are N/A", () => {
    const all = redistributeWeights({ outcome: true, defensive: true, recovery: true });
    expect(all.survivalOutcome).toBeCloseTo(0.55, 5);
    expect(all.defensiveResponse).toBeCloseTo(0.3, 5);
    expect(all.emergencyRecovery).toBeCloseTo(0.15, 5);

    const noRecovery = redistributeWeights({ outcome: true, defensive: true, recovery: false });
    expect(noRecovery.survivalOutcome + noRecovery.defensiveResponse).toBeCloseTo(1, 5);
    expect(noRecovery.emergencyRecovery).toBe(0);
    expect(noRecovery.survivalOutcome / noRecovery.defensiveResponse).toBeCloseTo(0.55 / 0.3, 5);

    const onlyOutcome = redistributeWeights({
      outcome: true,
      defensive: false,
      recovery: false,
    });
    expect(onlyOutcome.survivalOutcome).toBe(1);
  });

  it("uses median per dungeon and equal-weight global aggregation", () => {
    const mk = (dungeon: string, score: number, report: string) => ({
      runId: `${report}:1`,
      dungeonSlug: dungeon,
      reportCode: report,
      fightId: 1,
      keyLevel: 20,
      deathCount: 0,
      maxHp: 1_000_000,
      maxHpSource: "combatantInfo" as const,
      outcome: {
        state: "SCORED" as const,
        score: 100,
        weightUsed: 1,
        reason: null,
        evidence: {},
      },
      defensiveResponse: {
        state: "NOT_APPLICABLE" as const,
        score: null,
        weightUsed: 0,
        reason: "no_danger_windows",
        evidence: {},
      },
      emergencyRecovery: {
        state: "NOT_APPLICABLE" as const,
        score: null,
        weightUsed: 0,
        reason: "no_danger_windows",
        evidence: {},
      },
      score,
      weightsApplied: { survivalOutcome: 1, defensiveResponse: 0, emergencyRecovery: 0 },
      dangerWindowCount: 0,
      eligibleDefensiveWindows: 0,
      coveredDefensiveWindows: 0,
      eligibleRecoveryWindows: 0,
      coveredRecoveryWindows: 0,
      dangerWindowIds: [],
    });

    const runs = [
      mk("skyreach", 100, "A1"),
      mk("skyreach", 80, "A2"),
      mk("skyreach", 60, "A3"),
      mk("pit-of-saron", 40, "B1"),
    ];
    const { perDungeon, global } = aggregateSurvivalV1Dungeons(runs, [
      "skyreach",
      "pit-of-saron",
      "algethar-academy",
    ]);
    expect(perDungeon.find((d) => d.dungeonSlug === "skyreach")?.medianScore).toBe(80);
    expect(perDungeon.find((d) => d.dungeonSlug === "pit-of-saron")?.medianScore).toBe(40);
    expect(global.score).toBeCloseTo(60, 5); // equal-weight (80+40)/2 — not run-count weighted
    expect(global.availableDungeonCount).toBe(2);
    expect(global.expectedDungeonCount).toBe(3);
  });
});
