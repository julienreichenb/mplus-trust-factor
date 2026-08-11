/**
 * Product refresh → scoreCharacter(). Single authoritative scoring path.
 * No legacy calculateScore, no V1/V2 branching, no supersession.
 */
import type {
  CharacterSeasonEvidenceManifestV2,
  EvidenceCandidateMetadataV2,
  EvidenceRole,
  ProviderFetchContext,
  RaiderIoCharacterProfile,
  ScoreSnapshotDTO,
} from "@mplus/contracts";
import { hashRefreshContract } from "@mplus/contracts";
import type { ExperiencePhase1Result } from "@mplus/scoring";
import type { WorkerContainer } from "../../container.js";
import { recordProviderResult } from "../provider-recording.js";
import { scoreCharacter, type ScoreCharacterResult } from "./score-character.js";
import { scoreCharacterResultToSnapshotDto } from "./snapshot-from-character-score.js";
import { createLiveCapabilityAcquireHook, observeAuthoritativeReportRevision } from "./run-orchestration/live-capability-adapter.js";
import { createRedisSourceFightLock } from "./run-orchestration/source-fight-lease.js";
import { createProductionRunOrchestrationPorts } from "./run-orchestration/production-ports.js";
import type { RunOrchestrationPorts } from "./run-orchestration/orchestrator.js";
import type { FetchCharacterPerformanceAggregateProvider } from "./run-orchestration/ensure-performance-aggregate.js";
import type { FetchCharacterZoneRankingsParseProvider } from "./run-orchestration/ensure-ranking-parse-facts.js";
import {
  requirePositivePerformanceAggregateTtlSeconds,
  requireScoringZoneId,
} from "./scoring-zone.js";
import { findLatestFightRevision } from "./fight-details-persist.js";
import {
  allowExperienceBlizzardProviderCalls,
  buildExperiencePhase1Result,
  previousRegionalClassRankFromRioProfile,
  rioPreviousSeasonCorroborationFromProfile,
} from "./experience-phase1.js";
import {
  acquireBlizzardSeasonHistory,
  experienceEvidenceStoreFromRepository,
} from "./experience-blizzard-season-history.js";
import { resolveCanonicalPreviousSeasonBinding } from "./experience-previous-season-evidence.js";
import { createCharacterExperienceEvidenceRepository } from "@mplus/database";

export interface AuthoritativeScoringInput {
  container: WorkerContainer;
  characterId: string;
  seasonId: string;
  seasonSlug: string;
  role: EvidenceRole;
  classSlug: string | null;
  specSlug: string | null;
  refreshContract: Parameters<typeof hashRefreshContract>[0];
  evidenceCutoffAt: string;
  highKeyPolicyId: string;
  activeDungeonSlugs: string[];
  candidates: EvidenceCandidateMetadataV2[];
  scoreModelKey: string;
  scoreModelVersion: number;
  scoreModelId: string;
  calculatedAt: string;
  region: string;
  realm: string;
  characterName: string;
  /**
   * When false, scoreCharacter evaluates without writing CharacterScore.
   * Default true (operational refresh / recalculate).
   */
  persistCharacterScore?: boolean;
  /**
   * One-way safety: may ONLY reduce provider permission.
   * effectiveAllow = envAllows && !forceProviderFree.
   * Never overrides an environment denial.
   */
  forceProviderFree?: boolean;
  /**
   * Optional prevalidated frozen manifest. When supplied, orchestration skips
   * run reselection (provider-free replay / canary parity). Production default:
   * undefined (normal selection).
   */
  existingManifest?: CharacterSeasonEvidenceManifestV2 | null;
  /** Optional frozen ScoreModel.config override for evaluation. */
  scoreModelConfig?: Record<string, unknown> | null;
  /** Test seam. */
  portsOverride?: RunOrchestrationPorts;
  /** Test seam for aggregate provider. */
  performanceAggregateProviderOverride?: FetchCharacterPerformanceAggregateProvider | null;
  /**
   * Test seam: when set (including null), skip Experience acquisition and pass
   * this value through to scoreCharacter.
   */
  experienceOverride?: ExperiencePhase1Result | null;
  /**
   * Already-fetched Raider.IO profile from refresh enrichment. Used only for
   * previous-season regional class rank — does not trigger an extra RIO call.
   */
  raiderIoProfile?: RaiderIoCharacterProfile | null;
}

export interface AuthoritativeScoringResult {
  disabled: boolean;
  snapshot: ScoreSnapshotDTO;
  scoreResult: ScoreCharacterResult | null;
  providerCalls: number;
}

function resolvePerformanceAggregateProvider(
  container: WorkerContainer,
): FetchCharacterPerformanceAggregateProvider | null {
  const wcl = container.providers.warcraftlogs as unknown as {
    fetchCharacterPerformanceAggregate?: FetchCharacterPerformanceAggregateProvider["fetchCharacterPerformanceAggregate"];
  } | null;
  if (wcl && typeof wcl.fetchCharacterPerformanceAggregate === "function") {
    return {
      fetchCharacterPerformanceAggregate: wcl.fetchCharacterPerformanceAggregate.bind(wcl),
    };
  }
  return null;
}

function resolveRankingParseProvider(
  container: WorkerContainer,
): FetchCharacterZoneRankingsParseProvider | null {
  const wcl = container.providers.warcraftlogs as unknown as {
    fetchCharacterZoneRankingsParse?: FetchCharacterZoneRankingsParseProvider["fetchCharacterZoneRankingsParse"];
  } | null;
  if (wcl && typeof wcl.fetchCharacterZoneRankingsParse === "function") {
    return {
      fetchCharacterZoneRankingsParse: wcl.fetchCharacterZoneRankingsParse.bind(wcl),
    };
  }
  return null;
}

/**
 * Sole product scoring entry used by character refresh and recalculate jobs.
 *
 * Always runs scoreCharacter (canonical acquisition + evaluation). Do not gate
 * product refresh on SCORING_ENABLED — that historically returned grade U and
 * left refresh on the legacy pre-selection WCL path. Publication remains gated
 * by SCORING_PUBLICATION_ENABLED inside scoreCharacter / snapshot mapping.
 */
export async function runAuthoritativeScoring(
  input: AuthoritativeScoringInput,
): Promise<AuthoritativeScoringResult> {
  const fingerprint = `scoring:${input.characterId}:${input.seasonId}:${hashRefreshContract(input.refreshContract)}`;

  input.container.logger.info(
    {
      event: "REFRESH_PHASE",
      phase: "SCORING",
      characterId: input.characterId,
      seasonId: input.seasonId,
      persistCharacterScore: input.persistCharacterScore !== false,
      scoringEnabledFlag: input.container.env.SCORING_ENABLED,
    },
    "REFRESH_PHASE",
  );

  const zoneId = requireScoringZoneId(input.refreshContract.zoneId);
  const partition =
    input.refreshContract.partition === undefined
      ? null
      : input.refreshContract.partition;
  const ttlSeconds = requirePositivePerformanceAggregateTtlSeconds(
    input.container.env.WCL_CHARACTER_TTL_SECONDS ?? 43_200,
  );

  const envAllowsProviderCalls =
    input.container.env.ALLOW_LIVE_PROVIDER_CALLS === true &&
    input.container.env.PROVIDER_MODE === "live" &&
    input.container.env.WCL_ENABLED === true;
  // One-way: forceProviderFree may only REDUCE permission.
  const allowProviderCalls =
    envAllowsProviderCalls && input.forceProviderFree !== true;

  if (!allowProviderCalls && input.candidates.length > 0) {
    input.container.logger.warn(
      {
        event: "REFRESH_PHASE",
        phase: "DETAILED_ACQUISITION_BLOCKED",
        characterId: input.characterId,
        candidateCount: input.candidates.length,
        ALLOW_LIVE_PROVIDER_CALLS: input.container.env.ALLOW_LIVE_PROVIDER_CALLS,
        PROVIDER_MODE: input.container.env.PROVIDER_MODE,
        WCL_ENABLED: input.container.env.WCL_ENABLED,
        detail:
          "scoreCharacter cannot acquire ReportEvents — set ALLOW_LIVE_PROVIDER_CALLS=true when PROVIDER_MODE=live",
      },
      "DETAILED_ACQUISITION_BLOCKED",
    );
  }

  let liveAcquire:
    | Parameters<typeof scoreCharacter>[0]["liveAcquire"]
    | undefined;
  let resolveReportRevision: RunOrchestrationPorts["resolveReportRevision"];
  if (allowProviderCalls && !input.portsOverride) {
    const wcl = input.container.providers.warcraftlogs as
      | { getGraphQlClient?: () => Parameters<typeof createLiveCapabilityAcquireHook>[0]["client"] }
      | null
      | undefined;
    if (wcl && typeof wcl.getGraphQlClient === "function") {
      const client = wcl.getGraphQlClient();
      liveAcquire = createLiveCapabilityAcquireHook({
        env: input.container.env,
        prisma: input.container.prisma,
        artifacts: input.container.repositories.artifacts,
        wclSource: input.container.repositories.wclSource,
        client,
        region: input.region,
        permission: {
          providerMode: input.container.env.PROVIDER_MODE,
          wclEnabled: input.container.env.WCL_ENABLED,
          allowLiveProviderCalls: true,
          liveProviderPermissionGranted: true,
          scoringPublicationEnabled:
            input.container.env.SCORING_PUBLICATION_ENABLED,
          hasWclCredentials: Boolean(
            input.container.env.WCL_CLIENT_ID &&
              input.container.env.WCL_CLIENT_SECRET,
          ),
        },
      });
      resolveReportRevision = async ({ reportCode, fightId }) => {
        const persisted = await findLatestFightRevision({
          wclSource: input.container.repositories.wclSource,
          reportCode,
          fightId,
        });
        if (persisted != null && Number.isFinite(persisted) && persisted >= 0) {
          return { reportRevision: persisted, providerCalls: 0 };
        }
        return observeAuthoritativeReportRevision({
          client,
          reportCode,
          fightId,
          region: input.region,
        });
      };
    }
  }

  let ports = input.portsOverride;
  /** Owned Redis handle when this function creates the source-fight lock connection. */
  let redisOwned: ReturnType<WorkerContainer["createRedisConnection"]> | null =
    null;
  if (!ports) {
    const rankingParseProvider = allowProviderCalls
      ? resolveRankingParseProvider(input.container)
      : null;
    const basePorts = createProductionRunOrchestrationPorts({
      prisma: input.container.prisma,
      artifacts: input.container.repositories.artifacts,
      evidence: input.container.repositories.evidence,
      liveAcquireCapabilityPackage: liveAcquire,
      zoneId,
      rankingParseProvider,
      targetCharacter: {
        characterId: input.characterId,
        characterName: input.characterName,
        realmSlug: input.realm,
        regionCode: input.region,
        classSlug: input.classSlug,
        specSlug: input.specSlug,
        role: input.role,
      },
    });
    redisOwned = input.container.createRedisConnection();
    const withSourceFightLock = createRedisSourceFightLock({
      redis: redisOwned,
      appEnv:
        input.container.env.APP_ENV ??
        input.container.env.NODE_ENV ??
        "development",
      findCompatiblePackage: (args) =>
        basePorts.findCompatibleCapabilityPackage(args),
    });
    ports = {
      ...basePorts,
      withSourceFightLock,
      ...(resolveReportRevision ? { resolveReportRevision } : {}),
    };
  }

  try {
    const performanceAggregateProvider =
      input.performanceAggregateProviderOverride !== undefined
        ? input.performanceAggregateProviderOverride
        : allowProviderCalls
          ? resolvePerformanceAggregateProvider(input.container)
          : null;

    let experience: ExperiencePhase1Result | null = null;
    let experienceProviderCalls = 0;
    if (input.experienceOverride !== undefined) {
      experience = input.experienceOverride;
    } else {
      // Always evaluate/reconstruct Experience via the canonical phase-1 path.
      // Provider permission controls acquisition only — not whether Experience runs.
      const allowExperienceProviders =
        allowExperienceBlizzardProviderCalls(input.container.env) &&
        !input.container.disabledProviders.has("blizzard") &&
        input.forceProviderFree !== true;
      const experienceCtx: ProviderFetchContext = {
        region: input.region,
        requestId: `experience-phase1:${input.characterId}:${input.seasonId}`,
        correlationId: fingerprint,
        forceRefresh: false,
        now: input.calculatedAt,
      };
      try {
        const evidenceRepo = createCharacterExperienceEvidenceRepository(
          input.container.prisma,
        );
        const evidenceStore = experienceEvidenceStoreFromRepository(evidenceRepo);

        // Agent 03B — persist closed-season Blizzard history before Phase 1 reuse.
        try {
          const history = await acquireBlizzardSeasonHistory({
            prisma: input.container.prisma,
            characterId: input.characterId,
            identity: {
              region: input.region,
              realmSlug: input.realm,
              name: input.characterName,
            },
            regionCode: input.region,
            currentSeasonId: input.seasonId,
            blizzard: input.container.providers.blizzard,
            ctx: experienceCtx,
            persistProviderResult: (result) =>
              recordProviderResult(input.container.repositories, result),
            evidenceStore,
            allowProviderCalls: allowExperienceProviders,
            now: new Date(input.calculatedAt),
          });
          experienceProviderCalls +=
            history.profileIndexCalls + history.seasonDetailsCalls;
        } catch (historyError) {
          input.container.logger.warn(
            {
              event: "EXPERIENCE_BLIZZARD_HISTORY_FAILED",
              characterId: input.characterId,
              seasonId: input.seasonId,
              error:
                historyError instanceof Error
                  ? historyError.message
                  : String(historyError),
            },
            "EXPERIENCE_BLIZZARD_HISTORY_FAILED",
          );
        }

        // One canonical previous-season binding decision (internal Season + RIO slug).
        let canonicalPreviousBinding: ReturnType<
          typeof resolveCanonicalPreviousSeasonBinding
        > | null = null;
        let boundPreviousRaiderIoSlug: string | null = null;
        const currentSeasonRow = await input.container.prisma.season.findUnique({
          where: { id: input.seasonId },
          select: {
            id: true,
            regionId: true,
            blizzardSeasonId: true,
            startsAt: true,
            endsAt: true,
            slug: true,
            providerSeasonId: true,
          },
        });
        if (currentSeasonRow?.regionId) {
          const regionSeasons = await input.container.prisma.season.findMany({
            where: { regionId: currentSeasonRow.regionId },
            select: {
              id: true,
              regionId: true,
              slug: true,
              blizzardSeasonId: true,
              startsAt: true,
              endsAt: true,
              providerSeasonId: true,
            },
          });
          canonicalPreviousBinding = resolveCanonicalPreviousSeasonBinding(
            currentSeasonRow,
            regionSeasons,
          );
          if (canonicalPreviousBinding.ok) {
            boundPreviousRaiderIoSlug =
              canonicalPreviousBinding.boundRaiderIoSlug;
          }
        }

        const built = await buildExperiencePhase1Result({
          prisma: input.container.prisma,
          characterId: input.characterId,
          identity: {
            region: input.region,
            realmSlug: input.realm,
            name: input.characterName,
          },
          currentSeasonId: input.seasonId,
          regionCode: input.region,
          blizzard: input.container.providers.blizzard,
          ctx: experienceCtx,
          persistProviderResult: (result) =>
            recordProviderResult(input.container.repositories, result),
          allowProviderCalls: allowExperienceProviders,
          evidenceStore,
          canonicalPreviousBinding,
          boundPreviousRaiderIoSlug,
          raiderIoExactSeason:
            !allowExperienceProviders ||
            input.container.disabledProviders.has("raiderio")
              ? null
              : input.container.providers.raiderio,
          // No RIO endpoint proves previous_mythic_plus_ranks for an exact season slug.
          previousRegionalClassRank: previousRegionalClassRankFromRioProfile(
            input.raiderIoProfile ?? null,
            { exactSeasonProven: false },
          ),
          rioPreviousSeasonCorroboration:
            rioPreviousSeasonCorroborationFromProfile(
              input.raiderIoProfile ?? null,
              { boundPreviousRaiderIoSlug },
            ),
        });
        experience = built.experience;
        experienceProviderCalls +=
          built.previousSeasonProfileCalls +
          built.achievementsCalls +
          built.raiderIoHistoricalRatingCalls;
      } catch (error) {
        // Experience must never break P/S/U scoring.
        input.container.logger.warn(
          {
            event: "EXPERIENCE_PHASE1_FAILED",
            characterId: input.characterId,
            seasonId: input.seasonId,
            error: error instanceof Error ? error.message : String(error),
          },
          "EXPERIENCE_PHASE1_FAILED",
        );
        experience = null;
      }
    }

    const scoreResult = await scoreCharacter({
      identity: {
        characterId: input.characterId,
        region: input.region,
        realm: input.realm,
        characterName: input.characterName,
      },
      seasonId: input.seasonId,
      seasonSlug: input.seasonSlug,
      role: input.role,
      classSlug: input.classSlug,
      specSlug: input.specSlug,
      activeDungeonSlugs: input.activeDungeonSlugs,
      candidates: input.candidates,
      evidenceCutoffAt: input.evidenceCutoffAt,
      highKeyPolicyId: input.highKeyPolicyId,
      scoringModelId: input.scoreModelId,
      scoringModelVersion: String(input.scoreModelVersion),
      allowProviderCalls,
      publicationEnabled: input.container.env.SCORING_PUBLICATION_ENABLED,
      persistCharacterScore: input.persistCharacterScore,
      scoreModelConfig: input.scoreModelConfig,
      existingManifest: input.existingManifest,
      ports,
      prisma: input.container.prisma,
      artifacts: input.container.repositories.artifacts,
      evidence: input.container.repositories.evidence,
      liveAcquire,
      zoneId,
      partition,
      performanceAggregateTtlSeconds: ttlSeconds,
      performanceAggregateProvider,
      experience,
    });

    return {
      disabled: false,
      snapshot: scoreCharacterResultToSnapshotDto({
        result: scoreResult,
        characterId: input.characterId,
        seasonSlug: input.seasonSlug,
        scoreModelKey: input.scoreModelKey,
        scoreModelVersion: input.scoreModelVersion,
        calculatedAt: input.calculatedAt,
        inputFingerprint: fingerprint,
        publicationEnabled: input.container.env.SCORING_PUBLICATION_ENABLED,
      }),
      scoreResult,
      providerCalls: scoreResult.providerCalls + experienceProviderCalls,
    };
  } finally {
    if (redisOwned) {
      await redisOwned.quit().catch(() => undefined);
    }
  }
}
