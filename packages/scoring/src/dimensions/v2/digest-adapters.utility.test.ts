/**
 * Digest → Utility V2 fact adapter (functional Phase 2 product mapping).
 */
import { describe, expect, it } from "vitest";
import {
  PARTICIPANT_DIGEST_EXTRACTOR_COMPAT_VERSION,
  PARTICIPANT_SCORING_DIGEST_SCHEMA_VERSION,
  withParticipantDigestContentHash,
  type ParticipantScoringDigestV1,
  type UtilityCanonicalAction,
} from "@mplus/contracts";
import {
  UTILITY_V2_INTERRUPT_CREDITS,
  computeUtilityV2,
  emptyUtilityV2FactSet,
} from "../../utility/v2/index.js";
import {
  DigestDimensionIncompleteError,
  classifyDigestInterruptOutcome,
  supportEvidenceTierFromDigestAction,
  utilityRunFactSetFromDigest,
} from "./digest-adapters.js";

function baseAction(
  overrides: Partial<UtilityCanonicalAction> &
    Pick<UtilityCanonicalAction, "utilityCategory" | "outcome" | "canonicalActionId">,
): UtilityCanonicalAction {
  return {
    abilityKey: "counterspell",
    canonicalName: "Counterspell",
    primarySpellId: 2139,
    observedSpellIds: [2139],
    reportCode: "abc123",
    fightId: 1,
    reportRevision: 1,
    dungeonSlug: "skyreach",
    rawTimestampMs: 10_000,
    fightOffsetMs: 10_000,
    sourceActorId: 10,
    ownerActorId: 10,
    targetActorId: 50,
    sourceCharacterName: "Target",
    targetCharacterName: "Enemy",
    sourceClassSlug: "mage",
    sourceSpecSlug: "fire",
    sourceDataset: "Interrupts",
    evidenceEventTypes: ["interrupt"],
    attributedToPet: false,
    petActorId: null,
    limitations: [],
    catalogVersion: "catalog-test-v1",
    normalizerVersion: "utility-action-normalizer-v1",
    ...overrides,
  };
}

function baseDigest(
  overrides: Partial<Omit<ParticipantScoringDigestV1, "contentHash">> = {},
): ParticipantScoringDigestV1 {
  return withParticipantDigestContentHash({
    schemaVersion: PARTICIPANT_SCORING_DIGEST_SCHEMA_VERSION,
    reportCode: "abc123",
    fightId: 1,
    reportRevision: 1,
    dungeonSlug: "skyreach",
    keyLevel: 15,
    timed: true,
    runScore: 400,
    completedAt: "2026-07-01T12:00:00.000Z",
    participantActorId: 10,
    characterId: null,
    characterName: "Target",
    realmSlug: "archimonde",
    regionCode: "EU",
    classSlug: "mage",
    specSlug: "fire",
    role: "DPS",
    ownedPetActorIds: [99],
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
      activeCombatMs: 1_500_000,
      activeCombatMethod: "fight_duration_fallback",
      completeness: "COMPLETE",
      limitations: [],
    },
    utility: {
      hostileCastEvents: [],
      actions: [],
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
      fightDurationMs: 1_800_000,
      activeCombatMs: 1_500_000,
      capabilityCompleteness: [],
      completeness: "COMPLETE",
      limitations: [],
    },
    createdAt: "2026-08-01T12:00:00.000Z",
    ...overrides,
  });
}

describe("classifyDigestInterruptOutcome", () => {
  it("orders confirmed success above unmatched attempt above not observable", () => {
    const success = classifyDigestInterruptOutcome({
      outcome: "SUCCESS",
      interruptsCapability: "COMPLETE",
    });
    const attempt = classifyDigestInterruptOutcome({
      outcome: "ATTEMPT",
      interruptsCapability: "COMPLETE",
    });
    const absent = classifyDigestInterruptOutcome({
      outcome: "ATTEMPT",
      interruptsCapability: "UNAVAILABLE",
    });
    expect(success.credit).toBeGreaterThan(attempt.credit);
    expect(attempt.credit).toBeGreaterThan(absent.credit);
    expect(success.classification).toBe("CONFIRMED_SUCCESS");
    expect(attempt.classification).toBe("UNMATCHED_ATTEMPT");
    expect(absent.classification).toBe("NOT_OBSERVABLE");
    expect(success.credit).toBe(UTILITY_V2_INTERRUPT_CREDITS.CONFIRMED_SUCCESS);
    expect(attempt.credit).toBe(UTILITY_V2_INTERRUPT_CREDITS.UNMATCHED_ATTEMPT);
    expect(absent.credit).toBe(UTILITY_V2_INTERRUPT_CREDITS.NOT_OBSERVABLE);
  });

  it("does not treat incomplete interrupt observability as failure", () => {
    const incomplete = classifyDigestInterruptOutcome({
      outcome: "ATTEMPT",
      interruptsCapability: "INCOMPLETE",
    });
    expect(incomplete.classification).toBe("NOT_OBSERVABLE");
    expect(incomplete.credit).toBe(0);
  });
});

describe("supportEvidenceTierFromDigestAction", () => {
  it("orders confirmed impact > application > unverified", () => {
    const impact = supportEvidenceTierFromDigestAction(
      baseAction({
        canonicalActionId: "rez",
        utilityCategory: "COMBAT_RES",
        outcome: "SUCCESS",
        sourceDataset: "Casts",
        evidenceEventTypes: ["cast"],
      }),
    );
    const application = supportEvidenceTierFromDigestAction(
      baseAction({
        canonicalActionId: "ext",
        utilityCategory: "EXTERNAL_SUPPORT",
        outcome: "SUCCESS",
        sourceDataset: "Buffs",
        evidenceEventTypes: ["applybuff"],
        abilityKey: "blessing-of-protection",
        canonicalName: "Blessing of Protection",
        primarySpellId: 1022,
      }),
    );
    const unverified = supportEvidenceTierFromDigestAction(
      baseAction({
        canonicalActionId: "raw",
        utilityCategory: "EXTERNAL_SUPPORT",
        outcome: "ATTEMPT",
        sourceDataset: "Casts",
        evidenceEventTypes: ["cast"],
        limitations: ["EXTERNAL_TARGET_CONTEXT_INCOMPLETE"],
        abilityKey: "blessing-of-protection",
        canonicalName: "Blessing of Protection",
        primarySpellId: 1022,
      }),
    );
    expect(impact).toBe("CONFIRMED_IMPACT");
    expect(application).toBe("CONFIRMED_APPLICATION");
    expect(unverified).toBe("UNVERIFIED");
  });
});

describe("utilityRunFactSetFromDigest Phase 2 mapping", () => {
  it("maps interrupt outcomes with canonical credits and pet attribution", () => {
    const digest = baseDigest({
      utility: {
        hostileCastEvents: [],
        actions: [
          baseAction({
            canonicalActionId: "kick-success",
            utilityCategory: "INTERRUPT",
            outcome: "SUCCESS",
          }),
          baseAction({
            canonicalActionId: "kick-attempt",
            utilityCategory: "INTERRUPT",
            outcome: "ATTEMPT",
            sourceDataset: "Casts",
            evidenceEventTypes: ["cast"],
            rawTimestampMs: 20_000,
          }),
          baseAction({
            canonicalActionId: "kick-pet",
            utilityCategory: "INTERRUPT",
            outcome: "SUCCESS",
            attributedToPet: true,
            petActorId: 99,
            sourceActorId: 99,
            rawTimestampMs: 30_000,
            abilityKey: "spell-lock",
            canonicalName: "Spell Lock",
            primarySpellId: 19647,
          }),
        ],
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
    });

    const facts = utilityRunFactSetFromDigest(digest, {
      slotId: "slot-0",
      slotIndex: 0,
    });
    expect(facts.interruptAttempts).toHaveLength(3);
    expect(facts.interruptAttempts[0]!.classification).toBe("CONFIRMED_SUCCESS");
    expect(facts.interruptAttempts[0]!.credit).toBe(1);
    expect(facts.interruptAttempts[1]!.classification).toBe("UNMATCHED_ATTEMPT");
    expect(facts.interruptAttempts[1]!.credit).toBe(
      UTILITY_V2_INTERRUPT_CREDITS.UNMATCHED_ATTEMPT,
    );
    expect(facts.interruptAttempts[2]!.sourceKind).toBe("OWNED_PET");
    expect(facts.hostileObservability).toBe("ABSENT");
    expect(facts.limitations).toContain(
      "hostile_cast_windows_not_persisted_in_digest",
    );
    expect(facts.limitations).toContain("digest_catalog_coverage_unmeasured");
    expect(facts.catalogCoverage.mechanicCatalogCoverage).toBe(0);
    expect(facts.catalogCoverage.abilityCatalogCoverage).toBe(0);
  });

  it("does not invent VALID_OVERLAP or MATCHED_FAILED from digests", () => {
    const digest = baseDigest({
      utility: {
        hostileCastEvents: [],
        actions: [
          baseAction({
            canonicalActionId: "a1",
            utilityCategory: "INTERRUPT",
            outcome: "ATTEMPT",
            sourceDataset: "Casts",
            evidenceEventTypes: ["cast"],
          }),
        ],
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
    });
    const facts = utilityRunFactSetFromDigest(digest, {
      slotId: "slot-0",
      slotIndex: 0,
    });
    const classes = new Set(facts.interruptAttempts.map((a) => a.classification));
    expect(classes.has("VALID_OVERLAP")).toBe(false);
    expect(classes.has("MATCHED_FAILED")).toBe(false);
  });

  it("keeps movement utility as PERSONAL_MOBILITY and unverified externals off the full support path", () => {
    const digest = baseDigest({
      utility: {
        hostileCastEvents: [],
        actions: [
          baseAction({
            canonicalActionId: "self-mobility",
            utilityCategory: "OTHER_UTILITY",
            outcome: "SUCCESS",
            abilityKey: "blink",
            canonicalName: "Blink",
            primarySpellId: 1953,
            targetActorId: 10,
            evidenceEventTypes: ["cast"],
            sourceDataset: "Casts",
          }),
          baseAction({
            canonicalActionId: "ext-unverified",
            utilityCategory: "EXTERNAL_SUPPORT",
            outcome: "ATTEMPT",
            abilityKey: "blessing-of-protection",
            canonicalName: "Blessing of Protection",
            primarySpellId: 1022,
            evidenceEventTypes: ["cast"],
            sourceDataset: "Casts",
            limitations: ["EXTERNAL_TARGET_CONTEXT_INCOMPLETE"],
          }),
          baseAction({
            canonicalActionId: "ext-applied",
            utilityCategory: "EXTERNAL_SUPPORT",
            outcome: "SUCCESS",
            abilityKey: "blessing-of-protection",
            canonicalName: "Blessing of Protection",
            primarySpellId: 1022,
            evidenceEventTypes: ["applybuff"],
            sourceDataset: "Buffs",
            targetActorId: 11,
            rawTimestampMs: 40_000,
          }),
        ],
        capabilityCompleteness: [],
        completeness: "COMPLETE",
        limitations: [],
      },
    });
    const facts = utilityRunFactSetFromDigest(digest, {
      slotId: "slot-0",
      slotIndex: 0,
    });
    const mobility = facts.supportActions.find((a) => a.id === "self-mobility");
    expect(mobility?.semantic).toBe("PERSONAL_MOBILITY");
    const unverified = facts.supportActions.find((a) => a.id === "ext-unverified")!;
    const applied = facts.supportActions.find((a) => a.id === "ext-applied")!;
    expect(unverified.tier).toBe("UNVERIFIED");
    expect(unverified.semantic).toBe("UNVERIFIED_EXTERNAL");
    expect(applied.tier).toBe("CONFIRMED_APPLICATION");
    expect(applied.semantic).toBe("REACTIVE_SUPPORT");
  });

  it("uses catalog toolkit so zero observed actions stay applicable (not N/A)", () => {
    const digest = baseDigest();
    const facts = utilityRunFactSetFromDigest(digest, {
      slotId: "slot-0",
      slotIndex: 0,
    });
    expect(facts.interruptAttempts).toHaveLength(0);
    expect(facts.supportActions).toHaveLength(0);
    expect(facts.ccActions).toHaveLength(0);
    // Mage Fire has Counterspell.
    expect(facts.toolkit.hasInterrupt).toBe(true);
  });

  it("missing utility datasets throw; zero actions with complete digest do not", () => {
    const missing = baseDigest({
      utility: {
        hostileCastEvents: [],
        actions: [],
        capabilityCompleteness: [],
        completeness: "UNAVAILABLE",
        limitations: ["CAPABILITY_UNAVAILABLE:UTILITY_INTERRUPTS"],
      },
    });
    expect(() =>
      utilityRunFactSetFromDigest(missing, { slotId: "s", slotIndex: 0 }),
    ).toThrow(DigestDimensionIncompleteError);

    const zero = baseDigest();
    const facts = utilityRunFactSetFromDigest(zero, { slotId: "s", slotIndex: 0 });
    expect(facts.interruptAttempts).toHaveLength(0);
    expect(facts.limitations).not.toContain("CAPABILITY_UNAVAILABLE:UTILITY_INTERRUPTS");
  });

  it("complete zero-action facts score differently from unavailable compute input", () => {
    const digest = baseDigest();
    const facts = utilityRunFactSetFromDigest(digest, {
      slotId: "slot-a",
      slotIndex: 0,
    });
    const identity = {
      reportCode: digest.reportCode,
      fightId: digest.fightId,
      reportRevision: digest.reportRevision,
    };
    const zeroResult = computeUtilityV2({
      manifest: {
        contentHash: "m".repeat(64),
        schemaVersion: "evidence-manifest-v2",
        expectedSlotCount: 1,
        selectedSlotCount: 1,
        activeDungeonSlugs: ["skyreach"],
        slots: [
          {
            slotId: "slot-a",
            dungeonSlug: "skyreach",
            slotIndex: 0,
            state: "SELECTED",
            identity,
          },
        ],
      },
      factSets: [facts],
    });
    const unavailable = computeUtilityV2({
      manifest: {
        contentHash: "m".repeat(64),
        schemaVersion: "evidence-manifest-v2",
        expectedSlotCount: 1,
        selectedSlotCount: 1,
        activeDungeonSlugs: ["skyreach"],
        slots: [
          {
            slotId: "slot-a",
            dungeonSlug: "skyreach",
            slotIndex: 0,
            state: "SELECTED",
            identity,
          },
        ],
      },
      factSets: [],
    });
    expect(zeroResult.score).not.toBeNull();
    expect(zeroResult.availabilityState).not.toBe("UNAVAILABLE");
    expect(unavailable.score).toBeNull();
    expect(unavailable.availabilityState).toBe("UNAVAILABLE");
    expect(zeroResult.score).not.toBe(unavailable.score);
  });

  it("does not double-count identical interrupt digests as two successes without duplicate ids", () => {
    const digest = baseDigest({
      utility: {
        hostileCastEvents: [],
        actions: [
          baseAction({
            canonicalActionId: "kick-1",
            utilityCategory: "INTERRUPT",
            outcome: "SUCCESS",
          }),
        ],
        capabilityCompleteness: [
          {
            capability: "UTILITY_INTERRUPTS",
            status: "COMPLETE",
            requiredDatasets: ["Interrupts"],
            presentDatasets: ["Interrupts"],
            incompleteDatasets: [],
            limitations: [],
          },
        ],
        completeness: "COMPLETE",
        limitations: [],
      },
    });
    const facts = utilityRunFactSetFromDigest(digest, {
      slotId: "slot-0",
      slotIndex: 0,
    });
    expect(facts.interruptAttempts).toHaveLength(1);
    expect(emptyUtilityV2FactSet).toBeTypeOf("function");
  });
});
