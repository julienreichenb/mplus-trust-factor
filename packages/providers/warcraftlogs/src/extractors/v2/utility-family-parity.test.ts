/**
 * Digest vs shared-evidence Utility family fact parity (no provider network).
 */
import { describe, expect, it } from "vitest";
import {
  PARTICIPANT_DIGEST_EXTRACTOR_COMPAT_VERSION,
  PARTICIPANT_SCORING_DIGEST_SCHEMA_VERSION,
  withParticipantDigestContentHash,
  type ParticipantScoringDigestV1,
  type UtilityCanonicalAction,
} from "@mplus/contracts";
import { utilityRunFactSetFromDigest } from "@mplus/scoring";
import { mapUtilityNormalizedRunToFactSet, type FrozenSlotBindingV2 } from "./index.js";
import type {
  UtilityCcEvent,
  UtilityDispelPurgeEvent,
  UtilityGroupUtilityEvent,
  UtilityInterruptEvent,
  UtilityNormalizedRun,
  UtilityPreservedEvent,
} from "../../probe/utility-probe-types.js";

const SLOT: FrozenSlotBindingV2 = {
  slotId: "ara-kara:0",
  dungeonSlug: "ara-kara",
  slotIndex: 0,
  keyLevel: 12,
  identity: {
    reportCode: "AbCdEfGhIjKl",
    fightId: 3,
    reportRevision: 1,
  },
};

function preserved(ts: number, spellId: number): UtilityPreservedEvent {
  return {
    timestamp: ts,
    sourceID: 10,
    targetID: 50,
    abilityGameID: spellId,
    extraAbilityGameID: null,
    type: "cast",
    hitType: null,
    fightId: SLOT.identity.fightId,
    reportCode: SLOT.identity.reportCode,
    actorOwnership: "PLAYER",
    additionalFields: {},
    raw: {},
  };
}

function interruptEvent(ts: number, spellId: number): UtilityInterruptEvent {
  return {
    timestamp: ts,
    sourceID: 10,
    targetID: 50,
    abilityGameID: spellId,
    interruptedSpellId: 400001,
    sourceKind: "PLAYER",
    canonical: null,
    cooldownStateAtCast: "AVAILABLE",
    repeatedOnSameCast: false,
    unmatchedSpellId: false,
    event: preserved(ts, spellId),
  };
}

function ccEvent(ts: number, spellId: number): UtilityCcEvent {
  return {
    timestamp: ts,
    sourceID: 10,
    targetID: 50,
    abilityGameID: spellId,
    category: "HARD_CC",
    sourceKind: "PLAYER",
    canonical: null,
    hostileTarget: true,
    nonBossTarget: true,
    debuffApplied: true,
    durationMs: 4000,
    breakOrRemovalTimestamp: null,
    repeatedOnSameTarget: false,
    unmatchedSpellId: false,
    usefulnessClassification: null,
    usefulnessNote: "",
    event: preserved(ts, spellId),
  };
}

function dispelEvent(ts: number, spellId: number): UtilityDispelPurgeEvent {
  return {
    timestamp: ts,
    sourceID: 10,
    targetID: 11,
    abilityGameID: spellId,
    removedSpellId: 1,
    kind: "DISPEL",
    targetSide: "FRIENDLY",
    sourceKind: "PLAYER",
    canonical: null,
    cooldownStateAtCast: "AVAILABLE",
    unmatchedSpellId: false,
    event: preserved(ts, spellId),
  };
}

function groupEvent(
  ts: number,
  spellId: number,
  category: UtilityGroupUtilityEvent["category"],
): UtilityGroupUtilityEvent {
  return {
    timestamp: ts,
    sourceID: 10,
    targetID: 11,
    abilityGameID: spellId,
    category,
    sourceKind: "PLAYER",
    canonical: null,
    successfulApplication: true,
    targetDeathNearby: null,
    battleRezResult: null,
    classification: "CONFIRMED_USEFUL",
    evidence: [],
    unmatchedSpellId: false,
    event: preserved(ts, spellId),
  };
}

function emptyDatasets(): UtilityNormalizedRun["datasetStates"] {
  return {
    CombatantInfo: "OK",
    Casts: "OK",
    Buffs: "OK",
    Debuffs: "OK",
    Interrupts: "OK",
    Dispels: "OK",
    Deaths: "OK",
    DamageDone: "OK",
  };
}

function baseAction(
  overrides: Partial<UtilityCanonicalAction> &
    Pick<UtilityCanonicalAction, "utilityCategory" | "outcome" | "canonicalActionId">,
): UtilityCanonicalAction {
  return {
    abilityKey: "ability",
    canonicalName: "Ability",
    primarySpellId: 1,
    observedSpellIds: [overrides.primarySpellId ?? 1],
    reportCode: SLOT.identity.reportCode,
    fightId: SLOT.identity.fightId,
    reportRevision: SLOT.identity.reportRevision,
    dungeonSlug: "ara-kara",
    rawTimestampMs: 10_000,
    fightOffsetMs: 10_000,
    sourceActorId: 10,
    ownerActorId: 10,
    targetActorId: 50,
    sourceCharacterName: "Target",
    targetCharacterName: "Enemy",
    sourceClassSlug: "mage",
    sourceSpecSlug: "frost",
    sourceDataset: "Casts",
    evidenceEventTypes: ["cast"],
    attributedToPet: false,
    petActorId: null,
    limitations: [],
    catalogVersion: "catalog-test-v1",
    normalizerVersion: "utility-action-normalizer-v1",
    ...overrides,
  };
}

function digestFromActions(
  actions: UtilityCanonicalAction[],
  identity: { classSlug: string; specSlug: string },
): ParticipantScoringDigestV1 {
  return withParticipantDigestContentHash({
    schemaVersion: PARTICIPANT_SCORING_DIGEST_SCHEMA_VERSION,
    reportCode: SLOT.identity.reportCode,
    fightId: SLOT.identity.fightId,
    reportRevision: SLOT.identity.reportRevision,
    dungeonSlug: "ara-kara",
    keyLevel: 12,
    timed: true,
    runScore: 400,
    completedAt: "2026-07-01T12:00:00.000Z",
    participantActorId: 10,
    characterId: null,
    characterName: "Target",
    realmSlug: "archimonde",
    regionCode: "EU",
    classSlug: identity.classSlug,
    specSlug: identity.specSlug,
    role: "DPS",
    ownedPetActorIds: [],
    loadoutEvidence: {
      evidenceState: "ABSENT",
      talentSpellIds: [],
      talentTreeNodeIds: [],
      blizzardSpecId: null,
      source: "ABSENT",
    },
    capabilityPackageArtifactId: "pkg-1",
    capabilityPackageContentHash: "a".repeat(32),
    catalogVersion: "catalog-test-v1",
    extractorCompatVersion: PARTICIPANT_DIGEST_EXTRACTOR_COMPAT_VERSION,
    performance: {
      parsePercentile: 80,
      parseSemantic: "BRACKET_PERCENT",
      partition: null,
      rawDps: null,
      offensiveActivations: [],
      activeCombatMs: 600_000,
      activeCombatMethod: "fight_duration_fallback",
      completeness: "COMPLETE",
      limitations: [],
    },
    utility: {
      hostileCastEvents: [],
      actions,
      capabilityCompleteness: [
        {
          capability: "UTILITY_INTERRUPTS",
          status: "COMPLETE",
          requiredDatasets: ["Interrupts", "Casts"],
          presentDatasets: ["Interrupts", "Casts"],
          incompleteDatasets: [],
          limitations: [],
        },
      ],
      completeness: "COMPLETE",
      limitations: [],
    },
    survival: {
      damageTakenTotal: 1000,
      damageTakenEventCount: 10,
      deaths: [],
      personalDefensiveActivations: [],
      recoveryActivations: [],
      externalsReceived: [],
      pressureWindows: [],
      fightDurationMs: 600_000,
      activeCombatMs: 600_000,
      capabilityCompleteness: [],
      completeness: "COMPLETE",
      limitations: [],
    },
    createdAt: "2026-08-01T12:00:00.000Z",
  });
}

function familyFacts(fact: {
  interruptAttempts: unknown[];
  ccActions: unknown[];
  supportActions: Array<{ abilityGameId: number }>;
  dispelPurgeSuccessCount: number;
  bloodlustSuccessCount: number;
  toolkit: {
    hasInterrupt: boolean;
    hasSupport: boolean;
    hasStrategicCc: boolean;
    families?: Record<string, { state: string }>;
  };
}) {
  return {
    interruptCount: fact.interruptAttempts.length,
    ccCount: fact.ccActions.length,
    supportSpellIds: [...fact.supportActions.map((a) => a.abilityGameId)].sort((a, b) => a - b),
    dispelPurgeSuccessCount: fact.dispelPurgeSuccessCount,
    bloodlustSuccessCount: fact.bloodlustSuccessCount,
    hasInterrupt: fact.toolkit.hasInterrupt,
    hasSupport: fact.toolkit.hasSupport,
    hasStrategicCc: fact.toolkit.hasStrategicCc,
    familyStates: Object.fromEntries(
      Object.entries(fact.toolkit.families ?? {}).map(([k, v]) => [k, v.state]),
    ),
  };
}

describe("digest vs shared-evidence Utility family parity", () => {
  it("assigns interrupt, CC, dispel, bloodlust, and group support to the same families", () => {
    const run: UtilityNormalizedRun = {
      reportCode: SLOT.identity.reportCode,
      fightId: SLOT.identity.fightId,
      dungeonSlug: "ara-kara",
      keyLevel: 12,
      durationMs: 600_000,
      playerActorId: 10,
      petActorIds: [],
      specialization: "frost",
      classSlug: "mage",
      roleSlug: "dps",
      interruptEvents: [interruptEvent(10_000, 2139)],
      ccEvents: [ccEvent(12_000, 122)],
      dispelPurgeEvents: [dispelEvent(14_000, 475)],
      externalGroupUtilityEvents: [
        groupEvent(16_000, 80353, "BLOODLUST"),
        groupEvent(18_000, 414660, "EXTERNAL_DEFENSIVE"),
      ],
      classSpecificEvents: [],
      interruptOpportunities: [],
      dispelPurgeOpportunities: [],
      unmatchedAbilityIds: [],
      incompleteDatasets: [],
      datasetStates: emptyDatasets(),
      truncatedDatasets: [],
    };

    const shared = mapUtilityNormalizedRunToFactSet({
      slot: SLOT,
      run,
      hostileCastEvents: [],
      castEvents: [
        {
          timestamp: 10_000,
          type: "cast",
          sourceID: 10,
          abilityGameID: 2139,
          targetID: 50,
        },
      ],
      classSlug: "mage",
      specSlug: "frost",
      talentDataAvailable: false,
    });

    const digest = digestFromActions(
      [
        baseAction({
          canonicalActionId: "kick",
          utilityCategory: "INTERRUPT",
          outcome: "SUCCESS",
          primarySpellId: 2139,
          abilityKey: "counterspell",
          canonicalName: "Counterspell",
          sourceDataset: "Interrupts",
          evidenceEventTypes: ["interrupt"],
        }),
        baseAction({
          canonicalActionId: "cc",
          utilityCategory: "CROWD_CONTROL",
          outcome: "SUCCESS",
          primarySpellId: 122,
          abilityKey: "frost-nova",
          canonicalName: "Frost Nova",
          rawTimestampMs: 12_000,
        }),
        baseAction({
          canonicalActionId: "dispel",
          utilityCategory: "DEFENSIVE_DISPEL",
          outcome: "SUCCESS",
          primarySpellId: 475,
          abilityKey: "remove-curse",
          canonicalName: "Remove Curse",
          sourceDataset: "Dispels",
          evidenceEventTypes: ["dispel"],
          rawTimestampMs: 14_000,
        }),
        baseAction({
          canonicalActionId: "lust",
          utilityCategory: "OTHER_UTILITY",
          outcome: "SUCCESS",
          primarySpellId: 80353,
          abilityKey: "time-warp",
          canonicalName: "Time Warp",
          rawTimestampMs: 16_000,
        }),
        baseAction({
          canonicalActionId: "support",
          utilityCategory: "EXTERNAL_SUPPORT",
          outcome: "SUCCESS",
          primarySpellId: 414660,
          abilityKey: "mass-barrier",
          canonicalName: "Mass Barrier",
          sourceDataset: "Buffs",
          evidenceEventTypes: ["applybuff"],
          rawTimestampMs: 18_000,
        }),
      ],
      { classSlug: "mage", specSlug: "frost" },
    );
    const fromDigest = utilityRunFactSetFromDigest(digest, {
      slotId: SLOT.slotId,
      slotIndex: SLOT.slotIndex,
    });

    const sharedFacts = familyFacts(shared);
    const digestFacts = familyFacts(fromDigest);
    expect(sharedFacts.interruptCount).toBeGreaterThan(0);
    expect(digestFacts.interruptCount).toBeGreaterThan(0);
    expect(sharedFacts.ccCount).toBe(digestFacts.ccCount);
    expect(sharedFacts.dispelPurgeSuccessCount).toBe(1);
    expect(digestFacts.dispelPurgeSuccessCount).toBe(1);
    expect(sharedFacts.bloodlustSuccessCount).toBe(1);
    expect(digestFacts.bloodlustSuccessCount).toBe(1);
    expect(sharedFacts.supportSpellIds).not.toContain(475);
    expect(digestFacts.supportSpellIds).not.toContain(475);
    expect(sharedFacts.supportSpellIds).not.toContain(80353);
    expect(digestFacts.supportSpellIds).not.toContain(80353);
    expect(sharedFacts.supportSpellIds).toContain(414660);
    expect(digestFacts.supportSpellIds).toContain(414660);
    expect(sharedFacts.familyStates.interrupt).toBe(digestFacts.familyStates.interrupt);
    expect(sharedFacts.familyStates.crowdControl).toBe(digestFacts.familyStates.crowdControl);
    expect(sharedFacts.familyStates.dispelPurge).toBe(digestFacts.familyStates.dispelPurge);
    expect(sharedFacts.familyStates.bloodlust).toBe(digestFacts.familyStates.bloodlust);
    expect(sharedFacts.familyStates.groupSupport).toBe(digestFacts.familyStates.groupSupport);
  });

  it("keeps uncertain talent-gated groupSupport off confirmed applicability on both paths", () => {
    const run: UtilityNormalizedRun = {
      reportCode: SLOT.identity.reportCode,
      fightId: SLOT.identity.fightId,
      dungeonSlug: "ara-kara",
      keyLevel: 12,
      durationMs: 600_000,
      playerActorId: 10,
      petActorIds: [],
      specialization: "frost",
      classSlug: "mage",
      roleSlug: "dps",
      interruptEvents: [],
      ccEvents: [],
      dispelPurgeEvents: [],
      externalGroupUtilityEvents: [],
      classSpecificEvents: [],
      interruptOpportunities: [],
      dispelPurgeOpportunities: [],
      unmatchedAbilityIds: [],
      incompleteDatasets: [],
      datasetStates: emptyDatasets(),
      truncatedDatasets: [],
    };
    const shared = mapUtilityNormalizedRunToFactSet({
      slot: SLOT,
      run,
      hostileCastEvents: [],
      castEvents: [],
      classSlug: "mage",
      specSlug: "frost",
      talentDataAvailable: false,
    });
    const fromDigest = utilityRunFactSetFromDigest(
      digestFromActions([], { classSlug: "mage", specSlug: "frost" }),
      { slotId: SLOT.slotId, slotIndex: SLOT.slotIndex },
    );
    expect(shared.toolkit.families?.groupSupport.state).toBe("uncertain");
    expect(fromDigest.toolkit.families?.groupSupport.state).toBe("uncertain");
  });
});
