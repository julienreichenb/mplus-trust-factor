import { describe, expect, it } from "vitest";
import { getAbilityCatalog } from "@mplus/abilities";
import type { SurvivalCalibrationRun } from "./survival-calibration-types.js";
import type {
  SurvivalNormalizedDataset,
  SurvivalPreservedEvent,
} from "./survival-probe-types.js";
import { buildTimelineForRun, scoreSurvivalV1_1Run } from "./survival-v1_1-logic.js";
import type { MaxHpResolution } from "./survival-v1_1-types.js";
import {
  auditFragmentationPairs,
  auditRecoveryDetection,
  clusterWindowsByCandidateRule,
} from "./survival-v1_1-audit.js";
import type { SurvivalV1_1DangerWindowAudit } from "./survival-v1_1-types.js";

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
}

function maxHpRes(): MaxHpResolution {
  return {
    runId: "TestRep:1",
    reportCode: "TestRep",
    fightId: 1,
    dungeonSlug: "skyreach",
    maxHp: 1_000_000,
    maxHpSource: "DamageTaken",
    maxHpConfidence: "HIGH",
    sourcePayloadPath: "DamageTaken.event",
    corroboratingEventCount: 10,
    allObservedMaxHpValues: [1_000_000],
    modalStableValue: 1_000_000,
    temporaryMaxHpValues: [],
    conflictingValues: [],
    resolutionFailureReason: null,
  };
}

function snapshotsAt(ts: number, hp: number) {
  return [
    {
      timestamp: 0,
      currentHp: 1_000_000,
      maxHp: 1_000_000,
      absorb: null,
      path: "x",
      dataType: "DamageTaken",
      abilityGameID: null,
      sourceID: 1,
      targetID: 7,
      eventType: "damage",
      rawFragment: {},
    },
    {
      timestamp: ts,
      currentHp: hp,
      maxHp: 1_000_000,
      absorb: null,
      path: "x",
      dataType: "DamageTaken",
      abilityGameID: 100,
      sourceID: 1,
      targetID: 7,
      eventType: "damage",
      rawFragment: {},
    },
  ];
}

describe("survival-v1.1 recovery fixture detection", () => {
  it("detects Healthstone use during a low-HP danger window", () => {
    const run = baseRun();
    run.normalized.damageTaken.events = [event({ timestamp: 50_000, amount: 700_000 })];
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
    const timeline = buildTimelineForRun(run, 1_000_000, snapshotsAt(50_000, 300_000), true);
    const { dangerWindows } = scoreSurvivalV1_1Run({
      run,
      catalog,
      classSlug: "warlock",
      maxHpResolution: maxHpRes(),
      healthTimeline: timeline,
      eventPagesComplete: true,
    });
    const eligible = dangerWindows.filter((w) => w.recoveryCoverageKind === "covered");
    expect(eligible.length).toBeGreaterThan(0);
    expect(eligible[0]?.recoveryActionsDetected.some((a) => a.kind === "healthstone")).toBe(true);
  });

  it("detects healing potion use when potion was observed", () => {
    const run = baseRun();
    run.normalized.damageTaken.events = [event({ timestamp: 50_000, amount: 700_000 })];
    run.normalized.selfHealingAndConsumables.healing = [
      {
        spellId: 431416,
        canonicalKey: "shared.consumable.healing-potion",
        category: "CONSUMABLE",
        catalogMatched: true,
        ambiguous: false,
        eventCount: 1,
        totalAmount: 250_000,
        totalOverheal: 0,
        timestamps: [51_000],
      },
    ];
    // Potion must be observed for availability — presence in healing proves use.
    run.consumablesAndSelfHealing.matchedCasts = [
      {
        canonicalKey: "shared.consumable.healing-potion",
        category: "CONSUMABLE",
        spellId: 431416,
        name: "Healing Potion",
        sourceOwnership: "PLAYER",
        cooldownSeconds: null,
        availability: "SHARED",
        talentDependentOrUncertain: false,
        castTimestamps: [51_000],
        buffApplications: [],
        buffRemovals: [],
        sourceActorIds: [7],
      },
    ];
    const timeline = buildTimelineForRun(run, 1_000_000, snapshotsAt(50_000, 300_000), true);
    const { dangerWindows } = scoreSurvivalV1_1Run({
      run,
      catalog,
      classSlug: "warlock",
      maxHpResolution: maxHpRes(),
      healthTimeline: timeline,
      eventPagesComplete: true,
    });
    expect(
      dangerWindows.some((w) =>
        w.recoveryActionsDetected.some((a) => a.kind === "healing_potion"),
      ),
    ).toBe(true);
  });

  it("detects Drain Life self-heal restoring >=10% max HP", () => {
    const run = baseRun();
    run.normalized.damageTaken.events = [event({ timestamp: 50_000, amount: 700_000 })];
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
    const timeline = buildTimelineForRun(run, 1_000_000, snapshotsAt(50_000, 300_000), true);
    const { dangerWindows } = scoreSurvivalV1_1Run({
      run,
      catalog,
      classSlug: "warlock",
      maxHpResolution: maxHpRes(),
      healthTimeline: timeline,
      eventPagesComplete: true,
    });
    expect(
      dangerWindows.some((w) => w.recoveryActionsDetected.some((a) => a.kind === "self_heal")),
    ).toBe(true);
  });

  it("detects self-heal during the reaction interval after danger onset", () => {
    const run = baseRun();
    run.normalized.damageTaken.events = [event({ timestamp: 50_000, amount: 700_000 })];
    run.normalized.selfHealingAndConsumables.healing = [
      {
        spellId: 234153,
        canonicalKey: "warlock.self-heal.drain-life",
        category: "SELF_HEAL",
        catalogMatched: true,
        ambiguous: false,
        eventCount: 1,
        totalAmount: 120_000,
        totalOverheal: 0,
        timestamps: [52_500],
      },
    ];
    const timeline = buildTimelineForRun(run, 1_000_000, snapshotsAt(50_000, 300_000), true);
    const { dangerWindows } = scoreSurvivalV1_1Run({
      run,
      catalog,
      classSlug: "warlock",
      maxHpResolution: maxHpRes(),
      healthTimeline: timeline,
      eventPagesComplete: true,
    });
    expect(dangerWindows.some((w) => w.recoveryCoverageKind === "covered")).toBe(true);
  });

  it("does not treat Healthstone cast before the danger threshold as covering a later miss by itself without being in window", () => {
    const run = baseRun();
    run.normalized.damageTaken.events = [event({ timestamp: 50_000, amount: 700_000 })];
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
        timestamps: [10_000],
      },
    ];
    const timeline = buildTimelineForRun(run, 1_000_000, snapshotsAt(50_000, 300_000), true);
    const { dangerWindows } = scoreSurvivalV1_1Run({
      run,
      catalog,
      classSlug: "warlock",
      maxHpResolution: maxHpRes(),
      healthTimeline: timeline,
      eventPagesComplete: true,
    });
    // Early stone is outside window — still eligible miss if no in-window recovery
    expect(dangerWindows.some((w) => w.recoveryCoverageKind === "eligible_miss")).toBe(true);
  });
});

describe("survival-v1.1 audit clustering", () => {
  function stubWindow(
    id: string,
    start: number,
    end: number,
  ): SurvivalV1_1DangerWindowAudit {
    return {
      windowId: `TestRep:1#${id}`,
      reportCode: "TestRep",
      fightId: 1,
      dungeonSlug: "skyreach",
      windowClass: "NON_FATAL_PRESSURE",
      startTimestamp: start,
      endTimestamp: end,
      firstTriggerTimestamp: start,
      deathTimestamp: null,
      triggerTypes: ["LARGE_HIT"],
      timeBelow35HpMs: null,
      timeFromFirstTriggerToDeathMs: null,
      reactionIntervalMs: 3000,
      reactionEligible: true,
      reactionIneligibilityReason: null,
      hpBefore: 600_000,
      minimumHp: 400_000,
      maximumHp: 1_000_000,
      damageEventsResponsible: [],
      deathOutcome: false,
      applicableDefensiveRules: [],
      confirmedAvailableDefensives: [],
      defensiveCastsOrBuffsDetected: [],
      defensiveCoverageKind: "eligible_miss",
      recoveryResourcesConfirmedAvailable: [],
      recoveryActionsDetected: [],
      recoveryCoverageKind: "not_applicable",
      eventDataComplete: true,
    };
  }

  it("merges windows without stable recovery above 50%", () => {
    const windows = [
      stubWindow("dw1", 10_000, 10_000),
      stubWindow("dw2", 18_000, 18_000),
      stubWindow("dw3", 25_000, 25_000),
    ];
    const timeline = {
      runId: "TestRep:1",
      reportCode: "TestRep",
      fightId: 1,
      complete: true,
      incompletenessReasons: [],
      observedSnapshotCount: 3,
      reconstructedPointCount: 0,
      points: [
        {
          timestamp: 10_000,
          currentHp: 400_000,
          maxHp: 1_000_000,
          hpPercent: 0.4,
          absorbed: null,
          triggeringEvent: "damage",
          sourceAbility: null,
          confidence: "OBSERVED" as const,
          directlyObserved: true,
        },
        {
          timestamp: 18_000,
          currentHp: 350_000,
          maxHp: 1_000_000,
          hpPercent: 0.35,
          absorbed: null,
          triggeringEvent: "damage",
          sourceAbility: null,
          confidence: "OBSERVED" as const,
          directlyObserved: true,
        },
        {
          timestamp: 25_000,
          currentHp: 300_000,
          maxHp: 1_000_000,
          hpPercent: 0.3,
          absorbed: null,
          triggeringEvent: "damage",
          sourceAbility: null,
          confidence: "OBSERVED" as const,
          directlyObserved: true,
        },
      ],
    };
    const clusters = clusterWindowsByCandidateRule(windows, timeline, 1_000_000, {
      mergeGapMs: 8_000,
      recoverAboveHpRatio: 0.5,
      stableRecoveryMs: 5_000,
    });
    expect(clusters.length).toBe(1);
    expect(clusters[0]?.length).toBe(3);
  });

  it("flags close consecutive pairs as likely fragmented", () => {
    const windows = [
      stubWindow("dw1", 10_000, 10_000),
      stubWindow("dw2", 14_000, 14_000),
    ];
    windows[0]!.damageEventsResponsible = [
      { timestamp: 10_000, abilityGameID: 99, sourceID: 1, amount: 400_000, absorbed: 0 },
    ];
    windows[1]!.damageEventsResponsible = [
      { timestamp: 14_000, abilityGameID: 99, sourceID: 1, amount: 400_000, absorbed: 0 },
    ];
    const pairs = auditFragmentationPairs(windows, new Map(), new Map([["TestRep:1", 1_000_000]]));
    expect(pairs).toHaveLength(1);
    expect(pairs[0]?.under8s).toBe(true);
    expect(pairs[0]?.sameSourceAbility).toBe(true);
  });
});

describe("survival-v1.1 recovery audit verdict helpers", () => {
  it("reports unmatched passive heals separately from catalog tools", () => {
    const run = baseRun();
    run.normalized.selfHealingAndConsumables.healing = [
      {
        spellId: 108366,
        canonicalKey: null,
        category: null,
        catalogMatched: false,
        ambiguous: false,
        eventCount: 10,
        totalAmount: 500_000,
        totalOverheal: 0,
        timestamps: [1_000, 2_000],
      },
    ];
    const result = auditRecoveryDetection({
      runs: [run],
      windows: [],
      maxHpByRun: new Map([["TestRep:1", 1_000_000]]),
      classSlug: "warlock",
    });
    expect(result.unmatchedSpellIds).toContain(108366);
    expect(result.candidates.some((c) => c.matchedKind === "passive_absorb")).toBe(true);
  });
});
