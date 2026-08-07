/**
 * Authoritative character scoring entry point.
 *
 * character → select runs → load/fetch raw → digests → rankings → calculate → persist
 *
 * Ensures CharacterPerformanceAggregate (points_and_damage) once per operation and
 * feeds it into functional Performance Phase 2 (`performance-phase2-v1`) together
 * with selected digests and offensive cooldown discipline.
 */
import {
  CharacterScoreRepository,
  type PrismaClient,
  type ArtifactRepository,
  type EvidenceRepository,
} from "@mplus/database";
import { EVIDENCE_SELECTOR_VERSION } from "@mplus/contracts";
import type { EvidenceCandidateMetadataV2, EvidenceRole, RegionCode } from "@mplus/contracts";
import {
  orchestrateScoringRuns,
  type LiveProviderPermission,
  type RunOrchestrationPorts,
  type RunOrchestrationResult,
} from "./run-orchestration/orchestrator.js";
import {
  createProductionRunOrchestrationPorts,
  SCORING_ACQUISITION_VERSION,
  SCORING_EXTRACTOR_VERSION,
} from "./run-orchestration/production-ports.js";
import {
  createEnsureCharacterPerformanceAggregate,
  type EnsureCharacterPerformanceAggregateResult,
  type FetchCharacterPerformanceAggregateProvider,
} from "./run-orchestration/ensure-performance-aggregate.js";
import {
  requirePositivePerformanceAggregateTtlSeconds,
  requireScoringZoneId,
} from "./scoring-zone.js";
import {
  computePartialComposite,
  defaultSkillDimensionWeights,
  profileAggregateFactFromPersisted,
  resolveTunableWeights,
  trustDimensionWeightsFromTunable,
  type ScoreModelConfigV1,
  type SeasonDifficultyPolicyV2,
} from "@mplus/scoring";

/** Bumped when authoritative Survival Phase 2 product path activates. */
export const SCORING_VERSION =
  "scoring-v1.performance-phase2.utility-phase2.survival-phase2";

/** Default WCL character summary / aggregate TTL (12h) when not overridden. */
const DEFAULT_PERFORMANCE_AGGREGATE_TTL_SECONDS = 43_200;

export interface ScoreCharacterIdentity {
  characterId: string;
  region: string;
  realm: string;
  characterName: string;
}

export interface ScoreCharacterInput {
  identity: ScoreCharacterIdentity;
  seasonId: string;
  seasonSlug: string;
  role: EvidenceRole;
  classSlug: string | null;
  specSlug: string | null;
  activeDungeonSlugs: string[];
  candidates: EvidenceCandidateMetadataV2[];
  evidenceCutoffAt: string;
  highKeyPolicyId: string;
  scoringModelId: string;
  scoringModelVersion?: string | null;
  allowProviderCalls: boolean;
  publicationEnabled?: boolean;
  /**
   * When false, evaluate via orchestrateScoringRuns but do not write CharacterScore.
   * Used by calibration (and similar sinks) so acquisition/evaluation can be shared
   * while score publication stays operational-only. Default true.
   */
  persistCharacterScore?: boolean;
  /**
   * Optional ScoreModel.config override (e.g. frozen DRAFT config on a CalibrationRun).
   * When omitted, config is loaded from `scoringModelId`.
   */
  scoreModelConfig?: Record<string, unknown> | null;
  acquisitionVersion?: string;
  extractorVersion?: string;
  scoringVersion?: string;
  difficultyPolicy?: SeasonDifficultyPolicyV2;
  ports?: RunOrchestrationPorts;
  prisma: PrismaClient;
  artifacts: ArtifactRepository;
  evidence: EvidenceRepository;
  liveAcquire?: Parameters<
    typeof createProductionRunOrchestrationPorts
  >[0]["liveAcquireCapabilityPackage"];
  resolveParticipants?: Parameters<
    typeof createProductionRunOrchestrationPorts
  >[0]["resolveParticipants"];
  resolveFightRoster?: RunOrchestrationPorts["resolveFightRoster"];
  withSourceFightLock?: RunOrchestrationPorts["withSourceFightLock"];
  /** Optional override; defaults to identity fields on this input. */
  targetCharacter?: {
    characterId: string;
    characterName: string;
    realmSlug: string;
    regionCode: string;
    classSlug?: string | null;
    specSlug?: string | null;
    role?: string | null;
  };
  /**
   * Active WCL Mythic+ zone for CharacterPerformanceAggregate.
   * Required positive integer — missing/invalid is configuration failure, not player absence.
   */
  zoneId: number;
  /** WCL partition; null = logical "current". */
  partition?: number | null;
  /** TTL for newly fetched aggregates (seconds). */
  performanceAggregateTtlSeconds?: number;
  /** Dedicated points_and_damage provider (live/fixture). Ignored when provider calls forbidden. */
  performanceAggregateProvider?: FetchCharacterPerformanceAggregateProvider | null;
  /** Test override for ensure port. */
  ensurePerformanceAggregate?: (
    input: Parameters<
      ReturnType<typeof createEnsureCharacterPerformanceAggregate>
    >[0],
  ) => Promise<EnsureCharacterPerformanceAggregateResult>;
  now?: Date;
}

export interface ScoreCharacterPerformanceAggregateExposure {
  state: "AVAILABLE" | "UNAVAILABLE";
  data: EnsureCharacterPerformanceAggregateResult["data"];
  reason: string | null;
  cache: EnsureCharacterPerformanceAggregateResult["cache"];
  providerCalls: number;
  created: boolean;
  updated: boolean;
  aggregateRowId: string | null;
  contentHash: string | null;
}

export interface ScoreCharacterResult {
  orchestration: RunOrchestrationResult;
  characterScoreId: string | null;
  providerCalls: number;
  scoringVersion: string;
  publicationEnabled: boolean;
  /**
   * Character/season points_and_damage aggregate consumed by Performance Phase 2.
   */
  performanceAggregate: ScoreCharacterPerformanceAggregateExposure;
}

export async function scoreCharacter(
  input: ScoreCharacterInput,
): Promise<ScoreCharacterResult> {
  const scoringVersion = input.scoringVersion ?? SCORING_VERSION;
  const liveProviderPermission: LiveProviderPermission = input.allowProviderCalls
    ? "ALLOWED"
    : "FORBIDDEN";
  const now = input.now ?? new Date();

  const ports =
    input.ports ??
    createProductionRunOrchestrationPorts({
      prisma: input.prisma,
      artifacts: input.artifacts,
      evidence: input.evidence,
      acquisitionVersion: input.acquisitionVersion ?? SCORING_ACQUISITION_VERSION,
      extractorVersion: input.extractorVersion ?? SCORING_EXTRACTOR_VERSION,
      liveAcquireCapabilityPackage: input.allowProviderCalls
        ? input.liveAcquire
        : undefined,
      resolveParticipants: input.resolveParticipants,
      resolveFightRoster: input.resolveFightRoster,
      withSourceFightLock: input.withSourceFightLock,
      targetCharacter: input.targetCharacter ?? {
        characterId: input.identity.characterId,
        characterName: input.identity.characterName,
        realmSlug: input.identity.realm,
        regionCode: input.identity.region,
        classSlug: input.classSlug,
        specSlug: input.specSlug,
        role: input.role,
      },
    });

  // Load/fetch Performance aggregate once per scoring operation (not fight-local).
  // Absence of player evidence is dimension-local — does not zero Utility/Survival.
  // Missing zoneId is configuration failure (throws), not player-data UNAVAILABLE.
  const zoneId = requireScoringZoneId(input.zoneId, "scoreCharacter.zoneId");
  const ttlSeconds = requirePositivePerformanceAggregateTtlSeconds(
    input.performanceAggregateTtlSeconds ??
      DEFAULT_PERFORMANCE_AGGREGATE_TTL_SECONDS,
  );
  const ensure =
    input.ensurePerformanceAggregate ??
    createEnsureCharacterPerformanceAggregate({ prisma: input.prisma });
  const performanceAggregate = await ensure({
    characterId: input.identity.characterId,
    seasonId: input.seasonId,
    zoneId,
    partition: input.partition ?? null,
    character: {
      name: input.identity.characterName,
      realmSlug: input.identity.realm,
      region: input.identity.region as RegionCode,
    },
    now,
    liveProviderPermission,
    ttlSeconds,
    provider: input.allowProviderCalls
      ? input.performanceAggregateProvider ?? null
      : null,
  });

  const profileAggregate =
    performanceAggregate.state === "AVAILABLE" &&
    performanceAggregate.data != null
      ? profileAggregateFactFromPersisted({
          dungeonAggregates: performanceAggregate.data.dungeonAggregates,
          global:
            performanceAggregate.data.globalSummary ??
            performanceAggregate.data.compact.global,
          activeDungeonSlugs: input.activeDungeonSlugs,
        })
      : null;

  let scoreModelConfig: Record<string, unknown> | null;
  if (input.scoreModelConfig !== undefined) {
    scoreModelConfig = input.scoreModelConfig;
  } else {
    const scoreModelRow = await input.prisma.scoreModel.findUnique({
      where: { id: input.scoringModelId },
      select: { config: true },
    });
    scoreModelConfig =
      scoreModelRow?.config != null && typeof scoreModelRow.config === "object"
        ? (scoreModelRow.config as Record<string, unknown>)
        : null;
  }

  const orchestration = await orchestrateScoringRuns({
    characterId: input.identity.characterId,
    characterName: input.identity.characterName,
    region: input.identity.region,
    realm: input.identity.realm,
    seasonId: input.seasonId,
    scope: {
      characterId: input.identity.characterId,
      seasonId: input.seasonId,
      seasonSlug: input.seasonSlug,
      role: input.role,
      classSlug: input.classSlug,
      specSlug: input.specSlug,
      specializationId: null,
      activeDungeonSlugs: input.activeDungeonSlugs,
      evidenceCutoffAt: input.evidenceCutoffAt,
      highKeyPolicyId: input.highKeyPolicyId,
      refreshContractHash: `score-character:${input.identity.characterId}:${input.seasonId}`,
      selectorVersion: EVIDENCE_SELECTOR_VERSION,
    },
    candidates: input.candidates,
    liveProviderPermission,
    ports,
    scoringModelId: input.scoringModelId,
    scoringModelVersion: input.scoringModelVersion,
    difficultyPolicy: input.difficultyPolicy,
    profileAggregate,
    scoreModelConfig,
  });

  const selectedRuns = orchestration.characterDigests.map((row) => ({
    slotId: row.slotId,
    dungeonSlug: row.dungeonSlug,
    slotIndex: row.slotIndex,
    reportCode: row.digest.reportCode,
    fightId: row.digest.fightId,
    reportRevision: row.digest.reportRevision,
    participantActorId: row.digest.participantActorId,
  }));

  const performance = orchestration.dimensions.performance;
  const utility = orchestration.dimensions.utility;
  const survival = orchestration.dimensions.survival;

  const modelConfig = (scoreModelConfig ?? {}) as Partial<ScoreModelConfigV1>;
  let dimensionWeights = defaultSkillDimensionWeights(
    modelConfig.weights
      ? {
          performance: modelConfig.weights.performance,
          survival: modelConfig.weights.survival,
          utility: modelConfig.weights.utility,
          experienceConsistency: modelConfig.weights.experienceConsistency,
        }
      : null,
  );
  try {
    const resolved = resolveTunableWeights(modelConfig as ScoreModelConfigV1);
    const fromTunable = trustDimensionWeightsFromTunable(resolved.weights);
    dimensionWeights = defaultSkillDimensionWeights(fromTunable);
  } catch {
    // Keep weights from modelConfig.weights / defaults.
  }

  const gradeThresholds = modelConfig.gradeThresholds ?? {
    S: 90,
    A: 80,
    B: 65,
    C: 50,
  };
  const minConfidenceForGrade = modelConfig.minConfidenceForGrade ?? 0.35;

  const partial = computePartialComposite(
    [
      {
        key: "performance",
        score: performance?.score ?? null,
        available: performance?.score != null && Number.isFinite(performance.score),
        baseWeight: dimensionWeights.performance,
        confidence: performance?.confidence ?? null,
      },
      {
        key: "survival",
        score: survival?.score ?? null,
        available: survival?.score != null && Number.isFinite(survival.score),
        baseWeight: dimensionWeights.survival,
        confidence: survival?.confidence ?? null,
      },
      {
        key: "utility",
        score: utility?.score ?? null,
        available: utility?.score != null && Number.isFinite(utility.score),
        baseWeight: dimensionWeights.utility,
        confidence: utility?.confidence ?? null,
      },
      {
        key: "experience",
        score: null,
        available: false,
        baseWeight: dimensionWeights.experience,
        confidence: null,
      },
    ],
    { gradeThresholds, minConfidenceForGrade },
  );

  const composite = partial.composite;
  const confidence = partial.confidence;
  const tier = partial.grade;

  const persistCharacterScore = input.persistCharacterScore !== false;
  let characterScoreId: string | null = null;
  if (persistCharacterScore) {
    const scores = new CharacterScoreRepository(input.prisma);
    const saved = await scores.save({
      characterId: input.identity.characterId,
      seasonId: input.seasonId,
      scoringVersion,
      performance: performance?.score ?? null,
      utility: utility?.score ?? null,
      survival: survival?.score ?? null,
      experience: null,
      composite,
      confidence,
      tier,
      dimensionDetails: JSON.parse(
        JSON.stringify({
          blocked: orchestration.dimensions.blocked,
          performanceDigestDiagnostics:
            orchestration.dimensions.performanceDigestDiagnostics,
          utilityDigestDiagnostics:
            orchestration.dimensions.utilityDigestDiagnostics,
          survivalDigestDiagnostics:
            orchestration.dimensions.survivalDigestDiagnostics,
          incomplete: orchestration.incomplete,
          cacheMisses: orchestration.cacheMisses,
          fightFailures: orchestration.fightFailures,
          targetDigestFailures: orchestration.targetDigestFailures,
          providerCalls: orchestration.accounting.providerCalls,
          partialComposite: {
            availabilityCoverage: partial.availabilityCoverage,
            effectiveWeights: partial.effectiveWeights,
            availableCount: partial.availableCount,
            explanation: partial.explanation,
            grade: partial.grade,
          },
          performance: performance
            ? {
                calculatorVersion: performance.calculatorVersion,
                phase1Score: performance.phase1Score,
                offensiveCooldownDiscipline:
                  performance.offensiveCooldownDiscipline,
                weightsApplied: performance.weightsApplied,
                coverage: performance.coverage,
                limitations: performance.limitations,
                state: performance.state,
              }
            : null,
          utility: utility
            ? {
                algorithmVersion: utility.algorithmVersion,
                phase: utility.phase,
                availabilityState: utility.availabilityState,
                interruptCounts: utility.interruptCounts,
                domainBreakdown: utility.domainBreakdown,
                support: utility.support,
                strategicCc: utility.strategicCc,
                explanation: utility.explanation,
                context: utility.context,
              }
            : null,
          survival: survival
            ? {
                algorithmVersion: survival.algorithmVersion,
                modelLabel: survival.modelLabel,
                state: survival.state,
                components: survival.components,
                observations: survival.observations,
                explanation: survival.explanation,
                relativeDamageMode: survival.relativeDamageMode,
              }
            : null,
          performanceAggregate: {
            state: performanceAggregate.state,
            reason: performanceAggregate.reason,
            cache: performanceAggregate.cache,
            contentHash: performanceAggregate.contentHash,
            aggregateRowId: performanceAggregate.aggregateRowId,
          },
        }),
      ),
      selectedRuns: JSON.parse(JSON.stringify(selectedRuns)),
    });
    characterScoreId = saved.id;
  }

  const aggregateProviderCalls = performanceAggregate.providerCalls;
  return {
    orchestration,
    characterScoreId,
    providerCalls:
      orchestration.accounting.providerCalls + aggregateProviderCalls,
    scoringVersion,
    publicationEnabled: input.publicationEnabled === true,
    performanceAggregate: {
      state: performanceAggregate.state,
      data: performanceAggregate.data,
      reason: performanceAggregate.reason,
      cache: performanceAggregate.cache,
      providerCalls: aggregateProviderCalls,
      created: performanceAggregate.created,
      updated: performanceAggregate.updated,
      aggregateRowId: performanceAggregate.aggregateRowId,
      contentHash: performanceAggregate.contentHash,
    },
  };
}
