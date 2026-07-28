import { describe, expect, it } from "vitest";
import { getAbilityCatalog } from "@mplus/abilities";
import type { SurvivalCalibrationRun } from "./survival-calibration-types.js";
import type {
  SurvivalNormalizedDataset,
  SurvivalPreservedEvent,
} from "./survival-probe-types.js";
import { clusterWindowsByCandidateRule } from "./survival-v1_1-audit.js";
import type {
  ExplicitHealthSnapshot,
  HealthTimeline,
  SurvivalV1_1DangerWindowAudit,
} from "./survival-v1_1-types.js";
import { detectV1_1DangerTriggers } from "./survival-v1_1-logic.js";
import { filterInFightPlayerDeaths } from "./survival-v1-logic.js";
import { scoreSurvivalV1_1_1Run } from "./survival-v1_1_1-logic.js";
import {
  activeMaxHpAt,
  hardenMaxHpResolution,
} from "./survival-v1_1_1-maxhp.js";
import { SURVIVAL_STANDALONE_V1_1_1_CONFIG } from "./survival-v1_1_1-config.js";

const catalog = getAbilityCatalog({ classSlug: "warlock", specSlug: "demonology" });
const BASELINE = 1_000_000;

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

function snap(
  timestamp: number,
  currentHp: number,
  maxHp: number,
): ExplicitHealthSnapshot {
  return {
    timestamp,
    currentHp,
    maxHp,
    absorb: null,
    path: "DamageTaken.event",
    dataType: "DamageTaken",
    abilityGameID: null,
    sourceID: 1,
    targetID: 7,
    eventType: "damage",
    rawFragment: { hitPoints: currentHp, maxHitPoints: maxHp },
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

function stubWindow(
  id: string,
  start: number,
  end: number,
  overrides: Partial<SurvivalV1_1DangerWindowAudit> = {},
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
    hpBefore: 800_000,
    minimumHp: 400_000,
    maximumHp: BASELINE,
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
    ...overrides,
  };
}

function timelinePoints(
  points: Array<{ timestamp: number; currentHp: number; maxHp?: number }>,
): HealthTimeline {
  return {
    runId: "TestRep:1",
    reportCode: "TestRep",
    fightId: 1,
    complete: true,
    incompletenessReasons: [],
    observedSnapshotCount: points.length,
    reconstructedPointCount: 0,
    points: points.map((p) => ({
      timestamp: p.timestamp,
      currentHp: p.currentHp,
      maxHp: p.maxHp ?? BASELINE,
      hpPercent: p.currentHp / (p.maxHp ?? BASELINE),
      absorbed: null,
      triggeringEvent: "damage",
      sourceAbility: null,
      confidence: "OBSERVED" as const,
      directlyObserved: true,
    })),
  };
}

function baselineSnapshots(count = 12): ExplicitHealthSnapshot[] {
  return Array.from({ length: count }, (_, i) =>
    snap(1_000 + i * 1_000, BASELINE, BASELINE),
  );
}

describe("survival-v1.1.1 max HP hardening", () => {
  it("accepts valid Dark Pact temporary max HP", () => {
    const temp = 1_400_000;
    const snapshots = [
      ...baselineSnapshots(10),
      snap(50_000, 900_000, temp),
      snap(50_500, 880_000, temp),
      snap(51_000, 860_000, temp),
    ];
    const resolution = hardenMaxHpResolution(snapshots, {
      playerActorId: 7,
      darkPactActiveIntervals: [{ start: 49_000, end: 60_000 }],
    });
    expect(resolution.baselineMaxHp).toBe(BASELINE);
    expect(
      resolution.classifiedSnapshots.some((c) => c.classification === "VALID_TEMPORARY"),
    ).toBe(true);
    expect(activeMaxHpAt(resolution, 50_500)).toBe(temp);
  });

  it("rejects implausible million-scale max HP without corroboration", () => {
    const snapshots = [
      ...baselineSnapshots(10),
      snap(50_000, 900_000, 50_000_000),
    ];
    const resolution = hardenMaxHpResolution(snapshots, { playerActorId: 7 });
    expect(resolution.baselineMaxHp).toBe(BASELINE);
    expect(resolution.invalidOutlierCount).toBeGreaterThan(0);
    expect(
      resolution.classifiedSnapshots.some((c) => c.classification === "INVALID_OUTLIER"),
    ).toBe(true);
    expect(activeMaxHpAt(resolution, 50_000)).toBe(BASELINE);
  });

  it("falls back to baseline when no temporary interval is active", () => {
    const snapshots = baselineSnapshots(8);
    const resolution = hardenMaxHpResolution(snapshots, { playerActorId: 7 });
    expect(resolution.baselineMaxHp).toBe(BASELINE);
    expect(activeMaxHpAt(resolution, 5_000)).toBe(BASELINE);
  });
});

describe("survival-v1.1.1 active max HP for LARGE_HIT", () => {
  it("uses active max HP (not baseline alone) for LARGE_HIT detection", () => {
    const run = baseRun();
    // 400k is LARGE_HIT vs 1M baseline (30%) but NOT vs 1.5M temporary (30% = 450k).
    run.normalized.damageTaken.events = [event({ timestamp: 50_000, amount: 400_000 })];
    const temp = 1_500_000;
    const snapshots = [
      ...baselineSnapshots(10),
      snap(49_000, 1_200_000, temp),
      snap(50_000, 1_100_000, temp),
      snap(50_500, 1_050_000, temp),
    ];
    const hardened = hardenMaxHpResolution(snapshots, {
      playerActorId: 7,
      darkPactActiveIntervals: [{ start: 48_000, end: 60_000 }],
    });
    expect(activeMaxHpAt(hardened, 50_000)).toBe(temp);

    const deaths = filterInFightPlayerDeaths(
      run.deaths.deaths,
      run.playerActorId,
      run.normalized.run.startTime,
      run.normalized.run.endTime,
    );
    const withActive = detectV1_1DangerTriggers({
      run,
      maxHp: hardened.baselineMaxHp,
      timeline: null,
      deaths,
      resolveMaxHp: (ts) => activeMaxHpAt(hardened, ts),
    });
    const withBaselineOnly = detectV1_1DangerTriggers({
      run,
      maxHp: hardened.baselineMaxHp,
      timeline: null,
      deaths,
    });
    expect(withBaselineOnly.some((t) => t.type === "LARGE_HIT")).toBe(true);
    expect(withActive.some((t) => t.type === "LARGE_HIT")).toBe(false);
  });
});

describe("survival-v1.1.1 pressure clustering", () => {
  it("suppresses continuous low-health fragments into one cluster", () => {
    const windows = [
      stubWindow("dw1", 10_000, 10_000),
      stubWindow("dw2", 18_000, 18_000),
      stubWindow("dw3", 25_000, 25_000),
    ];
    const timeline = timelinePoints([
      { timestamp: 10_000, currentHp: 400_000 },
      { timestamp: 18_000, currentHp: 350_000 },
      { timestamp: 25_000, currentHp: 300_000 },
    ]);
    const clusters = clusterWindowsByCandidateRule(windows, timeline, BASELINE, {
      mergeGapMs: SURVIVAL_STANDALONE_V1_1_1_CONFIG.danger.mergeGapMs,
      recoverAboveHpRatio: SURVIVAL_STANDALONE_V1_1_1_CONFIG.pressureCluster.recoverAboveHpRatio,
      stableRecoveryMs: SURVIVAL_STANDALONE_V1_1_1_CONFIG.pressureCluster.stableRecoveryMs,
    });
    expect(clusters).toHaveLength(1);
    expect(clusters[0]).toHaveLength(3);
  });

  it("opens a separate cluster after stable recovery above 50%", () => {
    const windows = [
      stubWindow("dw1", 10_000, 12_000),
      stubWindow("dw2", 40_000, 42_000),
    ];
    const timeline = timelinePoints([
      { timestamp: 10_000, currentHp: 300_000 },
      { timestamp: 12_000, currentHp: 280_000 },
      { timestamp: 20_000, currentHp: 700_000 },
      { timestamp: 25_000, currentHp: 750_000 },
      { timestamp: 30_000, currentHp: 800_000 },
      { timestamp: 40_000, currentHp: 400_000 },
    ]);
    const clusters = clusterWindowsByCandidateRule(windows, timeline, BASELINE, {
      mergeGapMs: 8_000,
      recoverAboveHpRatio: 0.5,
      stableRecoveryMs: 5_000,
    });
    expect(clusters).toHaveLength(2);
  });

  it("applies pressure-cluster recovery gate (no new cluster while below recoverAbove)", () => {
    const windows = [
      stubWindow("dw1", 10_000, 10_000),
      stubWindow("dw2", 30_000, 30_000),
    ];
    // 20s gap but never recovers above 50%
    const timeline = timelinePoints([
      { timestamp: 10_000, currentHp: 300_000 },
      { timestamp: 20_000, currentHp: 400_000 },
      { timestamp: 30_000, currentHp: 350_000 },
    ]);
    const clusters = clusterWindowsByCandidateRule(windows, timeline, BASELINE, {
      mergeGapMs: 8_000,
      recoverAboveHpRatio: 0.5,
      stableRecoveryMs: 5_000,
    });
    expect(clusters).toHaveLength(1);
  });

  it("grants one defensive credit per cluster (not per fragment window)", () => {
    const run = baseRun();
    // Hits spaced > mergeGap (8s) so V1.1 keeps separate windows; continuous low HP clusters them.
    run.normalized.damageTaken.events = [
      event({ timestamp: 10_000, amount: 400_000 }),
      event({ timestamp: 20_000, amount: 400_000 }),
      event({ timestamp: 30_000, amount: 400_000 }),
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
        castTimestamps: [9_500],
        buffApplications: [
          { timestamp: 9_500, type: "apply", sourceID: 7, targetID: 7 },
        ],
        buffRemovals: [
          { timestamp: 17_500, type: "remove", sourceID: 7, targetID: 7 },
        ],
        sourceActorIds: [7],
      },
    ];
    const snapshots = [
      ...baselineSnapshots(8),
      snap(10_000, 400_000, BASELINE),
      snap(20_000, 350_000, BASELINE),
      snap(30_000, 300_000, BASELINE),
    ];
    const { runScore, dangerWindows, pressureClusters } = scoreSurvivalV1_1_1Run({
      run,
      catalog,
      classSlug: "warlock",
      snapshots,
      eventPagesComplete: true,
      healthTimeline: timelinePoints([
        { timestamp: 10_000, currentHp: 400_000 },
        { timestamp: 15_000, currentHp: 380_000 },
        { timestamp: 20_000, currentHp: 350_000 },
        { timestamp: 25_000, currentHp: 320_000 },
        { timestamp: 30_000, currentHp: 300_000 },
      ]),
    });
    expect(dangerWindows.length).toBeGreaterThanOrEqual(2);
    expect(pressureClusters.length).toBe(1);
    expect(runScore.pressureClusterCount).toBe(1);
    expect(runScore.defensiveResponse.state).toBe("SCORED");
    // One cluster credit — covered/eligible should be 1/1 → 100
    expect(runScore.defensiveResponse.evidence).toMatchObject({
      covered: 1,
      eligible: 1,
      oneCreditPerCluster: true,
    });
    expect(runScore.defensiveResponse.score).toBe(100);
  });
});
