import { describe, expect, it } from "vitest";
import { getAbilityCatalog } from "@mplus/abilities";
import type { SurvivalCalibrationRun } from "./survival-calibration-types.js";
import type {
  SurvivalNormalizedDataset,
  SurvivalPreservedEvent,
} from "./survival-probe-types.js";
import type { ExplicitHealthSnapshot } from "./survival-v1_1-types.js";
import { scoreSurvivalV1_1_1Run } from "./survival-v1_1_1-logic.js";
import {
  buildCanonicalSurvivalAnalysis,
  emptySurvivalCanonicalDatasets,
} from "../analysis/survival-canonical-analysis.js";
import { analyzeSurvivalRunDetailed } from "../analysis/survival-run-analysis.js";
import { enrichSurvivalCalibrationRun } from "./survival-calibration-logic.js";
import { SURVIVAL_EVENT_TYPES } from "./survival-probe-types.js";
import { normalizeSurvivalDataset } from "./survival-probe-logic.js";

const catalog = getAbilityCatalog({ classSlug: "warlock", specSlug: "demonology" });
const mageCatalog = getAbilityCatalog({ classSlug: "mage", specSlug: "frost" });

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

function snap(timestamp: number, currentHp: number, maxHp: number): ExplicitHealthSnapshot {
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

function baseNormalized(overrides?: Partial<SurvivalNormalizedDataset>): SurvivalNormalizedDataset {
  return {
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
      totalDamageTaken: 400_000,
      totalAbsorbed: 0,
      byAbility: [],
      bySource: [],
      events: [
        event({ timestamp: 10_000, amount: 200_000 }),
        event({ timestamp: 10_500, amount: 200_000 }),
      ],
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
      raw: null,
    },
    abilityCatalog: {
      catalogVersion: catalog.catalogVersion,
      classSlug: "warlock",
      specSlug: "demonology",
      supported: true,
      matchedSpellIds: [],
      unmatchedSpellIds: [],
      ambiguousSpellIds: [],
    },
    ...overrides,
  };
}

function baseRun(
  normalized: SurvivalNormalizedDataset = baseNormalized(),
): SurvivalCalibrationRun {
  return {
    runId: "TestRep:1",
    dungeonSlug: "skyreach",
    reportCode: "TestRep",
    fightId: 1,
    keyLevel: 20,
    timed: true,
    depleted: false,
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
      totalDamageTaken: normalized.damageTaken.totalDamageTaken,
      damageTakenPerMinute: null,
      absorbedAmount: 0,
      unabsorbedDamage: normalized.damageTaken.totalDamageTaken,
      unabsorbedDamagePerMinute: null,
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

const pressureSnapshots = [
  snap(0, 1_000_000, 1_000_000),
  snap(10_000, 200_000, 1_000_000),
  snap(10_500, 150_000, 1_000_000),
  snap(20_000, 900_000, 1_000_000),
];

describe("recovery NOT_APPLICABLE semantics", () => {
  it("no confirmed recovery resource → NOT_APPLICABLE (mage without potion/self-heal evidence)", () => {
    const normalized = baseNormalized({
      abilityCatalog: {
        catalogVersion: mageCatalog.catalogVersion,
        classSlug: "mage",
        specSlug: "frost",
        supported: true,
        matchedSpellIds: [],
        unmatchedSpellIds: [],
        ambiguousSpellIds: [],
      },
      combatantInfo: {
        specialization: "frost",
        specId: 64,
        talents: null,
        gear: null,
        itemLevel: null,
        raw: null,
      },
    });
    const run = baseRun(normalized);
    run.specialization = "frost";
    const { runScore } = scoreSurvivalV1_1_1Run({
      run,
      catalog: mageCatalog,
      classSlug: "mage",
      snapshots: pressureSnapshots,
      eventPagesComplete: true,
    });
    expect(runScore.emergencyRecovery.state).toBe("NOT_APPLICABLE");
    expect(runScore.emergencyRecovery.score).toBeNull();
    expect(runScore.weightsApplied.emergencyRecovery).toBe(0);
    expect(runScore.weightsApplied.survivalOutcome).toBeCloseTo(0.55 / 0.85, 5);
    expect(runScore.weightsApplied.defensiveResponse).toBeCloseTo(0.3 / 0.85, 5);
  });

  it("confirmed healthstone + no use → scored 0 for warlock", () => {
    const { runScore } = scoreSurvivalV1_1_1Run({
      run: baseRun(),
      catalog,
      classSlug: "warlock",
      snapshots: pressureSnapshots,
      eventPagesComplete: true,
    });
    expect(runScore.emergencyRecovery.state).toBe("SCORED");
    expect(runScore.emergencyRecovery.score).toBe(0);
    expect(runScore.recoveryCounts.eligible_miss).toBeGreaterThan(0);
    expect(runScore.weightsApplied.emergencyRecovery).toBeGreaterThan(0);
  });

  it("confirmed Drain Life observation + valid heal use → covered", () => {
    const drainLifeId = 234153;
    const normalized = baseNormalized({
      selfHealingAndConsumables: {
        healing: [
          {
            spellId: drainLifeId,
            canonicalKey: "warlock.self-heal.drain-life",
            category: "SELF_HEAL",
            catalogMatched: true,
            ambiguous: false,
            eventCount: 1,
            totalAmount: 200_000,
            totalOverheal: 0,
            timestamps: [11_000],
          },
        ],
        consumableAndSelfHealCasts: [
          {
            canonicalKey: "warlock.self-heal.drain-life",
            category: "SELF_HEAL",
            spellId: drainLifeId,
            name: "Drain Life",
            sourceOwnership: "PLAYER",
            cooldownSeconds: null,
            availability: "BASELINE",
            talentDependentOrUncertain: false,
            castTimestamps: [10_800],
            buffApplications: [],
            buffRemovals: [],
            sourceActorIds: [7],
          },
        ],
      },
    });
    const { runScore } = scoreSurvivalV1_1_1Run({
      run: baseRun(normalized),
      catalog,
      classSlug: "warlock",
      snapshots: pressureSnapshots,
      eventPagesComplete: true,
    });
    expect(runScore.emergencyRecovery.state).toBe("SCORED");
    expect(runScore.emergencyRecovery.score).toBeGreaterThan(0);
    expect(runScore.recoveryCounts.covered).toBeGreaterThan(0);
  });

  it("mixed runs: scored recovery and N/A recovery components redistribute independently", () => {
    const mageRun = baseRun(
      baseNormalized({
        abilityCatalog: {
          catalogVersion: mageCatalog.catalogVersion,
          classSlug: "mage",
          specSlug: "frost",
          supported: true,
          matchedSpellIds: [],
          unmatchedSpellIds: [],
          ambiguousSpellIds: [],
        },
        combatantInfo: {
          specialization: "frost",
          specId: 64,
          talents: null,
          gear: null,
          itemLevel: null,
          raw: null,
        },
      }),
    );
    mageRun.specialization = "frost";
    const mage = scoreSurvivalV1_1_1Run({
      run: mageRun,
      catalog: mageCatalog,
      classSlug: "mage",
      snapshots: pressureSnapshots,
      eventPagesComplete: true,
    }).runScore;
    const warlock = scoreSurvivalV1_1_1Run({
      run: baseRun(),
      catalog,
      classSlug: "warlock",
      snapshots: pressureSnapshots,
      eventPagesComplete: true,
    }).runScore;

    expect(mage.emergencyRecovery.state).toBe("NOT_APPLICABLE");
    expect(warlock.emergencyRecovery.state).toBe("SCORED");
    expect(mage.weightsApplied.emergencyRecovery).toBe(0);
    expect(warlock.weightsApplied.emergencyRecovery).toBeGreaterThan(0);
    expect(mage.behavioralSurvivalScore).not.toEqual(warlock.behavioralSurvivalScore);
  });
});

describe("shared canonical analyzer deep-equal", () => {
  it("probe-style normalize+score and buildCanonicalSurvivalAnalysis agree on the same raw payloads", () => {
    const snapshots = [
      snap(0, 1_000_000, 1_000_000),
      snap(10_000, 200_000, 1_000_000),
      snap(12_000, 900_000, 1_000_000),
    ];

    const damageEvents = [
      {
        timestamp: 10_000,
        amount: 200_000,
        sourceID: 1,
        targetID: 7,
        abilityGameID: 100,
        hitPoints: 200_000,
        maxHitPoints: 1_000_000,
      },
      {
        timestamp: 12_000,
        amount: 50_000,
        sourceID: 1,
        targetID: 7,
        abilityGameID: 100,
        hitPoints: 900_000,
        maxHitPoints: 1_000_000,
      },
    ];

    const datasets = emptySurvivalCanonicalDatasets();
    for (const t of SURVIVAL_EVENT_TYPES) {
      datasets[t] = {
        ...datasets[t],
        state: "OK",
        events: t === "DamageTaken" ? damageEvents : [],
      };
    }

    const production = buildCanonicalSurvivalAnalysis({
      characterId: "char-1",
      identity: { region: "EU", realmSlug: "archimonde", name: "Wallidrixe" },
      reportCode: "TestRep",
      fightId: 1,
      reportRevision: 1,
      dungeonSlug: "skyreach",
      keyLevel: 20,
      playerActorId: 7,
      ownedPetActorIds: [],
      fightStartTime: 0,
      fightEndTime: 600_000,
      datasets,
      snapshots,
      catalog,
      classSlug: "warlock",
      specSlug: "demonology",
      eventPagesComplete: true,
    });

    const normalized = normalizeSurvivalDataset({
      identity: { region: "EU", realmSlug: "archimonde", name: "Wallidrixe" },
      probedAt: "2026-07-28T00:00:00.000Z",
      candidate: {
        reportCode: "TestRep",
        fightId: 1,
        encounterId: 0,
        dungeonSlug: "skyreach",
        keyLevel: 20,
        score: null,
        durationMs: 600_000,
        startTimeMs: 0,
        completedAt: null,
        specSlug: "demonology",
        roleSlug: null,
        rank: 0,
      },
      wclCharacterId: 0,
      wclCanonicalId: 0,
      playerActorId: 7,
      ownedPetActorIds: [],
      fightStartTime: 0,
      fightEndTime: 600_000,
      keyLevel: 20,
      encounterId: null,
      encounterName: null,
      eventDatasets: datasets,
      catalog,
      classSlug: "warlock",
      specSlug: "demonology",
    });
    const run = enrichSurvivalCalibrationRun({
      normalized,
      timed: null,
      depleted: null,
      completed: null,
      score: null,
      missingDatasets: [],
    });
    const probe = analyzeSurvivalRunDetailed({
      characterId: "char-1",
      reportRevision: 1,
      run,
      snapshots,
      catalog,
      classSlug: "warlock",
      eventPagesComplete: true,
    });

    expect(probe.summary.behavioralSurvivalScore).toEqual(
      production.summary.behavioralSurvivalScore,
    );
    expect(probe.summary.outcomeOnlyScore).toEqual(production.summary.outcomeOnlyScore);
    expect(probe.summary.componentScores).toEqual(production.summary.componentScores);
    expect(probe.summary.defensiveCounts).toEqual(production.summary.defensiveCounts);
    expect(probe.summary.recoveryCounts).toEqual(production.summary.recoveryCounts);
    expect(probe.summary.pressureClusterCount).toEqual(production.summary.pressureClusterCount);
    expect(probe.summary.deathCount).toEqual(production.summary.deathCount);
    expect(probe.maxHpResolution.baselineMaxHp).toEqual(production.maxHpResolution.baselineMaxHp);
  });
});
