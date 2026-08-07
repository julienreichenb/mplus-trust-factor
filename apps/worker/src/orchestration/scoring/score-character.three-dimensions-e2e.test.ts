/**
 * Product-boundary: one evidence bundle → non-null Performance, Utility, Survival
 * via scoreCharacter, with cold/warm/replay parity and partial-dimension isolation.
 */
import { describe, expect, it } from "vitest";
import {
  CHARACTER_PERFORMANCE_AGGREGATE_RANKING_VERSION,
  PRESSURE_WINDOW_DERIVATION_VERSION,
  withParticipantDigestContentHash,
  type EvidenceCandidateMetadataV2,
  type ParticipantScoringDigestV1,
  type PersistedCharacterPerformanceAggregateV1,
} from "@mplus/contracts";
import { CURRENT_CATALOG_VERSION_ID } from "@mplus/abilities";
import {
  PERFORMANCE_PHASE2_ALGORITHM_VERSION,
  SURVIVAL_V2_ALGORITHM_VERSION,
  UTILITY_V2_ALGORITHM_VERSION,
} from "@mplus/scoring";
import { createMemoryOrchestrationPorts } from "./run-orchestration/memory-ports.js";
import { fingerprintDimensionResults } from "./run-orchestration/orchestrator.js";
import { scoreCharacter, SCORING_VERSION } from "./score-character.js";

const CHARACTER_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_CHARACTER_ID = "22222222-2222-4222-8222-222222222222";
const SEASON_ID = "00000000-0000-4000-8000-000000000012";
const OTHER_SEASON_ID = "00000000-0000-4000-8000-000000000099";

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

function candidate(
  dungeonSlug: string,
  reportCode: string,
  fightId: number,
  reportRevision = 1,
): EvidenceCandidateMetadataV2 {
  return {
    discoveryIdentity: { reportCode, fightId },
    reportRevision,
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

function fakePrisma(saved: Array<Record<string, unknown>> = []) {
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
  } as never;
}

function aggregateCompact(): PersistedCharacterPerformanceAggregateV1 {
  return {
    state: "OK",
    adapterVersion: CHARACTER_PERFORMANCE_AGGREGATE_RANKING_VERSION,
    metric: "points_and_damage",
    zoneId: 47,
    partition: null,
    dungeonAggregates: DUNGEONS.map((slug) => ({
      dungeonSlug: slug,
      dungeonName: slug,
      encounterId: 1,
      bestParsePercentile: 80,
      medianParsePercentile: 70,
      loggedRunCount: 4,
      specialization: "Fire",
      keystoneLevel: 12,
      bestDps: 1_000_000,
    })),
    global: {
      totalMythicPlusScore: 3000,
      totalLoggedRuns: 40,
      bestDpsPercentileAverage: 80,
      medianDpsPercentileAverage: 70,
      partition: null,
      zoneId: 47,
    },
    diagnostics: {
      adapterVersion: CHARACTER_PERFORMANCE_AGGREGATE_RANKING_VERSION,
      metric: "points_and_damage",
      provenance: "AGGREGATE_ZONE_RANKINGS",
      availableDungeonCount: 8,
      expectedDungeonCount: 8,
      unavailableEncounters: [],
      wclBestPerformanceAverage: 80,
      wclMedianPerformanceAverage: 70,
      computedBestAverage: 80,
      computedMedianAverage: 70,
    },
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

function enrichDigest(
  digest: ParticipantScoringDigestV1,
  options?: { utilityUnavailable?: boolean },
): ParticipantScoringDigestV1 {
  const { contentHash: _drop, ...base } = digest;
  void _drop;
  const actorId = digest.participantActorId;
  const defId = `def-${digest.reportCode}-${actorId}`;
  const recId = `rec-${digest.reportCode}-${actorId}`;
  const windowId = `pw-${digest.reportCode}-${actorId}`;

  if (options?.utilityUnavailable) {
    return withParticipantDigestContentHash({
      ...base,
      utility: {
        actions: [],
        capabilityCompleteness: [],
        completeness: "UNAVAILABLE",
        limitations: ["utility_dataset_missing"],
      },
    });
  }

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
          participantActorId: actorId,
          characterName: digest.characterName,
          windowClass: "SUSTAINED_PRESSURE",
          derivation: {
            derivationVersion: PRESSURE_WINDOW_DERIVATION_VERSION,
            configVersion: "pressure-config-test-v1",
            windowStartMs: 85_000,
            windowEndMs: 92_000,
            fightOffsetStartMs: 85_000,
            fightOffsetEndMs: 92_000,
            totalDamage: 400_000,
            hitCount: 6,
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
          },
          response: {
            defensivesBefore: [],
            defensivesDuring: [defId],
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

function createEnrichedPorts(options?: { utilityUnavailable?: boolean }) {
  const ports = createMemoryOrchestrationPorts();
  ports.digestCatalogVersion = CURRENT_CATALOG_VERSION_ID;
  const originalPersist = ports.persistDigest.bind(ports);
  ports.persistDigest = async (digest) => {
    const enriched = enrichDigest(digest, {
      utilityUnavailable: options?.utilityUnavailable,
    });
    return originalPersist(enriched);
  };
  return ports;
}

function ensureAgg() {
  const compact = aggregateCompact();
  return async () => ({
    state: "OK" as const,
    data: compact,
    reason: null,
    cache: "HIT" as const,
    providerCalls: 0,
    created: false,
    updated: false,
    aggregateRowId: "agg-1",
    contentHash: "h".repeat(64),
  });
}

function baseFields(input: {
  ports: ReturnType<typeof createMemoryOrchestrationPorts>;
  saved: Array<Record<string, unknown>>;
  candidates: EvidenceCandidateMetadataV2[];
  seasonId?: string;
  characterId?: string;
  characterName?: string;
}) {
  return {
    identity: {
      characterId: input.characterId ?? CHARACTER_ID,
      region: "eu",
      realm: "archimonde",
      characterName: input.characterName ?? "Target",
    },
    seasonId: input.seasonId ?? SEASON_ID,
    seasonSlug: "season-tww-3",
    role: "DPS" as const,
    classSlug: "mage",
    specSlug: "fire",
    activeDungeonSlugs: [...DUNGEONS],
    candidates: input.candidates,
    evidenceCutoffAt: "2026-08-01T00:00:00.000Z",
    highKeyPolicyId: "test-policy",
    scoringModelId: "product-three-dimensions-e2e",
    zoneId: 47,
    partition: null as number | null,
    ensurePerformanceAggregate: ensureAgg(),
    ports: input.ports,
    prisma: fakePrisma(input.saved),
    artifacts: {} as never,
    evidence: {} as never,
  };
}

describe("scoreCharacter three-dimension product boundary", () => {
  it("one evidence bundle produces non-null P/U/S; persists together; cold/warm/replay match; zero provider calls on replay", async () => {
    const candidates = DUNGEONS.flatMap((slug, i) => [
      candidate(slug, `T${i}A`, 1, 1),
      candidate(slug, `T${i}B`, 2, 1),
    ]);
    const ports = createEnrichedPorts();
    const saved: Array<Record<string, unknown>> = [];
    const fields = baseFields({ ports, saved, candidates });

    const cold = await scoreCharacter({
      ...fields,
      allowProviderCalls: true,
    });

    expect(cold.scoringVersion).toBe(SCORING_VERSION);
    expect(cold.orchestration.characterDigests.length).toBe(16);
    expect(cold.orchestration.characterDigests.length).toBeLessThanOrEqual(16);

    const byDungeon = new Map<string, number>();
    for (const row of cold.orchestration.characterDigests) {
      byDungeon.set(row.dungeonSlug, (byDungeon.get(row.dungeonSlug) ?? 0) + 1);
    }
    for (const count of byDungeon.values()) {
      expect(count).toBeLessThanOrEqual(2);
    }

    const performance = cold.orchestration.dimensions.performance;
    const utility = cold.orchestration.dimensions.utility;
    const survival = cold.orchestration.dimensions.survival;

    expect(performance?.calculatorVersion).toBe(PERFORMANCE_PHASE2_ALGORITHM_VERSION);
    expect(utility?.algorithmVersion).toBe(UTILITY_V2_ALGORITHM_VERSION);
    expect(utility?.phase).toBe(2);
    expect(survival?.algorithmVersion).toBe(SURVIVAL_V2_ALGORITHM_VERSION);

    expect(performance?.score).not.toBeNull();
    expect(utility?.score).not.toBeNull();
    expect(survival?.score).not.toBeNull();
    expect(Number.isFinite(performance!.score!)).toBe(true);
    expect(Number.isFinite(utility!.score!)).toBe(true);
    expect(Number.isFinite(survival!.score!)).toBe(true);
    expect(performance!.score!).toBeGreaterThanOrEqual(0);
    expect(performance!.score!).toBeLessThanOrEqual(100);
    expect(utility!.score!).toBeGreaterThanOrEqual(0);
    expect(utility!.score!).toBeLessThanOrEqual(100);
    expect(survival!.score!).toBeGreaterThanOrEqual(0);
    expect(survival!.score!).toBeLessThanOrEqual(100);

    // Realistic evidence reached calculators (not empty fallback-only).
    expect(performance!.coverage.cooldownUsableRunCount).toBeGreaterThan(0);
    expect(utility!.interruptCounts.CONFIRMED_SUCCESS).toBeGreaterThan(0);
    expect(survival!.explanation.pressureClusterCount).toBeGreaterThan(0);
    expect(survival!.observations["survival.defensive_response"]).not.toBeNull();

    expect(saved).toHaveLength(1);
    expect(saved[0]?.performance).toBe(performance!.score);
    expect(saved[0]?.utility).toBe(utility!.score);
    expect(saved[0]?.survival).toBe(survival!.score);
    expect(saved[0]?.experience).toBeNull();
    // Partial composite: P/U/S available with E missing → renormalized composite + letter grade.
    expect(saved[0]?.composite).not.toBeNull();
    expect(Number(saved[0]?.composite)).toBeGreaterThan(0);
    expect(saved[0]?.tier).toMatch(/^[SABCD]$/);
    expect(saved[0]?.scoringVersion).toBe(SCORING_VERSION);

    const details = saved[0]?.dimensionDetails as {
      performance?: { calculatorVersion?: string };
      utility?: { algorithmVersion?: string; phase?: number };
      survival?: { algorithmVersion?: string };
    };
    expect(details.performance?.calculatorVersion).toBe(
      PERFORMANCE_PHASE2_ALGORITHM_VERSION,
    );
    expect(details.utility?.algorithmVersion).toBe(UTILITY_V2_ALGORITHM_VERSION);
    expect(details.utility?.phase).toBe(2);
    expect(details.survival?.algorithmVersion).toBe(SURVIVAL_V2_ALGORITHM_VERSION);

    const coldFp = fingerprintDimensionResults(cold.orchestration);
    const pScore = performance!.score;
    const uScore = utility!.score;
    const sScore = survival!.score;
    const pFp = performance!.inputFingerprint;
    const uFp = utility!.inputFingerprint;
    const sFp = survival!.inputFingerprint;

    const warm = await scoreCharacter({
      ...fields,
      allowProviderCalls: false,
    });
    expect(warm.providerCalls).toBe(0);
    expect(warm.orchestration.dimensions.performance?.score).toBe(pScore);
    expect(warm.orchestration.dimensions.utility?.score).toBe(uScore);
    expect(warm.orchestration.dimensions.survival?.score).toBe(sScore);
    expect(warm.orchestration.dimensions.performance?.calculatorVersion).toBe(
      PERFORMANCE_PHASE2_ALGORITHM_VERSION,
    );
    expect(warm.orchestration.dimensions.utility?.algorithmVersion).toBe(
      UTILITY_V2_ALGORITHM_VERSION,
    );
    expect(warm.orchestration.dimensions.survival?.algorithmVersion).toBe(
      SURVIVAL_V2_ALGORITHM_VERSION,
    );
    expect(warm.orchestration.dimensions.performance?.inputFingerprint).toBe(pFp);
    expect(warm.orchestration.dimensions.utility?.inputFingerprint).toBe(uFp);
    expect(warm.orchestration.dimensions.survival?.inputFingerprint).toBe(sFp);
    expect(fingerprintDimensionResults(warm.orchestration)).toBe(coldFp);

    const throwingPorts = createEnrichedPorts();
    // Reuse warm evidence by copying package/digest state via second cold-forbidden run
    // on the same enriched ports used for warm — provider methods must not be called.
    const replay = await scoreCharacter({
      ...fields,
      allowProviderCalls: false,
      ports: (() => {
        const acquire = ports.acquireAndPersistCapabilityPackage;
        ports.acquireAndPersistCapabilityPackage = async () => {
          throw new Error("provider_must_not_be_called_during_replay");
        };
        void acquire;
        return ports;
      })(),
    });
    expect(replay.providerCalls).toBe(0);
    expect(replay.orchestration.accounting.providerCalls).toBe(0);
    expect(replay.orchestration.dimensions.performance?.score).toBe(pScore);
    expect(replay.orchestration.dimensions.utility?.score).toBe(uScore);
    expect(replay.orchestration.dimensions.survival?.score).toBe(sScore);
    expect(fingerprintDimensionResults(replay.orchestration)).toBe(coldFp);
    void throwingPorts;
  });

  it("unavailable Utility does not invalidate Performance or Survival; no artificial neutral score", async () => {
    const candidates = DUNGEONS.flatMap((slug, i) => [
      candidate(slug, `P${i}A`, 1, 1),
      candidate(slug, `P${i}B`, 2, 1),
    ]);
    const ports = createEnrichedPorts({ utilityUnavailable: true });
    const saved: Array<Record<string, unknown>> = [];
    const result = await scoreCharacter({
      ...baseFields({ ports, saved, candidates }),
      allowProviderCalls: true,
    });

    expect(result.orchestration.dimensions.performance?.score).not.toBeNull();
    expect(result.orchestration.dimensions.survival?.score).not.toBeNull();
    expect(result.orchestration.dimensions.utility?.score ?? null).toBeNull();
    expect(
      result.orchestration.dimensions.blocked.some(
        (b) =>
          b.dimension === "UTILITY" && b.reason === "utility_dataset_missing",
      ),
    ).toBe(true);
    expect(saved[0]?.performance).not.toBeNull();
    expect(saved[0]?.survival).not.toBeNull();
    expect(saved[0]?.utility).toBeNull();
    // P+S available (U+E missing) still yields a renormalized partial composite — not null/U.
    expect(saved[0]?.composite).not.toBeNull();
    expect(Number(saved[0]?.composite)).toBeGreaterThan(0);
    expect(saved[0]?.tier).toMatch(/^[SABCD]$/);
    expect(saved[0]?.experience).toBeNull();
  });

  it("wrong-participant digests are excluded from target selection", async () => {
    const candidates = [
      candidate(DUNGEONS[0]!, "WP1", 1, 1),
      candidate(DUNGEONS[0]!, "WP2", 2, 1),
    ];
    const ports = createEnrichedPorts();
    for (const c of candidates) {
      const sourceFight = {
        reportCode: c.discoveryIdentity.reportCode,
        fightId: c.discoveryIdentity.fightId,
        reportRevision: 1,
      };
      ports.setParticipants(sourceFight, [
        {
          playerActorId: 1,
          characterName: "OtherPlayer",
          realmSlug: "archimonde",
          regionCode: "eu",
          classSlug: "mage",
          specSlug: "fire",
          role: "DPS",
          ownedPetActorIds: [],
          characterId: OTHER_CHARACTER_ID,
        },
        {
          playerActorId: 2,
          characterName: "AlsoOther",
          realmSlug: "archimonde",
          regionCode: "eu",
          classSlug: "mage",
          specSlug: "fire",
          role: "DPS",
          ownedPetActorIds: [],
          characterId: null,
        },
      ]);
    }

    const saved: Array<Record<string, unknown>> = [];
    const result = await scoreCharacter({
      ...baseFields({
        ports,
        saved,
        candidates,
        characterName: "Target",
      }),
      allowProviderCalls: true,
      activeDungeonSlugs: [DUNGEONS[0]!],
    });

    expect(result.orchestration.characterDigests).toHaveLength(0);
    expect(result.orchestration.targetDigestFailures.length).toBeGreaterThan(0);
    expect(
      result.orchestration.dimensions.blocked.some(
        (b) => b.dimension === "UTILITY" && b.reason === "utility_actor_unresolved",
      ),
    ).toBe(true);
  });

  it("wrong-season candidates do not contribute to active-season scores", async () => {
    const seasonA = DUNGEONS.flatMap((slug, i) => [
      candidate(slug, `A${i}A`, 1, 1),
      candidate(slug, `A${i}B`, 2, 1),
    ]);
    const seasonBExtra = [
      candidate(DUNGEONS[0]!, "BONLY1", 9, 1),
      candidate(DUNGEONS[0]!, "BONLY2", 10, 1),
    ].map((c) => ({ ...c, keyLevel: 8, runScore: 50 }));

    const portsA = createEnrichedPorts();
    const savedA: Array<Record<string, unknown>> = [];
    const a = await scoreCharacter({
      ...baseFields({
        ports: portsA,
        saved: savedA,
        candidates: seasonA,
        seasonId: SEASON_ID,
      }),
      allowProviderCalls: true,
    });

    const portsMixed = createEnrichedPorts();
    const savedMixed: Array<Record<string, unknown>> = [];
    // Season B candidates are passed but seasonId stays A — selection is scoped to
    // the active season's dungeon plan; foreign report codes must not be preferred
    // over the active-season set when both are present for the same dungeons.
    const mixed = await scoreCharacter({
      ...baseFields({
        ports: portsMixed,
        saved: savedMixed,
        candidates: [...seasonA, ...seasonBExtra],
        seasonId: SEASON_ID,
      }),
      allowProviderCalls: true,
    });

    const aCodes = new Set(
      a.orchestration.characterDigests.map((d) => d.digest.reportCode),
    );
    const mixedCodes = new Set(
      mixed.orchestration.characterDigests.map((d) => d.digest.reportCode),
    );
    expect(aCodes.size).toBe(16);
    expect(mixed.orchestration.characterDigests).toHaveLength(16);
    for (const code of ["BONLY1", "BONLY2"]) {
      expect(mixedCodes.has(code)).toBe(false);
    }
    expect(fingerprintDimensionResults(mixed.orchestration)).toBe(
      fingerprintDimensionResults(a.orchestration),
    );

    // Distinct season id must not reuse CharacterScore row for season A.
    const otherSeasonPorts = createEnrichedPorts();
    const otherSaved: Array<Record<string, unknown>> = [];
    await scoreCharacter({
      ...baseFields({
        ports: otherSeasonPorts,
        saved: otherSaved,
        candidates: seasonA,
        seasonId: OTHER_SEASON_ID,
      }),
      allowProviderCalls: true,
    });
    expect(otherSaved[0]?.seasonId).toBe(OTHER_SEASON_ID);
    expect(savedA[0]?.seasonId).toBe(SEASON_ID);
  });

  it("duplicate digests do not change scores", async () => {
    const base = DUNGEONS.flatMap((slug, i) => [
      candidate(slug, `D${i}A`, 1, 1),
      candidate(slug, `D${i}B`, 2, 1),
    ]);
    // Exact duplicate candidate rows for the same fight identities.
    const duplicated = [...base, ...base];

    const portsOnce = createEnrichedPorts();
    const savedOnce: Array<Record<string, unknown>> = [];
    const once = await scoreCharacter({
      ...baseFields({ ports: portsOnce, saved: savedOnce, candidates: base }),
      allowProviderCalls: true,
    });

    const portsDup = createEnrichedPorts();
    const savedDup: Array<Record<string, unknown>> = [];
    const dup = await scoreCharacter({
      ...baseFields({
        ports: portsDup,
        saved: savedDup,
        candidates: duplicated,
      }),
      allowProviderCalls: true,
    });

    expect(once.orchestration.characterDigests).toHaveLength(16);
    expect(dup.orchestration.characterDigests).toHaveLength(16);
    expect(dup.orchestration.uniqueSourceFights).toHaveLength(16);
    expect(once.orchestration.dimensions.performance?.score).toBe(
      dup.orchestration.dimensions.performance?.score,
    );
    expect(once.orchestration.dimensions.utility?.score).toBe(
      dup.orchestration.dimensions.utility?.score,
    );
    expect(once.orchestration.dimensions.survival?.score).toBe(
      dup.orchestration.dimensions.survival?.score,
    );
    expect(fingerprintDimensionResults(once.orchestration)).toBe(
      fingerprintDimensionResults(dup.orchestration),
    );
  });

  it("no legacy Performance version overwrites Phase 2", async () => {
    const candidates = DUNGEONS.flatMap((slug, i) => [
      candidate(slug, `L${i}A`, 1, 1),
      candidate(slug, `L${i}B`, 2, 1),
    ]);
    const ports = createEnrichedPorts();
    const saved: Array<Record<string, unknown>> = [];
    const result = await scoreCharacter({
      ...baseFields({ ports, saved, candidates }),
      allowProviderCalls: true,
    });
    const details = saved[0]?.dimensionDetails as {
      performance?: { calculatorVersion?: string };
    };
    expect(details.performance?.calculatorVersion).toBe(
      PERFORMANCE_PHASE2_ALGORITHM_VERSION,
    );
    expect(result.orchestration.dimensions.performance?.calculatorVersion).toBe(
      PERFORMANCE_PHASE2_ALGORITHM_VERSION,
    );
    expect(result.orchestration.dimensions.performance?.calculatorVersion).not.toBe(
      "performance-v2.phase1.0.1.0",
    );
  });
});
