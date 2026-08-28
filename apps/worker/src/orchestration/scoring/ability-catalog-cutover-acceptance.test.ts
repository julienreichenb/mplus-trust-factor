/**
 * Phase 3B.6 — full Trust acceptance via scoreCharacter (not digest Trust replay).
 * STATIC pin vs explicit Bootstrap RELEASE pin: semantic scores equal; identity differs.
 */

import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import {
  withParticipantDigestContentHash,
  createStaticAbilityCatalogPin,
  type AbilityCatalogExecutionPin,
  type EvidenceCandidateMetadataV2,
  type ParticipantScoringDigestV1,
} from "@mplus/contracts";
import { CURRENT_CATALOG_VERSION_ID } from "@mplus/abilities";
import {
  compileBootstrapRelease0,
  serializeSemanticReleaseContentBytes,
  casHashOfSemanticBytes,
} from "@mplus/abilities/release";
import type { ExperiencePhase1Result } from "@mplus/scoring";
import { createMemoryOrchestrationPorts } from "./run-orchestration/memory-ports.js";
import { buildTestEnsurePerformanceAggregateResult } from "./run-orchestration/test-fixtures.js";
import { clearAbilityCatalogReleaseContextCache } from "./ability-catalog-pin-loader.js";
import { scoreCharacter } from "./score-character.js";

const CHARACTER_ID = "11111111-1111-4111-8111-111111111111";
const SEASON_ID = "00000000-0000-4000-8000-000000000012";
const BOOTSTRAP_RELEASE_ID = "d68793e5-7389-4cd6-b4c2-2eec96bea068";
const BOOTSTRAP_DIGEST =
  "fe8c9a031e0cd4841f27ed55a87b44cd7c3b0af483fb068d7e432a57b189c761";
const BOOTSTRAP_KEY = "wow-unknown-static/catalog-v1/fe8c9a03";

const DUNGEONS = [
  "ara-kara",
  "city-of-threads",
  "the-dawnbreaker",
  "the-stonevault",
  "mists-of-tirna-scithe",
  "the-necrotic-wake",
  "siege-of-boralus",
  "grim-batol",
] as const;

const releasePin: AbilityCatalogExecutionPin = {
  kind: "RELEASE",
  releaseId: BOOTSTRAP_RELEASE_ID,
  releaseKey: BOOTSTRAP_KEY,
  contentDigest: BOOTSTRAP_DIGEST,
  schemaVersion: "ability-catalog-release-v1",
};

const experience: ExperiencePhase1Result = {
  score: 72,
  available: true,
  confidence: 1,
  confidenceCauses: [],
  previousStandingScore: 72,
  classRankFloor: null,
  classRankFloorApplied: false,
  eliteFloorApplied: false,
  confirmedEliteTitleCount: 0,
  reason: null,
};

function candidate(
  dungeonSlug: string,
  reportCode: string,
  fightId: number,
): EvidenceCandidateMetadataV2 {
  return {
    discoveryIdentity: { reportCode, fightId },
    reportRevision: 1,
    dungeonSlug,
    keyLevel: 12,
    timed: true,
    runScore: 200,
    evidenceCompleteness: 1,
    completedAt: "2026-01-01T00:00:00.000Z",
    fightDurationMs: 1_800_000,
    actorId: 1,
    accessState: "PUBLIC",
    identityResolution: "RESOLVED",
    fightAccessible: true,
    hardError: false,
    discoverySource: "test",
  };
}

function utilityCaps() {
  return [
    {
      capability: "UTILITY_INTERRUPTS" as const,
      status: "COMPLETE" as const,
      requiredDatasets: ["Interrupts"],
      presentDatasets: ["Interrupts"],
      incompleteDatasets: [],
      limitations: [],
    },
    {
      capability: "UTILITY_DISPELS" as const,
      status: "COMPLETE" as const,
      requiredDatasets: ["Dispels"],
      presentDatasets: ["Dispels"],
      incompleteDatasets: [],
      limitations: [],
    },
    {
      capability: "UTILITY_CROWD_CONTROL" as const,
      status: "COMPLETE" as const,
      requiredDatasets: ["Casts"],
      presentDatasets: ["Casts"],
      incompleteDatasets: [],
      limitations: [],
    },
    {
      capability: "UTILITY_EXTERNAL_CASTS" as const,
      status: "COMPLETE" as const,
      requiredDatasets: ["Casts"],
      presentDatasets: ["Casts"],
      incompleteDatasets: [],
      limitations: [],
    },
    {
      capability: "UTILITY_EXTERNAL_TARGET_CONTEXT" as const,
      status: "COMPLETE" as const,
      requiredDatasets: ["Buffs"],
      presentDatasets: ["Buffs"],
      incompleteDatasets: [],
      limitations: [],
    },
  ];
}

function survivalCaps() {
  return [
    {
      capability: "SURVIVAL_DEATHS" as const,
      status: "COMPLETE" as const,
      requiredDatasets: ["Deaths"],
      presentDatasets: ["Deaths"],
      incompleteDatasets: [],
      limitations: [],
    },
    {
      capability: "SURVIVAL_DAMAGE_TAKEN" as const,
      status: "COMPLETE" as const,
      requiredDatasets: ["DamageTaken"],
      presentDatasets: ["DamageTaken"],
      incompleteDatasets: [],
      limitations: [],
    },
    {
      capability: "SURVIVAL_DEFENSIVE_ACTIVATIONS" as const,
      status: "COMPLETE" as const,
      requiredDatasets: ["Casts", "Buffs"],
      presentDatasets: ["Casts", "Buffs"],
      incompleteDatasets: [],
      limitations: [],
    },
    {
      capability: "SURVIVAL_RECOVERY_ACTIVATIONS" as const,
      status: "COMPLETE" as const,
      requiredDatasets: ["Casts", "Buffs"],
      presentDatasets: ["Casts", "Buffs"],
      incompleteDatasets: [],
      limitations: [],
    },
  ];
}

/** Inject frozen Shadowmeld activation shape (from FX29tqHvg6AZPRWm racial evidence). */
function enrichDigest(digest: ParticipantScoringDigestV1): ParticipantScoringDigestV1 {
  const { contentHash: _drop, ...base } = digest;
  void _drop;
  const actorId = digest.participantActorId;
  const defId = `def-${digest.reportCode}-${actorId}`;
  const racialId = `racial-shadowmeld-${digest.reportCode}-${actorId}`;
  const recId = `rec-${digest.reportCode}-${actorId}`;
  const windowId = `pw-${digest.reportCode}-${actorId}`;

  return withParticipantDigestContentHash({
    ...base,
    classSlug: "mage",
    specSlug: "fire",
    role: "DPS",
    catalogVersion: CURRENT_CATALOG_VERSION_ID,
    performance: {
      ...digest.performance,
      parsePercentile: digest.performance.parsePercentile ?? 80,
      parseSemantic:
        digest.performance.parseSemantic === "UNAVAILABLE"
          ? "BRACKET_PERCENT"
          : digest.performance.parseSemantic,
      offensiveActivations: [
        {
          activationId: `off-${digest.reportCode}-${actorId}`,
          canonicalKey: "mage.offensive.combustion",
          primarySpellId: 190319,
          observedSpellIds: [190319],
          timestampMs: 45_000,
          fightOffsetMs: 45_000,
          rawMatchedEventCount: 2,
          contributingSpellIds: [190319],
        },
      ],
      completeness: "COMPLETE",
      limitations: [],
    },
    utility: {
      hostileCastEvents: [],
      actions: [
        {
          canonicalActionId: `int-${digest.reportCode}-${actorId}`,
          abilityKey: "mage.interrupt.counterspell",
          canonicalName: "Counterspell",
          primarySpellId: 2139,
          observedSpellIds: [2139],
          utilityCategory: "INTERRUPT",
          reportCode: digest.reportCode,
          fightId: digest.fightId,
          reportRevision: digest.reportRevision,
          dungeonSlug: digest.dungeonSlug,
          rawTimestampMs: 60_000,
          fightOffsetMs: 60_000,
          sourceActorId: actorId,
          ownerActorId: actorId,
          targetActorId: 99,
          sourceCharacterName: digest.characterName,
          targetCharacterName: null,
          sourceClassSlug: "mage",
          sourceSpecSlug: "fire",
          sourceDataset: "Interrupts",
          evidenceEventTypes: ["interrupt"],
          outcome: "SUCCESS",
          attributedToPet: false,
          petActorId: null,
          limitations: [],
          catalogVersion: digest.catalogVersion,
          normalizerVersion: "utility-action-normalizer-v1",
        },
      ],
      capabilityCompleteness: utilityCaps(),
      completeness: "COMPLETE",
      limitations: [],
    },
    survival: {
      damageTakenTotal: 2_500_000,
      damageTakenEventCount: 40,
      deaths: [],
      personalDefensiveActivations: [
        {
          canonicalActivationId: defId,
          abilityKey: "mage.immunity.ice-block",
          canonicalName: "Ice Block",
          primarySpellId: 45438,
          observedSpellIds: [45438],
          activationKind: "PERSONAL_DEFENSIVE",
          defensiveCategory: "IMMUNITY",
          reportCode: digest.reportCode,
          fightId: digest.fightId,
          reportRevision: digest.reportRevision,
          participantActorId: actorId,
          sourceActorId: actorId,
          targetActorId: actorId,
          casterActorId: actorId,
          recipientActorId: actorId,
          sourceCharacterName: digest.characterName,
          targetCharacterName: digest.characterName,
          casterCharacterName: digest.characterName,
          recipientCharacterName: digest.characterName,
          sourceClassSlug: "mage",
          sourceSpecSlug: "fire",
          rawTimestampMs: 90_000,
          fightOffsetMs: 90_000,
          activationSource: "CAST_AND_BUFF",
          sourceDataset: "Casts",
          evidenceEventTypes: ["cast", "applybuff"],
          evidenceEventIds: [`e-def-${actorId}`],
          attributedToPet: false,
          petActorId: null,
          creditsSurvivalUsageToRecipient: true,
          creditsCasterForUtility: false,
          relatedPressureWindowId: windowId,
          responseRelation: "DURING_PRESSURE",
          limitations: [],
          catalogVersion: digest.catalogVersion,
          normalizerVersion: "survival-action-normalizer-v1",
        },
        {
          canonicalActivationId: racialId,
          abilityKey: "shared.racial.shadowmeld",
          canonicalName: "Shadowmeld",
          primarySpellId: 58984,
          observedSpellIds: [58984],
          activationKind: "PERSONAL_DEFENSIVE",
          defensiveCategory: "IMMUNITY",
          reportCode: digest.reportCode,
          fightId: digest.fightId,
          reportRevision: digest.reportRevision,
          participantActorId: actorId,
          sourceActorId: actorId,
          targetActorId: actorId,
          casterActorId: actorId,
          recipientActorId: actorId,
          sourceCharacterName: digest.characterName,
          targetCharacterName: digest.characterName,
          casterCharacterName: digest.characterName,
          recipientCharacterName: digest.characterName,
          sourceClassSlug: "mage",
          sourceSpecSlug: "fire",
          rawTimestampMs: 92_000,
          fightOffsetMs: 92_000,
          activationSource: "CAST_AND_BUFF",
          sourceDataset: "Casts",
          evidenceEventTypes: ["cast", "applybuff"],
          evidenceEventIds: [`Buffs:1:58984:92000`, `Casts:1:58984:92000`],
          attributedToPet: false,
          petActorId: null,
          creditsSurvivalUsageToRecipient: true,
          creditsCasterForUtility: false,
          relatedPressureWindowId: windowId,
          responseRelation: "DURING_PRESSURE",
          limitations: [],
          catalogVersion: digest.catalogVersion,
          normalizerVersion: "survival-action-normalizer-v1",
        },
      ],
      recoveryActivations: [
        {
          canonicalActivationId: recId,
          abilityKey: "shared.consumable.healthstone",
          canonicalName: "Healthstone",
          primarySpellId: 5512,
          observedSpellIds: [5512],
          activationKind: "RECOVERY",
          defensiveCategory: "CONSUMABLE",
          reportCode: digest.reportCode,
          fightId: digest.fightId,
          reportRevision: digest.reportRevision,
          participantActorId: actorId,
          sourceActorId: actorId,
          targetActorId: actorId,
          casterActorId: actorId,
          recipientActorId: actorId,
          sourceCharacterName: digest.characterName,
          targetCharacterName: digest.characterName,
          casterCharacterName: digest.characterName,
          recipientCharacterName: digest.characterName,
          sourceClassSlug: "mage",
          sourceSpecSlug: "fire",
          rawTimestampMs: 95_000,
          fightOffsetMs: 95_000,
          activationSource: "CAST",
          sourceDataset: "Casts",
          evidenceEventTypes: ["cast"],
          evidenceEventIds: [`e-rec-${actorId}`],
          attributedToPet: false,
          petActorId: null,
          creditsSurvivalUsageToRecipient: true,
          creditsCasterForUtility: false,
          relatedPressureWindowId: windowId,
          responseRelation: "AFTER_PRESSURE_RECOVERY",
          limitations: [],
          catalogVersion: digest.catalogVersion,
          normalizerVersion: "survival-action-normalizer-v1",
        },
      ],
      externalsReceived: [],
      pressureWindows: [
        {
          pressureWindowId: windowId,
          startFightOffsetMs: 85_000,
          endFightOffsetMs: 100_000,
          durationMs: 15_000,
          damageTaken: 400_000,
          peakHitDamage: 90_000,
          rollingWindowMs: 3_000,
          rollingDamageSum: 400_000,
          maxHpUsed: 800_000,
          rollingDamageRatioOfMaxHp: 0.5,
          peakHitRatioOfMaxHp: 0.11,
          sustainedByRollingThreshold: true,
          sustainedByHitDensity: true,
          isolatedByLowAbsoluteDamage: false,
          evidenceEventIds: [`e-dt-${actorId}`],
          response: {
            defensivesBefore: [],
            defensivesDuring: [defId, racialId],
            recoveryAfter: [recId],
            externalDefensivesReceived: [],
            deathEventIds: [],
            noPersonalDefensiveResponse: false,
            noRecoveryResponse: false,
          },
          limitations: [],
        },
      ],
      fightDurationMs: 1_800_000,
      activeCombatMs: 1_500_000,
      capabilityCompleteness: survivalCaps(),
      completeness: "COMPLETE",
      limitations: [],
    },
  });
}

function createEnrichedPorts() {
  const ports = createMemoryOrchestrationPorts();
  ports.digestCatalogVersion = CURRENT_CATALOG_VERSION_ID;
  const originalPersist = ports.persistDigest.bind(ports);
  ports.persistDigest = async (digest) => originalPersist(enrichDigest(digest));
  return ports;
}

function ensureAgg() {
  return buildTestEnsurePerformanceAggregateResult({
    characterId: CHARACTER_ID,
    seasonId: SEASON_ID,
    dungeonSlugs: DUNGEONS,
    role: "DPS",
    targetSpecSlug: "fire",
  });
}

function scorePrisma(
  saved: Array<Record<string, unknown>>,
  releaseCas?: { bytes: Buffer; casHash: string },
) {
  return {
    scoreModel: {
      findUnique: async () => ({ config: {} }),
    },
    characterScore: {
      findUnique: async () => null,
      upsert: async ({ create }: { create: Record<string, unknown> }) => {
        const row = { id: `score-${saved.length + 1}`, ...create };
        saved.push(row);
        return row;
      },
    },
    abilityCatalogRelease: {
      findUnique: async () =>
        releaseCas
          ? {
              id: BOOTSTRAP_RELEASE_ID,
              status: "VALIDATED",
              releaseKey: BOOTSTRAP_KEY,
              contentDigest: BOOTSTRAP_DIGEST,
              schemaVersion: "ability-catalog-release-v1",
              casContentHash: releaseCas.casHash,
              generatedAt: new Date("2026-08-16T12:00:00.000Z"),
            }
          : null,
    },
    rawArtifactPayload: {
      findUnique: async () =>
        releaseCas
          ? { contentHash: releaseCas.casHash, payload: releaseCas.bytes }
          : null,
    },
  } as never;
}

describe("Phase 3B.6 scoreCharacter STATIC vs Bootstrap RELEASE (full Trust)", () => {
  beforeEach(() => {
    clearAbilityCatalogReleaseContextCache();
  });

  it("semantic P/S/U/E/Boost/Trust equal; only catalog execution identity differs", async () => {
    const bootstrap = compileBootstrapRelease0();
    const bytes = serializeSemanticReleaseContentBytes(bootstrap.artifact);
    const casHash = casHashOfSemanticBytes(bytes);
    expect(casHash).toBe(BOOTSTRAP_DIGEST);

    const candidates = DUNGEONS.flatMap((slug, i) => [
      candidate(slug, `C${i}A`, 1),
      candidate(slug, `C${i}B`, 2),
    ]);

    const staticSaved: Array<Record<string, unknown>> = [];
    const releaseSaved: Array<Record<string, unknown>> = [];
    const portsStatic = createEnrichedPorts();
    const portsRelease = createEnrichedPorts();

    const base = {
      identity: {
        characterId: CHARACTER_ID,
        region: "eu",
        realm: "archimonde",
        characterName: "Cutover",
      },
      seasonId: SEASON_ID,
      seasonSlug: "season-tww-3",
      role: "DPS" as const,
      classSlug: "mage",
      specSlug: "fire",
      activeDungeonSlugs: [...DUNGEONS],
      candidates,
      evidenceCutoffAt: "2026-08-01T00:00:00.000Z",
      highKeyPolicyId: "test-policy",
      scoringModelId: "cutover-acceptance",
      zoneId: 47,
      partition: null as number | null,
      ensurePerformanceAggregate: ensureAgg(),
      experience,
      artifacts: {} as never,
      evidence: {} as never,
      allowProviderCalls: false,
    };

    const staticResult = await scoreCharacter({
      ...base,
      ports: portsStatic,
      prisma: scorePrisma(staticSaved),
      abilityCatalogExecutionPin: createStaticAbilityCatalogPin(CURRENT_CATALOG_VERSION_ID),
    });

    clearAbilityCatalogReleaseContextCache();

    const releaseResult = await scoreCharacter({
      ...base,
      ports: portsRelease,
      prisma: scorePrisma(releaseSaved, { bytes, casHash }),
      abilityCatalogExecutionPin: releasePin,
    });

    expect(staticResult.abilityCatalogExecutionPin.kind).toBe("STATIC");
    expect(releaseResult.abilityCatalogExecutionPin.kind).toBe("RELEASE");
    expect(releaseResult.abilityCatalogExecutionPin).toMatchObject({
      releaseId: BOOTSTRAP_RELEASE_ID,
      contentDigest: BOOTSTRAP_DIGEST,
      releaseKey: BOOTSTRAP_KEY,
    });

    expect(staticResult.orchestration.dimensions.performance?.score).toBe(
      releaseResult.orchestration.dimensions.performance?.score,
    );
    expect(staticResult.orchestration.dimensions.survival?.score).toBe(
      releaseResult.orchestration.dimensions.survival?.score,
    );
    expect(staticResult.orchestration.dimensions.utility?.score).toBe(
      releaseResult.orchestration.dimensions.utility?.score,
    );
    expect(staticResult.experience?.score ?? null).toBe(releaseResult.experience?.score ?? null);
    expect(staticResult.boostAssessment?.suspicionScore ?? null).toBe(
      releaseResult.boostAssessment?.suspicionScore ?? null,
    );
    expect(staticSaved[0]?.composite).toBe(releaseSaved[0]?.composite);
    expect(staticSaved[0]?.contextualScore).toBe(releaseSaved[0]?.contextualScore);
    expect(staticSaved[0]?.tier).toBe(releaseSaved[0]?.tier);
    expect(staticSaved[0]?.performance).toBe(releaseSaved[0]?.performance);
    expect(staticSaved[0]?.survival).toBe(releaseSaved[0]?.survival);
    expect(staticSaved[0]?.utility).toBe(releaseSaved[0]?.utility);
    expect(staticSaved[0]?.experience).toBe(releaseSaved[0]?.experience);

    // Identity must differ.
    expect(staticSaved[0]?.abilityCatalogExecutionMode).toBe("STATIC");
    expect(releaseSaved[0]?.abilityCatalogExecutionMode).toBe("RELEASE");
    expect(staticSaved[0]?.abilityCatalogExecutionKey).not.toBe(
      releaseSaved[0]?.abilityCatalogExecutionKey,
    );
    expect(releaseSaved[0]?.abilityCatalogContentDigest).toBe(BOOTSTRAP_DIGEST);

    // Fingerprint scores for return checklist (sha of semantic tuple).
    const semanticTuple = JSON.stringify({
      p: staticSaved[0]?.performance,
      s: staticSaved[0]?.survival,
      u: staticSaved[0]?.utility,
      e: staticSaved[0]?.experience,
      boost: staticResult.boostAssessment?.suspicionScore ?? null,
      trust: staticSaved[0]?.contextualScore ?? staticSaved[0]?.composite,
    });
    expect(createHash("sha256").update(semanticTuple).digest("hex")).toBe(
      createHash("sha256")
        .update(
          JSON.stringify({
            p: releaseSaved[0]?.performance,
            s: releaseSaved[0]?.survival,
            u: releaseSaved[0]?.utility,
            e: releaseSaved[0]?.experience,
            boost: releaseResult.boostAssessment?.suspicionScore ?? null,
            trust: releaseSaved[0]?.contextualScore ?? releaseSaved[0]?.composite,
          }),
        )
        .digest("hex"),
    );
  });
});
